// ========== 가격 자동 조회 (Yahoo Finance via CORS proxy) ==========
// 한국 ETF는 .KS(KOSPI)/.KQ(KOSDAQ), 미국은 그냥 티커, 홍콩 .HK, 일본 .T, 유럽 .L/.PA/.AS
// 공개 프록시들이 가끔 다운되므로 다중 fallback. 한 개 죽어도 다음으로 자동 전환.
const PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`
];

// 환율: Yahoo는 `${FROM}${TO}=X` 심볼로 KRW 대비 환율 제공 (예: USDKRW=X → 1380.x)
async function fetchFXRate(currency) {
  if (!currency || currency === 'KRW') return null;
  const symbol = `${currency}KRW=X`;
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  let lastErr;
  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const res = await fetch(PROXIES[i](yahooUrl), { cache: 'no-cache' });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      const rate = meta?.regularMarketPrice;
      if (typeof rate === 'number' && rate > 0) {
        return { currency, rate };
      }
      lastErr = new Error('데이터 없음');
    } catch (e) {
      lastErr = e;
      console.warn(`[FX ${currency}] proxy ${i} 실패:`, e.message);
    }
  }
  throw lastErr || new Error('모든 프록시 실패');
}

async function fetchOnePrice(symbol) {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  let lastErr;
  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const res = await fetch(PROXIES[i](yahooUrl), { cache: 'no-cache' });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta || meta.regularMarketPrice == null) {
        lastErr = new Error('데이터 없음');
        continue;
      }
      return {
        symbol,
        price: meta.regularMarketPrice,
        currency: meta.currency,
        marketState: meta.marketState,
        // Yahoo가 회사명을 longName(긴) 또는 shortName(짧은)으로 줌. 둘 중 있는 거 사용.
        name: meta.longName || meta.shortName || '',
        proxyIdx: i
      };
    } catch (e) {
      lastErr = e;
      console.warn(`[${symbol}] proxy ${i} 실패:`, e.message);
    }
  }
  throw lastErr || new Error('모든 프록시 실패');
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

  // 병렬 호출 — 한 종목 실패해도 나머지는 진행
  let done = 0;
  // 종목 가격 + 환율 모두 병렬 호출 (실패해도 다른 호출은 진행)
  const tickProgress = () => {
    done++;
    statusEl.textContent = `가격·환율 조회 중... (${done}/${totalCalls})`;
  };
  const priceTasks = symbols.map(s =>
    fetchOnePrice(s).then(r => { tickProgress(); return r; })
                    .catch(e => { tickProgress(); throw e; })
  );
  const fxTasks = currencies.map(c =>
    fetchFXRate(c).then(r => { tickProgress(); return r; })
                  .catch(e => { tickProgress(); throw e; })
  );
  const [results, fxResults] = await Promise.all([
    Promise.allSettled(priceTasks),
    Promise.allSettled(fxTasks)
  ]);

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
