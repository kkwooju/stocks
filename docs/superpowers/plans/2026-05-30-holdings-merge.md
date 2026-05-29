# 동일 종목 합산 (계좌별 매수내역 보존) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 티커+시장 종목을 하나의 행으로 합산(수량 합계·가중평균 매수단가)하되, 계좌별 매수내역은 펼침으로 보존한다.

**Architecture:** "DOM이 진실의 원천"에서 **`let HOLDINGS = []` JS 모델이 진실**로 전환. 각 holding은 `lots[]`(매수내역)을 갖고, `renderTable()`이 모델에서 합산 요약행 + 펼침 하위행을 그린다. 모든 편집은 모달로 일원화하고, 모든 로드 경로는 `normalizeHoldings()`를 통과시켜 구 스키마 변환 + 중복 합산을 수행한다.

**Tech Stack:** 순수 HTML/CSS/JS (프레임워크·빌드·테스트 프레임워크 없음). 단일 파일 `portfolio.html`. 검증은 브라우저 콘솔 단언 + 수동 UI 확인.

설계 문서: `docs/superpowers/specs/2026-05-30-holdings-merge-design.md`

---

## 파일 구조

- 수정: `D:\projects\주식\portfolio\portfolio.html` (유일한 변경 파일)
  - `<style>` (16~874): 하위행/펼침/계좌 배지 CSS 추가
  - 모달 HTML (1197~1242): `계좌` 입력 필드 추가, 삭제 버튼 id 부여
  - `<script>` (1244~2653): 데이터 모델·렌더·모달·저장·로드·가격갱신 재작성
- 수정(선택): `README.md` — 합산 기능 안내 문단 (Task 6)

> 다른 파일(`manifest.json`, `sw.js`, `icon.svg`, `portfolio_data.json`)은 변경하지 않는다.

## 검증 환경 준비 (한 번만)

가격 API는 http 서버에서만 동작하지만, **합산 로직 검증은 가격 없이도 가능**하다. 로컬 서버로 띄워 확인한다.

- [ ] **사전: 로컬 서버 실행**

Run (PowerShell, 프로젝트 폴더에서):
```
python -m http.server 8765
```
브라우저에서 `http://localhost:8765/portfolio.html` 접속. (python 없으면 `npx --yes serve -l 8765` 또는 기존 `portfolio-launcher.exe` 사용.)
콘솔 단언 테스트는 F12 → Console 탭에 스니펫을 붙여넣어 실행한다.

---

## Task 1: 순수 데이터 모델 헬퍼 (추가만, 기존 동작 불변)

기존 코드를 건드리지 않고 새 함수만 추가한다. 이 시점엔 앱 동작이 그대로다(아직 호출 안 함).

**Files:**
- Modify: `portfolio.html` — `migrateHolding` 함수 바로 뒤 (현재 1303행 `}` 다음 줄)에 삽입

- [ ] **Step 1: 헬퍼 4개 추가**

`migrateHolding` 함수 닫는 `}` 다음 줄(현재 1303~1304 사이)에 아래를 삽입:

```js
// ========== 데이터 모델: holding = {ticker, market, name, currentPrice, lots:[{account,qty,buyPrice}]} ==========
// innerHTML 주입 전 사용자/외부 입력(티커·회사명·계좌명) 이스케이프 — self-XSS 방지
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
```

- [ ] **Step 2: 콘솔 단언으로 검증**

서버로 페이지를 열고 F12 콘솔에 붙여넣어 실행:
```js
// 가중평균: 10@280 + 5@310 → 15주, 평균 290
(() => {
  const agg = aggregateHolding({ lots: [{qty:10,buyPrice:280},{qty:5,buyPrice:310}] });
  console.assert(agg.totalQty === 15, 'totalQty', agg.totalQty);
  console.assert(Math.abs(agg.avgBuyPrice - 290) < 1e-9, 'avg', agg.avgBuyPrice);
  // 키
  console.assert(holdingKey('aapl','US') === 'AAPL|US', 'key');
  // 중복 합산: 같은 AAPL|US 두 항목 → lots 2개로 합쳐짐
  const n = normalizeHoldings([
    {ticker:'AAPL',market:'US',qty:10,buyPrice:280},
    {ticker:'AAPL',market:'US',qty:5,buyPrice:310,account:'신한'}
  ]);
  console.assert(n.length === 1 && n[0].lots.length === 2, 'merge', n);
  // 구 스키마(.KS 접미사) 변환
  const o = normalizeHoldings([{ticker:'069500.KS',currency:'KRW',qty:5,buyPrice:1000}]);
  console.assert(o[0].ticker === '069500' && o[0].market === 'KS', 'migrate', o[0]);
  console.log('Task1 OK');
})();
```
Expected: 콘솔에 `Task1 OK`, assertion 에러 없음.

- [ ] **Step 3: 커밋**

