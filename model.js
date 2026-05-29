
const STORAGE_KEY = 'portfolio_holdings_v1';
const FX_KEY = 'portfolio_fx_v1';

let FX = { KRW: 1, USD: 1380, EUR: 1480, JPY: 9.2, HKD: 176, CNY: 190, GBP: 1750, CHF: 1530, TWD: 42 };
// 초기화 시 복원할 기본 환율 — MARKETS의 모든 통화 포함(누락 시 그 통화 평가가 1배로 깨짐)
const DEFAULT_FX = { KRW: 1, USD: 1380, EUR: 1480, JPY: 9.2, HKD: 176, CNY: 190, GBP: 1750, CHF: 1530, TWD: 42 };

// 서로 명확히 구분되는 색상 (도넛 인접 조각 식별 용이)
const PALETTE = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#0ea5e9', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
  '#a855f7', '#3b82f6', '#22c55e', '#f43f5e'
];

// 시장 코드 → Yahoo 접미사 + 통화 + 한글 표시 라벨 매핑
// code가 'US'인 미국은 접미사 없음 (예: AAPL)
// short: 행/레전드에 표시되는 짧은 한글 라벨
// long: select 옵션 펼침/툴팁에서 보이는 정식 명칭
const MARKETS = [
  { code: 'US', flag: '🇺🇸', short: '미국',     long: '미국 (NYSE/NASDAQ)',   suffix: '',    currency: 'USD' },
  { code: 'KS', flag: '🇰🇷', short: '코스피',   long: '한국 코스피 (.KS)',     suffix: '.KS', currency: 'KRW' },
  { code: 'KQ', flag: '🇰🇷', short: '코스닥',   long: '한국 코스닥 (.KQ)',     suffix: '.KQ', currency: 'KRW' },
  { code: 'T',  flag: '🇯🇵', short: '일본',     long: '일본 도쿄 (.T)',        suffix: '.T',  currency: 'JPY' },
  { code: 'HK', flag: '🇭🇰', short: '홍콩',     long: '홍콩 (.HK)',            suffix: '.HK', currency: 'HKD' },
  { code: 'TW', flag: '🇹🇼', short: '대만',     long: '대만 거래소 (.TW)',      suffix: '.TW', currency: 'TWD' },
  { code: 'SS', flag: '🇨🇳', short: '상하이',   long: '중국 상하이 (.SS)',      suffix: '.SS', currency: 'CNY' },
  { code: 'SZ', flag: '🇨🇳', short: '선전',     long: '중국 선전 (.SZ)',        suffix: '.SZ', currency: 'CNY' },
  { code: 'AS', flag: '🇳🇱', short: '네덜란드', long: '네덜란드 암스테르담 (.AS)', suffix: '.AS', currency: 'EUR' },
  { code: 'L',  flag: '🇬🇧', short: '영국',     long: '영국 런던 (.L)',         suffix: '.L',  currency: 'GBP' },
  { code: 'PA', flag: '🇫🇷', short: '프랑스',   long: '프랑스 파리 (.PA)',      suffix: '.PA', currency: 'EUR' },
  { code: 'DE', flag: '🇩🇪', short: '독일',     long: '독일 프랑크푸르트 (.DE)', suffix: '.DE', currency: 'EUR' },
  { code: 'MI', flag: '🇮🇹', short: '이탈리아', long: '이탈리아 밀라노 (.MI)',  suffix: '.MI', currency: 'EUR' },
  { code: 'SW', flag: '🇨🇭', short: '스위스',   long: '스위스 (.SW)',           suffix: '.SW', currency: 'CHF' }
];
const MARKET_BY_CODE = Object.fromEntries(MARKETS.map(m => [m.code, m]));

function getMarket(code) { return MARKET_BY_CODE[code] || MARKETS[0]; }
function fullTicker(base, marketCode) {
  const m = getMarket(marketCode);
  return base ? base + m.suffix : '';
}

// 마이그레이션: 구 스키마({ticker:'069500.KS', currency:'KRW'}) → 새 스키마({ticker:'069500', market:'KS'})
function migrateHolding(d) {
  if (!d) return d;
  if (d.market !== undefined) return d; // 이미 새 스키마
  let ticker = String(d.ticker || '').trim();
  let market = 'US';
  // ticker에 .XX 접미사 있으면 분리
  const re = /^(.+?)\.(KS|KQ|T|HK|TW|SS|SZ|AS|L|PA|DE|MI|SW)$/i;
  const m = ticker.match(re);
  if (m) {
    ticker = m[1];
    market = m[2].toUpperCase();
  } else if (d.currency) {
    // 접미사 없으면 통화로 시장 추론
    const inferred = { KRW: 'KS', JPY: 'T', HKD: 'HK', CNY: 'SS', EUR: 'AS', GBP: 'L', CHF: 'SW', TWD: 'TW' };
    market = inferred[d.currency] || 'US';
  }
  return { ticker, market, qty: d.qty, buyPrice: d.buyPrice ?? d.price, currentPrice: d.currentPrice ?? d.price };
}

// innerHTML 주입 전 사용자/외부 입력(티커·회사명·계좌명) 이스케이프 — self-XSS 방지
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========== 데이터 모델: holding = {ticker, market, name, currentPrice, lots:[{account,qty,buyPrice}]} ==========
// 합산 식별 키 — 같은 티커+시장이면 한 종목
function holdingKey(ticker, market) {
  return String(ticker || '').trim().toUpperCase() + '|' + (market || 'US');
}

