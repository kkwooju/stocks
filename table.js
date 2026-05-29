// ========== 편집 모달 ==========
let modalCtx = null; // { mode:'new'|'addLot'|'editLot', key, lotIndex }

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
  const k = holdingKey(holding.ticker, holding.market);
  if (holding.lots.length > 1) expandedKeys.add(k); else expandedKeys.delete(k);

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

// ESC로 모달 닫기
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('edit-modal').hidden) {
    closeEditModal();
  }
});

// 표 위임 클릭 핸들러 (행/버튼 구분)
document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('holdings-body');
  if (!tbody) return;
  tbody.addEventListener('click', (e) => {
    const holdingRow = e.target.closest('tr.holding-row');
    const lotRow = e.target.closest('tr.lot-row');
    if (e.target.closest('.btn-add-lot') && holdingRow) { e.stopPropagation(); openLotModal('addLot', holdingRow.dataset.key); return; }
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

// ========== 환율 표시 (읽기 전용, Yahoo Finance 자동 갱신) ==========
function renderFxInputs() {
  const grid = document.getElementById('fx-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.keys(FX).forEach(cur => {
    if (cur === 'KRW') return;
    const row = document.createElement('div');
    row.className = 'fx-row';
    const valStr = FX[cur].toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    row.innerHTML = `<span class="fx-cur">${cur}</span><span class="fx-val">${valStr}</span><span class="fx-unit">원</span>`;
    grid.appendChild(row);
  });
}

// ========== 데이터 읽기 ==========
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

// ========== 정렬 상태 ==========
let tableSort = { key: null, dir: 'asc' }; // 표 정렬 (티커/수익률)
let legendSort = { key: 'amount', dir: 'desc' }; // 레전드 정렬 (기본: 평가금액 큰 순)

function holdingSortValue(h, key) {
  if (key === 'ticker') return (h.tickerFull || h.ticker || '').toUpperCase();
  if (key === 'returnPct') return h.returnPct == null ? -Infinity : h.returnPct;
  return 0;
}

function applyTableSort() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === tableSort.key) {
      th.classList.add(tableSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
  renderTable();
}

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

function toggleTableSort(key) {
  if (tableSort.key === key) {
    tableSort.dir = tableSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    tableSort.key = key;
    tableSort.dir = 'asc';
  }
  applyTableSort();
}