```
git add portfolio.html
git commit -m "feat: 데이터 모델 헬퍼(holdingKey/aggregateHolding/normalizeHoldings) 추가"
```

---

## Task 2: HOLDINGS 상태 + 렌더링 전환 (읽기 경로)

모델을 진실의 원천으로 삼아 표·차트·KPI·정렬·가격갱신·저장/로드를 모델 기반으로 바꾼다. 이 Task 완료 후 앱은 **합산 표시·차트·가격갱신·import/초기화가 정상 동작**한다. (편집/추가는 Task 3에서 — 그 사이 행 클릭/＋버튼은 임시로 동작 안 함.)

**Files:**
- Modify: `portfolio.html` — `<style>`, 스크립트 다수 함수

- [ ] **Step 1: CSS 추가 (하위행·펼침·배지)**

`</style>` 바로 앞(현재 873행 부근)에 삽입:
```css
/* 합산 종목: 펼침 토글 / 계좌 배지 / 매수내역 하위행 */
.row-toggle { display:inline-block; width:1em; color:#64748b; font-size:.8em; cursor:pointer; }
.lot-badge { display:inline-block; margin-left:6px; padding:1px 6px; font-size:11px; font-weight:700;
  color:#2563eb; background:#dbeafe; border-radius:9px; vertical-align:middle; }
tr.holding-row { cursor:pointer; }
tr.lot-row { background:#f8fafc; }
tr.lot-row td { color:#475569; font-size:.92em; }
.lot-account { color:#334155; font-weight:600; }
.modal-field .opt { color:#94a3b8; font-weight:400; font-size:.85em; }
```

- [ ] **Step 2: 전역 상태 추가**

`let rowId = 0;`(현재 1326행 부근) 다음 줄에 추가:
```js
let HOLDINGS = [];                 // 진실의 원천 (holding 배열)
const expandedKeys = new Set();    // 펼쳐진 종목 키
```

- [ ] **Step 3: `readHoldings()` 를 모델 파생으로 교체**

기존 `function readHoldings(includeEmpty = false) { ... }` 전체(현재 1839~1875)를 아래로 교체:
```js
// HOLDINGS에서 파생 집계 배열 생성 (차트/KPI/정렬/저장이 소비하는 형태 유지)
function readHoldings(includeEmpty = false) {
  return HOLDINGS.map(h => {
    const mi = getMarket(h.market);
    const currency = mi.currency;
    const { totalQty, totalCost, avgBuyPrice } = aggregateHolding(h);
    const currentPrice = parseFloat(h.currentPrice) || 0;
    const fx = FX[currency] || 1;
    const buyKRW = totalCost * fx;
    const valueKRW = totalQty * currentPrice * fx;
    const returnPct = (avgBuyPrice > 0 && currentPrice > 0)
      ? (currentPrice - avgBuyPrice) / avgBuyPrice
      : null;
    const tickerFull = h.ticker ? h.ticker + mi.suffix : '';
    return {
      ticker: h.ticker, market: h.market, tickerFull, name: h.name || '',
      currency, qty: totalQty, buyPrice: avgBuyPrice, currentPrice,
      buyKRW, valueKRW, returnPct, lots: h.lots, key: holdingKey(h.ticker, h.market)
    };
  }).filter(h => includeEmpty || (h.ticker && h.qty > 0 && (h.currentPrice > 0 || h.buyPrice > 0)));
}
```

- [ ] **Step 4: 정렬을 데이터 기반으로 교체**

기존 `function rowSortValue(row, key) { ... }`(1877~1886)를 아래로 교체:
```js
function holdingSortValue(h, key) {
  if (key === 'ticker') return (h.tickerFull || h.ticker || '').toUpperCase();
  if (key === 'returnPct') return h.returnPct == null ? -Infinity : h.returnPct;
  return 0;
}
```
기존 `function applyTableSort() { ... }`(1888~1907) 전체를 아래로 교체:
```js
function applyTableSort() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === tableSort.key) {
      th.classList.add(tableSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
  renderTable();
}
```

- [ ] **Step 5: `renderTable()` 추가**