// lots → 합산수량 / 합산매수원가 / 가중평균 매수단가 (현지통화 기준)
function aggregateHolding(h) {
  let totalQty = 0, totalCost = 0;
  (h.lots || []).forEach(l => {
    const q = parseFloat(l.qty) || 0, p = parseFloat(l.buyPrice) || 0;
    totalQty += q;
    totalCost += q * p;
  });
  return { totalQty, totalCost, avgBuyPrice: totalQty > 0 ? totalCost / totalQty : 0 };
}

// 모든 로드 경로 공통: 구 스키마 변환 + lots 래핑 + 키별 중복 합산
function normalizeHoldings(rawArray) {
  if (!Array.isArray(rawArray)) return [];
  const byKey = new Map();
  rawArray.forEach(raw => {
    if (!raw) return;
    let ticker, market, name, currentPrice, lots;
    if (Array.isArray(raw.lots)) {
      // 신 스키마 (이미 lots 보유)
      const mig = raw.market !== undefined ? raw : migrateHolding(raw);
      ticker = String(mig.ticker || '').trim().toUpperCase();
      market = mig.market || 'US';
      name = raw.name || '';
      currentPrice = parseFloat(raw.currentPrice) || 0;
      lots = raw.lots.map(l => ({
        account: l.account || '',
        qty: parseFloat(l.qty) || 0,
        buyPrice: parseFloat(l.buyPrice) || 0
      }));
    } else {
      // 구 평면 스키마 → lot 1개로 래핑
      const mig = migrateHolding(raw);
      ticker = String(mig.ticker || '').trim().toUpperCase();
      market = mig.market || 'US';
      name = raw.name || '';
      currentPrice = parseFloat(mig.currentPrice) || 0;
      lots = [{ account: raw.account || '', qty: parseFloat(mig.qty) || 0, buyPrice: parseFloat(mig.buyPrice) || 0 }];
    }
    if (!ticker) return;
    const key = ticker + '|' + market;
    if (!byKey.has(key)) byKey.set(key, { ticker, market, name, currentPrice, lots: [] });
    const tgt = byKey.get(key);
    tgt.lots.push(...lots);
    if (!tgt.name && name) tgt.name = name;
    if (!tgt.currentPrice && currentPrice) tgt.currentPrice = currentPrice;
  });
  return Array.from(byKey.values());
}

// 매수내역 추가/수정 + 자동 합산. ref={key,lotIndex}면 기존 lot 수정, 없으면 신규.
// 반환: { holding, merged } (merged=기존 종목에 합산됐는지)
function upsertLot(input, ref) {
  const ticker = String(input.ticker || '').trim().toUpperCase();
  const market = input.market || 'US';
  const lot = {
    account: String(input.account || '').trim(),
    qty: parseFloat(input.qty) || 0,
    buyPrice: parseFloat(input.buyPrice) || 0
  };
  const newKey = holdingKey(ticker, market);
  let prevName = '', prevPrice = 0;

  if (ref && ref.key) {
    const src = HOLDINGS.find(h => holdingKey(h.ticker, h.market) === ref.key);
    if (src) {
      prevName = src.name; prevPrice = src.currentPrice;
      if (ref.key === newKey) { src.lots[ref.lotIndex] = lot; return { holding: src, merged: false }; }
      src.lots.splice(ref.lotIndex, 1);
      if (src.lots.length === 0) { HOLDINGS = HOLDINGS.filter(h => h !== src); expandedKeys.delete(ref.key); }
      else if (src.lots.length === 1) { expandedKeys.delete(ref.key); }
    }
  }

  let target = HOLDINGS.find(h => holdingKey(h.ticker, h.market) === newKey);
  if (target) { target.lots.push(lot); return { holding: target, merged: true }; }
  target = { ticker, market, name: prevName || '', currentPrice: prevPrice || 0, lots: [lot] };
  HOLDINGS.push(target);
  return { holding: target, merged: false };
}

// DEFAULTS — 시연용 (+/- 섞이도록)
const DEFAULTS = [
  { ticker: '069500', market: 'KS', qty: 500, buyPrice: 105000 }, // KODEX 200
  { ticker: '114260', market: 'KS', qty: 200, buyPrice: 62000 },  // KODEX 국고채3년
  { ticker: '360750', market: 'KS', qty: 100, buyPrice: 24000 },  // TIGER 미국S&P500
  { ticker: 'AAPL',   market: 'US', qty: 10,  buyPrice: 280 },
  { ticker: 'VOO',    market: 'US', qty: 5,   buyPrice: 700 }
];

let rowId = 0;
let HOLDINGS = [];                 // 진실의 원천 (holding 배열)
const expandedKeys = new Set();    // 펼쳐진 종목 키

function formatPrice(v) {
  const n = parseFloat(v);
  if (!n || n <= 0) return '-';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

// 모바일에서 회사명 12자 초과 시 말줄임 — 데스크탑은 원본 표시
function formatTickerName(name) {
  if (!name) return '';
  if (matchMedia('(max-width: 600px)').matches && name.length > 20) {
    return name.substring(0, 20) + '…';
  }
  return name;
}
