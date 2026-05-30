// ========== 가격 자동 조회 (Yahoo Finance via CORS proxy) ==========
// 한국 ETF는 .KS(KOSPI)/.KQ(KOSDAQ), 미국은 그냥 티커, 홍콩 .HK, 일본 .T, 유럽 .L/.PA/.AS
// 공개 프록시들이 가끔 다운되므로 다중 fallback. 한 개 죽어도 다음으로 자동 전환.
// 순서 = 안정성 순(라이브 측정 기준). 0·1번이 reliable, 2번은 평상시용 보조.
// ※ allorigins.win은 부하 시 CORS 헤더 누락으로 상시 실패 → cors.lol로 교체(2026-05 검증).
const PROXIES = [
  url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  url => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`
];

// 동시에 떠 있는 요청 수 상한. 무료 프록시/Yahoo의 속도 제한을 피하려면 낮게 유지.
const CONCURRENCY = 3;

// 작업 풀: jobs(() => Promise 배열)를 최대 limit개씩만 동시 실행한다.
// 반환값은 Promise.allSettled와 동일한 형태({status, value|reason})로 입력 순서를 보존.
// 작업 하나가 끝날 때마다 onEach() 호출 (진행률 표시용).
async function runWithConcurrency(jobs, limit, onEach) {
  const results = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const cur = next++;
      try {
        results[cur] = { status: 'fulfilled', value: await jobs[cur]() };
      } catch (e) {
        results[cur] = { status: 'rejected', reason: e };
      }
      if (onEach) onEach();
    }
  }
  // limit개의 워커가 큐(next)를 나눠 소비. 한 워커가 작업을 끝내면 다음 인덱스를 집어 든다.
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 종목/환율 모두 동일한 Yahoo chart 엔드포인트 → 프록시 순회 + 데이터 추출을 공유 헬퍼로 통합.
// 프록시 3개를 한 바퀴 돌고도 실패하면 지수 백오프로 재시도한다.
// 특히 429(Too Many Requests)는 "잠깐 쉬면 풀리는" 일시적 차단이므로 재시도가 효과적.
const FETCH_MAX_RETRIES = 5;     // 프록시 한 바퀴 실패 후 최대 재시도 횟수 (대량 종목 대비 상향)
const FETCH_BASE_DELAY = 800;    // 첫 재시도 대기(ms). 매 회 2배 (800 → 1600 → 3200 → 5000…)
const FETCH_MAX_DELAY = 5000;    // 백오프 상한 — 마지막 회차가 과도하게 길어지지 않도록 캡
async function fetchYahooMeta(symbol, label) {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  let lastErr;
  for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt++) {
    let rateLimited = false;
    for (let i = 0; i < PROXIES.length; i++) {
      try {
        const res = await fetch(PROXIES[i](yahooUrl), { cache: 'no-cache' });
        // 429는 IP/프록시 단위 속도 제한. 다음 프록시도 같은 IP라 막힐 수 있으니
        // 한 바퀴 끝나면 잠시 대기 후 재시도하도록 플래그만 세운다.
        if (res.status === 429) { rateLimited = true; lastErr = new Error('HTTP 429 (요청 과다)'); continue; }
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) { lastErr = new Error('데이터 없음'); continue; }
        return meta;
      } catch (e) {
        lastErr = e;
        console.warn(`[${label}] proxy ${i} 실패:`, e.message);
      }
    }
    // 프록시 한 바퀴 전부 실패. 재시도 여력이 남았으면 백오프 후 다시 시도.
    if (attempt < FETCH_MAX_RETRIES) {
      const delay = Math.min(FETCH_BASE_DELAY * Math.pow(2, attempt), FETCH_MAX_DELAY);
      if (rateLimited) console.warn(`[${label}] 429 감지 → ${delay}ms 대기 후 재시도 (${attempt + 1}/${FETCH_MAX_RETRIES})`);
      await sleep(delay);
    }
  }
  throw lastErr || new Error('모든 프록시 실패');
}

// 환율: Yahoo는 `${FROM}${TO}=X` 심볼로 KRW 대비 환율 제공 (예: USDKRW=X → 1380.x)
async function fetchFXRate(currency) {
  if (!currency || currency === 'KRW') return null;
  const meta = await fetchYahooMeta(`${currency}KRW=X`, `FX ${currency}`);
  const rate = meta.regularMarketPrice;
  if (typeof rate === 'number' && rate > 0) return { currency, rate };
  throw new Error('데이터 없음');
}

async function fetchOnePrice(symbol) {
  const meta = await fetchYahooMeta(symbol, symbol);
  if (meta.regularMarketPrice == null) throw new Error('데이터 없음');
  return {
    symbol,
    price: meta.regularMarketPrice,
    currency: meta.currency,
    marketState: meta.marketState,
    // Yahoo가 회사명을 longName(긴) 또는 shortName(짧은)으로 줌. 둘 중 있는 거 사용.
    name: meta.longName || meta.shortName || ''
  };
}

async function refreshPrices() {
  // file:// 환경에서는 CORS proxy에 도달 자체가 차단됨 → 일찍 종료하고 명확히 안내
  if (IS_FILE_PROTOCOL) {
    showSaveStatus('⚠ 가격 갱신 불가: file:// 모드에서는 외부 API 호출이 브라우저에 의해 차단됩니다. portfolio-launcher.exe로 실행하세요', true);
    return;
  }
  const btn = document.getElementById('btn-refresh');
  const held = HOLDINGS.filter(h => h.ticker);
  const symbolToHolding = {};
  held.forEach(h => { symbolToHolding[h.ticker + getMarket(h.market).suffix] = h; });
  const symbols = Object.keys(symbolToHolding);
  if (symbols.length === 0) {
    showSaveStatus('갱신할 종목이 없습니다', true);
    return;
  }

  // 환율은 MARKETS 카탈로그의 모든 외화 통화를 갱신 (보유 종목 유무와 무관)
  // → 새 종목 추가 시 이미 최신 환율로 평가 가능
  const currencies = Array.from(new Set(
    MARKETS.map(m => m.currency).filter(c => c && c !== 'KRW')
  ));
  const totalCalls = symbols.length + currencies.length;

  btn.disabled = true;
  const statusEl = document.getElementById('save-status');
  statusEl.textContent = `가격·환율 조회 중... (0/${totalCalls})`;
  statusEl.className = 'save-status loading';

  // 동시 요청 제한 — 종목이 많으면 한꺼번에 발사 시 프록시/Yahoo가 429로 차단함.
  // 가격·환율은 같은 서버를 두드리므로 하나의 풀에 합쳐 전체 동시 호출을 CONCURRENCY개로 묶는다.
  let done = 0;
  const tickProgress = () => {
    done++;
    statusEl.textContent = `가격·환율 조회 중... (${done}/${totalCalls})`;
  };
  // 각 작업을 즉시 실행하지 않고 "() => Promise" 형태로 정의 → 풀이 슬롯 비는 대로 꺼내 실행.
  const jobs = [
    ...symbols.map(s => () => fetchOnePrice(s)),
    ...currencies.map(c => () => fetchFXRate(c))
  ];
  const settled = await runWithConcurrency(jobs, CONCURRENCY, tickProgress);
  // 정의 순서를 유지하므로 앞쪽 symbols.length개가 가격, 나머지가 환율 결과.
  const results = settled.slice(0, symbols.length);
  const fxResults = settled.slice(symbols.length);

  const priceMap = {};
  const nameMap = {};
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      priceMap[r.value.symbol] = r.value.price;
      if (r.value.name) nameMap[r.value.symbol] = r.value.name;
    } else {
      failed.push(symbols[i]);
    }
  });

  // 각 holding의 currentPrice / name 갱신
  Object.keys(symbolToHolding).forEach(full => {
    const h = symbolToHolding[full];
    if (priceMap[full] != null) h.currentPrice = priceMap[full];
    if (nameMap[full]) h.name = nameMap[full];
  });

  // 환율 결과 반영 — 성공한 통화만 FX 객체 갱신
  const fxFailed = [];
  fxResults.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value && typeof r.value.rate === 'number') {
      FX[r.value.currency] = r.value.rate;
    } else {
      fxFailed.push(currencies[i]);
    }
  });
  // 환율 input UI 다시 그리기 (사용자가 보고 있던 값도 새 시장값으로 교체)
  renderFxInputs();

  saveAndDraw();
  btn.disabled = false;
  const ok = symbols.length - failed.length;
  const fxOk = currencies.length - fxFailed.length;
  const hhmm = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const allOk = failed.length === 0 && fxFailed.length === 0;
  if (allOk) {
    const fxPart = currencies.length ? ` · 환율 ${fxOk}` : '';
    showSaveStatus(`✓ 가격 ${ok}${fxPart} 갱신 · ${hhmm}`);
  } else {
    const parts = [];
    if (failed.length) parts.push(`종목 실패: ${failed.join(', ')}`);
    if (fxFailed.length) parts.push(`환율 실패: ${fxFailed.join(', ')}`);
    showSaveStatus(`⚠ 가격 ${ok}/${symbols.length} · 환율 ${fxOk}/${currencies.length} · ${parts.join(' / ')}`, true);
  }
}