`applyTableSort` 바로 뒤에 추가:
```js
// HOLDINGS → 표 렌더 (요약행 + 펼침 시 계좌 하위행). 정렬·차트도 여기서 트리거.
function renderTable() {
  const tbody = document.getElementById('holdings-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  let rows = readHoldings(true).filter(h => h.ticker);
  if (tableSort.key) {
    rows.sort((a, b) => {
      const va = holdingSortValue(a, tableSort.key), vb = holdingSortValue(b, tableSort.key);
      const cmp = (typeof va === 'string') ? va.localeCompare(vb, 'ko') : (va - vb);
      return tableSort.dir === 'desc' ? -cmp : cmp;
    });
  }
  rows.forEach(h => {
    const mi = getMarket(h.market);
    const multi = h.lots.length > 1;
    const expanded = expandedKeys.has(h.key);
    const retCls = h.returnPct == null ? '' : (h.returnPct >= 0 ? 'up' : 'down');
    const retTxt = h.returnPct != null ? `${h.returnPct >= 0 ? '+' : ''}${(h.returnPct * 100).toFixed(2)}%` : '-';

    const tr = document.createElement('tr');
    tr.className = 'holding-row';
    tr.dataset.key = h.key;
    tr.innerHTML = `
      <td data-label="티커">
        <span class="row-toggle">${multi ? (expanded ? '▾' : '▸') : ''}</span>
        <span class="ticker-display">${escapeHtml(h.ticker)}</span>
        ${multi ? `<span class="lot-badge">${h.lots.length}계좌</span>` : ''}
        <span class="ticker-name">${escapeHtml(formatTickerName(h.name))}</span>
      </td>
      <td data-label="시장"><span class="market-display">${mi.flag} ${mi.short}</span></td>
      <td data-label="수량">${h.qty > 0 ? h.qty.toLocaleString('ko-KR') : '-'}</td>
      <td data-label="매수가">${formatPrice(h.buyPrice)}</td>
      <td class="current-price" data-label="현재가">${formatPrice(h.currentPrice)}</td>
      <td class="return-cell ${retCls}" data-label="수익률">${retTxt}</td>
      <td class="actions-cell" data-label="">
        <button class="btn btn-add-lot" title="매수내역 추가">＋</button>
        <button class="btn btn-del" title="종목 삭제">✕</button>
      </td>`;
    tbody.appendChild(tr);

    if (multi && expanded) {
      h.lots.forEach((l, idx) => {
        const lq = parseFloat(l.qty) || 0, lp = parseFloat(l.buyPrice) || 0;
        const lpct = (lp > 0 && h.currentPrice > 0) ? (h.currentPrice - lp) / lp : null;
        const lcls = lpct == null ? '' : (lpct >= 0 ? 'up' : 'down');
        const ltxt = lpct != null ? `${lpct >= 0 ? '+' : ''}${(lpct * 100).toFixed(2)}%` : '-';
        const lr = document.createElement('tr');
        lr.className = 'lot-row';
        lr.dataset.key = h.key; lr.dataset.lot = idx;
        lr.innerHTML = `
          <td data-label="계좌"><span class="lot-account">└ ${escapeHtml(l.account || ('내역 ' + (idx + 1)))}</span></td>
          <td data-label="시장"></td>
          <td data-label="수량">${lq > 0 ? lq.toLocaleString('ko-KR') : '-'}</td>
          <td data-label="매수가">${formatPrice(lp)}</td>
          <td data-label="현재가"></td>
          <td class="return-cell ${lcls}" data-label="수익률">${ltxt}</td>
          <td class="actions-cell" data-label="">
            <button class="btn btn-edit-lot" title="이 내역 편집">✎</button>
            <button class="btn btn-del-lot" title="이 내역 삭제">✕</button>
          </td>`;
        tbody.appendChild(lr);
      });
    }
  });
  drawChart();
}
```

- [ ] **Step 6: `updateReturns()` 제거 + `drawChart`에서 호출 삭제**

`drawChart()` 첫 줄 `updateReturns();`(현재 2039)를 삭제한다. 그리고 `function updateReturns() { ... }` 함수 전체(현재 1982~1999)를 삭제한다. (수익률은 이제 `renderTable`이 그린다.)

- [ ] **Step 7: `saveAndDraw` / `saveToLocal` 모델 기반으로 교체**

`function saveAndDraw() { saveToLocal(); drawChart(); }`(1370~1373)를 아래로 교체:
```js
function saveAndDraw() {
  saveToLocal();
  renderTable();
}
```
`function saveToLocal() { ... }`(1332~1346) 전체를 아래로 교체:
```js
function saveToLocal() {
  try {
    const holdings = HOLDINGS.filter(h => h.ticker && (h.lots || []).length).map(h => ({
      ticker: h.ticker, market: h.market, name: h.name || '', currentPrice: h.currentPrice || 0,
      lots: h.lots.map(l => ({ account: l.account || '', qty: l.qty, buyPrice: l.buyPrice }))
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
    localStorage.setItem(FX_KEY, JSON.stringify(FX));
    const hhmm = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    if (!fileHandle) showSaveStatus('✓ 저장됨 · ' + hhmm);
    scheduleAutoSave();
  } catch (e) {
    showSaveStatus('⚠ 저장 실패: ' + e.message, true);
  }
}
```

- [ ] **Step 8: 로드 경로를 normalize 기반으로 교체**

(a) `function loadFromLocal()`(1347~1362)의 본문에서 `data.forEach(d => addRow(d));` 줄을 `HOLDINGS = normalizeHoldings(data);` 로 교체.

(b) `importJSON`(1587~1609)에서 아래 3줄
```js
      document.getElementById('holdings-body').innerHTML = '';
      rowId = 0;
      holdings.forEach(d => addRow(d));
```
을 다음으로 교체:
```js
      HOLDINGS = normalizeHoldings(holdings);
      expandedKeys.clear();
```
그리고 같은 함수의 `saveAndDraw();` 다음 줄에 `renderTable();` 추가.

(c) `resetData`(1611~1622)에서
```js
  document.getElementById('holdings-body').innerHTML = '';
  rowId = 0;
```
두 줄을 `expandedKeys.clear();` 로 교체하고, `DEFAULTS.forEach(d => addRow(d));` 를 `HOLDINGS = normalizeHoldings(DEFAULTS);` 로 교체. 함수 끝 `saveAndDraw();` 다음에 `renderTable();` 추가.

(d) `init()`(2584~2651)의 3개 분기에서 `holdings.forEach(d => addRow(d));`(2594, 2606) 및 `DEFAULTS.forEach(d => addRow(d));`(2620)를 각각:
- 2594행 → `HOLDINGS = normalizeHoldings(holdings);`
- 2606행 → `HOLDINGS = normalizeHoldings(holdings);`
- 2620행 → `HOLDINGS = normalizeHoldings(DEFAULTS);`
그리고 `updateFileButtons();`(2627) 바로 다음 줄에 `renderTable();` 추가.

- [ ] **Step 9: `refreshPrices` 를 holding 기반으로 교체**

`refreshPrices`(2328~2438)에서 행 수집부(2334~2342)
```js
  const btn = document.getElementById('btn-refresh');
  const rows = Array.from(document.querySelectorAll('#holdings-body tr'));
  const rowSymbols = rows.map(r => {
    const base = r.querySelector('.ticker-input').value.trim().toUpperCase();
    const market = r.querySelector('.market-select').value;
    return { row: r, base, full: base ? base + getMarket(market).suffix : '' };
  });
  const symbols = rowSymbols.filter(rs => rs.full).map(rs => rs.full);
```
를 아래로 교체:
```js
  const btn = document.getElementById('btn-refresh');
  const held = HOLDINGS.filter(h => h.ticker);
  const symbolToHolding = {};
  held.forEach(h => { symbolToHolding[h.ticker + getMarket(h.market).suffix] = h; });
  const symbols = Object.keys(symbolToHolding);
```
그리고 결과 반영부(2392~2409)
```js
  // 각 행의 현재가 셀(dataset.price + 표시 텍스트) + 회사명 갱신
  rowSymbols.forEach(({row, full}) => {
    const cell = row.querySelector('.current-price');
    if (!cell) return;
    if (full && priceMap[full] != null) {
      cell.dataset.price = String(priceMap[full]);
      cell.textContent = formatPrice(priceMap[full]);
      cell.classList.remove('stale');
    } else if (full) {
      cell.classList.add('stale');
    }
    if (full && nameMap[full]) {
      row.dataset.name = nameMap[full];
      const nameEl = row.querySelector('.ticker-name');
      if (nameEl) nameEl.textContent = formatTickerName(nameMap[full]);
    }
  });
```
를 아래로 교체:
```js
  // 각 holding의 currentPrice / name 갱신
  Object.keys(symbolToHolding).forEach(full => {
    const h = symbolToHolding[full];
    if (priceMap[full] != null) h.currentPrice = priceMap[full];
    if (nameMap[full]) h.name = nameMap[full];
  });
```
(이 함수 끝의 `saveAndDraw();`(2423)는 그대로 두면 `renderTable()`까지 호출되어 표가 갱신된다.)

- [ ] **Step 10: 행 탭 핸들러 + 리사이즈 핸들러 교체**

기존 "모바일: 표 행 탭 = 편집 모달" 리스너(2240~2250) 전체를 삭제한다(Task 3에서 위임 핸들러로 대체). 그리고 리사이즈 핸들러(2253~2262)의 본문
```js
    document.querySelectorAll('#holdings-body tr').forEach(row => {
      const nameEl = row.querySelector('.ticker-name');
      if (nameEl) nameEl.textContent = formatTickerName(row.dataset.name || '');
    });
```
을 `renderTable();` 한 줄로 교체.

- [ ] **Step 11: 브라우저 검증 (읽기 경로)**

콘솔에서 데모 데이터에 중복을 강제로 넣어 합산 표시를 확인:
```js
HOLDINGS = normalizeHoldings([
  {ticker:'AAPL',market:'US',name:'Apple Inc.',currentPrice:300,qty:10,buyPrice:280,account:'키움'},
  {ticker:'AAPL',market:'US',qty:5,buyPrice:310,account:'신한'},
  {ticker:'069500',market:'KS',currentPrice:114000,qty:500,buyPrice:105000}
]);
renderTable();
```
Expected: AAPL 행 1개에 **15주 / 290 / 2계좌 배지 / ▸**, 069500는 단일 행. AAPL 행 클릭… 은 아직 미동작(Task 3). 콘솔에서 `expandedKeys.add('AAPL|US'); renderTable();` 실행 시 키움/신한 하위행 2줄이 펼쳐지고 각 lot 수익률 표시. 차트·KPI에 합산값(15주 기준) 반영.

- [ ] **Step 12: 커밋**

```
git add portfolio.html
git commit -m "feat: HOLDINGS 모델 기반 렌더링/저장/로드/가격갱신 전환 (합산 표시)"
```

---

## Task 3: 모달 편집/추가 + 행 상호작용 (쓰기 경로)

편집·추가·삭제·펼침을 모델 기반으로 구현하고, 자동 합산을 완성한다. 죽은 코드(`addRow`, `syncDisplay`)를 제거한다.

**Files:**
- Modify: `portfolio.html` — 모달 HTML, 모달/상호작용 JS

- [ ] **Step 1: 모달에 `계좌` 필드 + 삭제버튼 id + 미리보기 훅 추가**

모달의 "시장" 필드 블록(1210~1213)
```html
      <div class="modal-field">
        <label for="m-market">시장</label>
        <select id="m-market"></select>
      </div>
```
바로 다음에 삽입:
```html
      <div class="modal-field">
        <label for="m-account">계좌 <span class="opt">(선택)</span></label>
        <input type="text" id="m-account" placeholder="예: 키움, 신한 (선택)">
      </div>
```
그리고 매수단가 input(1220)에 `oninput` 추가 — 기존:
```html
        <input type="number" id="m-buy" min="0" step="any" placeholder="0">
```
를:
```html
        <input type="number" id="m-buy" min="0" step="any" placeholder="0" oninput="updateModalReturnPreview()">
```
삭제 버튼(1236)에 id 부여 — 기존:
```html
        <button class="btn btn-del-modal" onclick="deleteFromModal()">🗑 삭제</button>
```
를:
```html
        <button class="btn btn-del-modal" id="m-del-btn" onclick="deleteFromModal()">🗑 삭제</button>
```

- [ ] **Step 2: 모달 컨텍스트 상태 교체**

기존 모달 상태(1713~1714)
```js
let modalRowId = null;
let modalIsNew = false; // true면 + 종목 추가로 막 만들어진 행 — 취소 시 행 자체 제거
```
를 아래로 교체:
```js
let modalCtx = null; // { mode:'new'|'addLot'|'editLot', key, lotIndex }
```

- [ ] **Step 3: `upsertLot` 추가**

`normalizeHoldings` 뒤(Task 1에서 추가한 블록 끝)에 추가:
```js
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
    }
  }

  let target = HOLDINGS.find(h => holdingKey(h.ticker, h.market) === newKey);
  if (target) { target.lots.push(lot); return { holding: target, merged: true }; }
  target = { ticker, market, name: prevName || '', currentPrice: prevPrice || 0, lots: [lot] };
  HOLDINGS.push(target);
  return { holding: target, merged: false };
}
```

- [ ] **Step 4: 모달 열기/저장/닫기/삭제/미리보기 교체**

`openEditModal`(1716~1755), `closeEditModal`(1757~1770), `saveModal`(1772~1792), `deleteFromModal`(1794~1800), `addRowAndOpenModal`(1802~1805) — 이 5개 함수 **전체**를 아래로 교체:
```js
function openLotModal(mode, key, lotIndex) {
  modalCtx = { mode, key: key || null, lotIndex: (lotIndex == null ? null : lotIndex) };
  let curMarket = 'US', ticker = '', account = '', qty = '', buy = '', name = '', curPrice = 0;
  if (key) {
    const h = HOLDINGS.find(x => holdingKey(x.ticker, x.market) === key);
    if (h) {
      curMarket = h.market; ticker = h.ticker; name = h.name; curPrice = h.currentPrice;
      if (mode === 'editLot' && h.lots[lotIndex]) {
        account = h.lots[lotIndex].account; qty = h.lots[lotIndex].qty; buy = h.lots[lotIndex].buyPrice;
      }
    }
  }
  document.getElementById('m-market').innerHTML = MARKETS.map(m =>
    `<option value="${m.code}" ${m.code === curMarket ? 'selected' : ''} title="${m.long}">${m.flag} ${m.short}</option>`
  ).join('');
  document.getElementById('m-ticker').value = ticker;
  document.getElementById('m-account').value = account;
  document.getElementById('m-qty').value = qty;
  document.getElementById('m-buy').value = buy;

  const lock = (mode === 'addLot');
  document.getElementById('m-ticker').disabled = lock;
  document.getElementById('m-market').disabled = lock;
  document.getElementById('modal-title').textContent =
    mode === 'new' ? '종목 추가' : (mode === 'addLot' ? `${ticker} 매수내역 추가` : '매수내역 편집');

  const mi = getMarket(curMarket);
  document.getElementById('m-current').textContent =
    curPrice > 0 ? curPrice.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + ' ' + mi.currency : '-';
  document.getElementById('m-name').textContent = name || '-';
  updateModalReturnPreview();
  document.getElementById('m-del-btn').hidden = (mode === 'new' || mode === 'addLot');
  document.getElementById('edit-modal').hidden = false;
  setTimeout(() => document.getElementById(lock ? 'm-account' : 'm-ticker').focus(), 50);
}

function updateModalReturnPreview() {
  const buy = parseFloat(document.getElementById('m-buy').value) || 0;
  let cur = 0;
  if (modalCtx && modalCtx.key) {
    const h = HOLDINGS.find(x => holdingKey(x.ticker, x.market) === modalCtx.key);
    cur = h ? (parseFloat(h.currentPrice) || 0) : 0;
  }
  const el = document.getElementById('m-return');
  if (buy > 0 && cur > 0) {
    const pct = ((cur - buy) / buy) * 100;
    el.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    el.style.color = pct >= 0 ? 'var(--up)' : 'var(--down)';
  } else { el.textContent = '-'; el.style.color = ''; }
}

function saveModal() {
  if (!modalCtx) return closeEditModal();
  const ticker = document.getElementById('m-ticker').value.trim().toUpperCase();
  const market = document.getElementById('m-market').value;
  const account = document.getElementById('m-account').value.trim();
  const qty = document.getElementById('m-qty').value;
  const buy = document.getElementById('m-buy').value;
  if (!ticker) { alert('티커를 입력해주세요.'); document.getElementById('m-ticker').focus(); return; }

  const ref = (modalCtx.mode === 'editLot') ? { key: modalCtx.key, lotIndex: modalCtx.lotIndex } : null;
  const existedBefore = !!HOLDINGS.find(h => holdingKey(h.ticker, h.market) === holdingKey(ticker, market));
  const wasNew = (modalCtx.mode === 'new');
  const { holding, merged } = upsertLot({ ticker, market, account, qty, buyPrice: buy }, ref);
  expandedKeys.add(holdingKey(holding.ticker, holding.market)); // 합산되면 펼쳐서 확인 쉽게
  if (holding.lots.length <= 1) expandedKeys.delete(holdingKey(holding.ticker, holding.market));

  closeEditModal();
  saveAndDraw();
  if (merged && (wasNew ? existedBefore : true)) {
    showSaveStatus(`✓ 기존 ${holding.name || holding.ticker}에 합산됨`);
  }
  if ((parseFloat(holding.currentPrice) || 0) <= 0 && !IS_FILE_PROTOCOL) refreshPrices();
}

function closeEditModal() {
  document.getElementById('edit-modal').hidden = true;
  document.getElementById('m-ticker').disabled = false;
  document.getElementById('m-market').disabled = false;
  modalCtx = null;
}

function deleteFromModal() {
  if (!modalCtx) return closeEditModal();
  if (modalCtx.mode === 'editLot') {
    const c = modalCtx; closeEditModal(); deleteLot(c.key, c.lotIndex);
  } else { closeEditModal(); }
}

function addRowAndOpenModal() { openLotModal('new'); }
```

- [ ] **Step 5: 펼침/삭제 헬퍼 + 위임 클릭 핸들러 추가**

`removeRow`(1818~1821) 함수 전체를 아래로 교체(이름이 onclick에서 더 안 쓰이므로 신규 헬퍼로 대체):
```js
function toggleExpand(key) {
  if (expandedKeys.has(key)) expandedKeys.delete(key); else expandedKeys.add(key);
  renderTable();
}
function deleteHolding(key) {
  const h = HOLDINGS.find(x => holdingKey(x.ticker, x.market) === key);
  if (!h) return;
  if (!confirm(`${h.ticker} 종목 전체(${h.lots.length}개 내역)를 삭제할까요?`)) return;
  HOLDINGS = HOLDINGS.filter(x => x !== h);
  expandedKeys.delete(key);
  saveAndDraw();
}
function deleteLot(key, idx) {
  const h = HOLDINGS.find(x => holdingKey(x.ticker, x.market) === key);
  if (!h) return;
  if (!confirm('이 매수내역을 삭제할까요?')) return;
  h.lots.splice(idx, 1);
  if (h.lots.length === 0) { HOLDINGS = HOLDINGS.filter(x => x !== h); expandedKeys.delete(key); }
  else if (h.lots.length === 1) { expandedKeys.delete(key); }
  saveAndDraw();
}
```
그리고 `startEdit`/`endEdit` 하위호환 줄(1815~1816)을 아래로 교체:
```js
// 표 위임 클릭 핸들러 (행/버튼 구분)
document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('holdings-body');
  if (!tbody) return;
  tbody.addEventListener('click', (e) => {
    const holdingRow = e.target.closest('tr.holding-row');
    const lotRow = e.target.closest('tr.lot-row');
    if (e.target.closest('.btn-add-lot')) { e.stopPropagation(); openLotModal('addLot', holdingRow.dataset.key); return; }
    if (e.target.closest('.btn-del') && holdingRow) { e.stopPropagation(); deleteHolding(holdingRow.dataset.key); return; }
    if (e.target.closest('.btn-edit-lot')) { e.stopPropagation(); openLotModal('editLot', lotRow.dataset.key, parseInt(lotRow.dataset.lot, 10)); return; }
    if (e.target.closest('.btn-del-lot')) { e.stopPropagation(); deleteLot(lotRow.dataset.key, parseInt(lotRow.dataset.lot, 10)); return; }
    if (lotRow) { openLotModal('editLot', lotRow.dataset.key, parseInt(lotRow.dataset.lot, 10)); return; }
    if (holdingRow) {
      const h = HOLDINGS.find(x => holdingKey(x.ticker, x.market) === holdingRow.dataset.key);
      if (h && h.lots.length > 1) toggleExpand(holdingRow.dataset.key);
      else openLotModal('editLot', holdingRow.dataset.key, 0);
    }
  });
});
```

- [ ] **Step 6: 죽은 코드 제거**

다음을 삭제한다:
- `function addRow(rawData = {}, opts = {}) { ... }` 전체 (현재 1624~1677)
- `function syncDisplay(id) { ... }` 전체 (현재 1679~1710)

검색으로 잔존 호출이 없는지 확인:

Run:
```
grep -nE "addRow|syncDisplay|modalRowId|modalIsNew|rowSortValue|updateReturns|removeRow|startEdit|endEdit" portfolio.html
```
Expected: 결과 없음(0건). 있으면 해당 호출부를 위 신규 함수로 교체.

- [ ] **Step 7: 브라우저 검증 (쓰기 경로 — 핵심 시나리오)**

`localStorage.clear()` 후 새로고침(데모 데이터 로드). 그 다음:
1. "＋ 종목 추가" → 티커 `AAPL`, 시장 미국, 계좌 `키움`, 수량 `10`, 매수단가 `280` 저장.
2. 다시 "＋ 종목 추가" → 티커 `AAPL`, 시장 미국, 계좌 `신한`, 수량 `5`, 매수단가 `310` 저장.
   Expected: AAPL 행 **1개**, 수량 **15**, 매수가 **290**, "2계좌" 배지, "기존 …에 합산됨" 상태 메시지, 자동 펼침으로 키움/신한 표시.
3. 키움 하위행 클릭 → 수량 `20`으로 수정 저장 → 합산 25주, 평균 = (20×280+5×310)/25 = 286 확인.
4. 신한 하위행 ✕ → 삭제 → AAPL 단일 lot(20주 @280)로 축소, 배지/펼침 사라짐.
5. AAPL 요약행 ✕ → 종목 전체 삭제.
6. 새로고침 → localStorage에서 동일 상태 복원(합산 유지).

- [ ] **Step 8: 커밋**

```
git add portfolio.html
git commit -m "feat: 모달 기반 매수내역 추가/편집/삭제 + 자동 합산 + 펼침 상호작용"
```

---

## Task 4: import/구버전 데이터 마이그레이션 검증

코드 변경 없음(Task 2에서 이미 normalize 적용). 레거시 중복/구스키마 데이터가 올바르게 합쳐지는지 회귀 검증만 수행한다.

- [ ] **Step 1: 구버전 평면 데이터 import 검증**

콘솔에서 구 스키마(중복 포함) 파일 형태를 import 함수로 직접 주입:
```js
const fakeFile = JSON.stringify({ holdings: [
  {ticker:'AAPL', currency:'USD', qty:10, buyPrice:280, currentPrice:300},
  {ticker:'AAPL', currency:'USD', qty:5,  buyPrice:310, currentPrice:300},
  {ticker:'069500.KS', currency:'KRW', qty:500, buyPrice:105000, currentPrice:114000}
]});
HOLDINGS = normalizeHoldings(JSON.parse(fakeFile).holdings);
expandedKeys.clear(); renderTable();
```
Expected: AAPL 1행(15주/평균290/2계좌), 069500은 `market:'KS'`로 변환되어 단일 행. 콘솔: `JSON.parse(localStorage.portfolio_holdings_v1)`는 아직 미저장이므로 `saveToLocal()` 호출 후 새 스키마(`lots[]`)로 저장됨을 확인.

- [ ] **Step 2: 신스키마 round-trip 검증**

```js
saveToLocal();
const reloaded = normalizeHoldings(JSON.parse(localStorage.portfolio_holdings_v1));
console.assert(reloaded.find(h=>h.ticker==='AAPL').lots.length === 2, 'roundtrip lots');
console.log('Task4 OK');
```
Expected: `Task4 OK`.

- [ ] **Step 3: 커밋 (검증 전용 — 변경 없으면 생략)**

변경 사항이 없으면 커밋 없이 다음 Task로. (스니펫은 커밋하지 않는다.)

---

## Task 5: 전체 회귀 + 차트/KPI/가격갱신 확인

- [ ] **Step 1: 차트·KPI·정렬·환율 회귀**

`localStorage.clear()` 후 새로고침. 가격 갱신(🔄) 실행(http 서버 필요).
Expected:
- 도넛/레전드/KPI가 합산 holding 기준으로 정상.
- "티커"/"수익률" 헤더 클릭 정렬 동작(요약행 기준).
- 레전드 정렬 토글 동작.
- 환율 설정 표시 정상.
- 콘솔 에러 0건.

- [ ] **Step 2: PWA/모바일 회귀(스모크)**

DevTools 모바일 뷰로 전환 → 하단 탭바, FAB(＋), 행 탭 동작 확인. (Playwright MCP 사용 가능 시 자동 스냅샷.)

- [ ] **Step 3: 커밋 (회귀 중 수정 발생 시에만)**

```
git add portfolio.html
git commit -m "fix: 합산 기능 회귀 수정"
```

---

## Task 6: README 안내 문단 추가

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 합산 기능 설명 추가**

"### 2. 종목 추가하기" 섹션 끝(현재 36행 뒤)에 추가:
```markdown

### 같은 종목을 여러 계좌에 나눠 가진 경우

동일 종목(같은 티커+시장)을 다시 추가하면 **자동으로 합산**됩니다.
- 수량은 합쳐지고, 매수단가는 **가중평균**으로 계산됩니다. (예: 키움 10주 @$280 + 신한 5주 @$310 → 15주 평균 $290)
- 표에는 합산된 한 줄로 보이고, 좌측 **▸** 를 누르면 계좌별 내역이 펼쳐집니다.
- 계좌명은 선택 입력입니다. 비우면 "내역 1 / 내역 2"로 표시됩니다.
- 각 계좌 내역은 펼친 뒤 행을 눌러 수정하거나 ✕로 개별 삭제할 수 있습니다.
```

- [ ] **Step 2: 커밋**

```
git add README.md
git commit -m "docs: 동일 종목 합산(계좌별 내역) 사용법 추가"
```

---

## 자체 검토 결과 (작성자 체크)

- **스펙 커버리지**: 합산(Task1 aggregate, Task3 upsertLot) / 가중평균(aggregateHolding) / 계좌 보존·펼침(Task2 renderTable, Task3 상호작용) / 계좌명 선택입력(모달 m-account, 폴백 라벨) / 저장 시 자동 합산(saveModal+upsertLot) / 로드 시 중복정리(normalizeHoldings) / 마이그레이션(Task4) / 차트·KPI 유지(readHoldings 형태 보존) — 모두 태스크에 매핑됨.
- **플레이스홀더**: 없음. 모든 코드 블록은 실제 구현.
- **타입/명칭 일관성**: `holdingKey`/`aggregateHolding`/`normalizeHoldings`/`upsertLot`/`renderTable`/`openLotModal`/`saveModal`/`closeEditModal`/`deleteFromModal`/`toggleExpand`/`deleteHolding`/`deleteLot`/`holdingSortValue`/`updateModalReturnPreview`/`HOLDINGS`/`expandedKeys`/`modalCtx` — 정의와 호출 명칭 일치 확인. 제거 대상(`addRow`,`syncDisplay`,`updateReturns`,`rowSortValue`,`removeRow`,`modalRowId`,`modalIsNew`,`startEdit`,`endEdit`)은 Task3 Step6 grep으로 잔존 0건 확인.
- **보안(XSS)**: `renderTable()`이 `innerHTML`로 그리므로 사용자/외부 입력인 티커·회사명·계좌명은 `escapeHtml()`로 감싼다(Task1에 헬퍼 추가, Task2 renderTable에서 적용). 데이터는 로컬 전용이라 영향은 self-XSS 수준이지만, 악성 JSON import 대비. 모달 input은 `.value`(textContent 경로)라 안전. 차트 레전드(`drawChart`)도 동일 패턴이나 이번 범위 밖 — 기존 코드 유지.
- **주의**: `onclick="installPWA()"` 등 HTML 인라인 핸들러로 호출되는 함수(`saveModal`,`closeEditModal`,`deleteFromModal`,`addRowAndOpenModal`,`resetData`,`exportJSON`,`importJSON`,`toggleTableSort`,`toggleLegendSort`,`setChartBasis`)는 이름을 유지했다. 표 액션 버튼은 인라인 onclick 대신 위임 핸들러로 처리(동적 행이라 위임이 안전).
