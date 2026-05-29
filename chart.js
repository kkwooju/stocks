// ========== 레전드 정렬 ==========
const LEGEND_SORT_OPTIONS = [
  { key: 'amount',    label: '평가금액', defaultDir: 'desc' },
  { key: 'returnPct', label: '수익률',  defaultDir: 'desc' },
  { key: 'ticker',    label: '종목',    defaultDir: 'asc' },
  { key: 'pct',       label: '비율',    defaultDir: 'desc' }
];

function renderLegendSortUI() {
  const wrap = document.getElementById('legend-sort');
  wrap.innerHTML = `<span class="legend-sort-label">정렬:</span>` +
    LEGEND_SORT_OPTIONS.map(opt => {
      const active = legendSort.key === opt.key;
      const dirInd = active ? `<span class="dir-ind">${legendSort.dir === 'asc' ? '▲' : '▼'}</span>` : '';
      return `<button class="legend-sort-btn ${active ? 'active' : ''}" onclick="toggleLegendSort('${opt.key}')">${opt.label}${dirInd}</button>`;
    }).join('');
}

function toggleLegendSort(key) {
  if (legendSort.key === key) {
    legendSort.dir = legendSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    legendSort.key = key;
    const opt = LEGEND_SORT_OPTIONS.find(o => o.key === key);
    legendSort.dir = opt?.defaultDir || 'desc';
  }
  renderLegendSortUI();
  drawChart();
}

function sortHoldingsForLegend(holdings, amountKey) {
  const sorted = [...holdings];
  sorted.sort((a, b) => {
    let va, vb;
    if (legendSort.key === 'ticker') {
      va = (a.tickerFull || a.ticker || '').toUpperCase();
      vb = (b.tickerFull || b.ticker || '').toUpperCase();
      return legendSort.dir === 'asc' ? va.localeCompare(vb, 'ko') : vb.localeCompare(va, 'ko');
    }
    if (legendSort.key === 'amount' || legendSort.key === 'pct') {
      va = a[amountKey] || 0; vb = b[amountKey] || 0;
    } else if (legendSort.key === 'returnPct') {
      va = a.returnPct != null ? a.returnPct : -Infinity;
      vb = b.returnPct != null ? b.returnPct : -Infinity;
    }
    return legendSort.dir === 'asc' ? va - vb : vb - va;
  });
  return sorted;
}

// ========== 차트 기준 (평가 / 매수) ==========
let chartBasis = localStorage.getItem('portfolio_basis_v1') || 'value';

function setChartBasis(basis) {
  chartBasis = basis;
  localStorage.setItem('portfolio_basis_v1', basis);
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.basis === basis);
  });
  drawChart();
}

// ========== 행별 수익률 표시 ==========
// ========== KPI 카드 업데이트 ==========
function fmtKRW(v) {
  return '₩' + Math.round(v).toLocaleString('ko-KR');
}
function updateKPIs(all) {
  const totalBuy = all.reduce((s, h) => s + (h.buyKRW || 0), 0);
  const totalValue = all.reduce((s, h) => s + (h.valueKRW || 0), 0);
  const pnl = totalValue - totalBuy;
  const roi = totalBuy > 0 ? (pnl / totalBuy) * 100 : 0;
  const buyEl = document.getElementById('kpi-buy');
  const valEl = document.getElementById('kpi-value');
  const pnlEl = document.getElementById('kpi-pnl');
  const roiEl = document.getElementById('kpi-roi');
  const buySub = document.getElementById('kpi-buy-sub');
  const pnlSub = document.getElementById('kpi-pnl-sub');
  buyEl.textContent = totalBuy > 0 ? fmtKRW(totalBuy) : '-';
  valEl.textContent = totalValue > 0 ? fmtKRW(totalValue) : '-';
  buySub.textContent = `종목 ${all.filter(h => h.valueKRW > 0 || h.buyKRW > 0).length}개`;
  if (totalBuy > 0) {
    const sign = pnl >= 0 ? '+' : '-';
    pnlEl.textContent = sign + fmtKRW(Math.abs(pnl));
    pnlEl.style.color = pnl >= 0 ? 'var(--up)' : 'var(--down)';
    pnlSub.textContent = `${pnl >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
    pnlSub.className = 'kpi-sub ' + (pnl >= 0 ? 'up' : 'down');
    roiEl.textContent = `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
    roiEl.style.color = roi >= 0 ? 'var(--up)' : 'var(--down)';
  } else {
    pnlEl.textContent = '-';
    pnlEl.style.color = '';
    pnlSub.textContent = '-';
    pnlSub.className = 'kpi-sub';
    roiEl.textContent = '-';
    roiEl.style.color = '';
  }
}

// ========== 차트 그리기 ==========
function drawChart() {
  const all = readHoldings();
  updateKPIs(all);
  // 기준에 따라 비중 계산용 금액 키 선택
  const amountKey = chartBasis === 'buy' ? 'buyKRW' : 'valueKRW';
  // 도넛은 항상 비율 큰 조각부터 그림 (시계방향, 12시 시작) — 시각적 일관성
  const holdings = all.filter(h => h[amountKey] > 0)
                      .sort((a, b) => b[amountKey] - a[amountKey]);
  const svg = document.getElementById('chart');
  const legend = document.getElementById('legend');
  svg.innerHTML = '';
  legend.innerHTML = '';

  if (holdings.length === 0) return;

  const total = holdings.reduce((s, h) => s + h[amountKey], 0);
  // 종목별 색상을 (도넛 순서 = 비율 순) 고정해서 레전드와 일치시키기 위한 맵
  const colorMap = {};
  holdings.forEach((h, i) => { colorMap[h.tickerFull || h.ticker] = PALETTE[i % PALETTE.length]; });

  const cx = 200, cy = 200, rOuter = 150, rInner = 75;
  let angle = -Math.PI / 2;

  holdings.forEach((h, i) => {
    const pct = h[amountKey] / total;
    const sweep = pct * Math.PI * 2;
    const a1 = angle;
    const a2 = angle + sweep;
    const color = colorMap[h.tickerFull || h.ticker];

    const x1o = cx + rOuter * Math.cos(a1);
    const y1o = cy + rOuter * Math.sin(a1);
    const x2o = cx + rOuter * Math.cos(a2);
    const y2o = cy + rOuter * Math.sin(a2);
    const x1i = cx + rInner * Math.cos(a2);
    const y1i = cy + rInner * Math.sin(a2);
    const x2i = cx + rInner * Math.cos(a1);
    const y2i = cy + rInner * Math.sin(a1);
    const largeArc = sweep > Math.PI ? 1 : 0;

    const d = [
      `M ${x1o} ${y1o}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2o} ${y2o}`,
      `L ${x1i} ${y1i}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x2i} ${y2i}`,
      'Z'
    ].join(' ');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', color);
    path.setAttribute('stroke', '#fff');
    path.setAttribute('stroke-width', '2');
    // 마우스 hover 시 커스텀 툴팁 표시 — 작은 조각이라 라벨 못 본 정보도 확인 가능
    path.addEventListener('mouseenter', () => showChartTooltip(h, pct, color));
    path.addEventListener('mousemove', (e) => positionChartTooltip(e));
    path.addEventListener('mouseleave', hideChartTooltip);
    // 모바일: 탭으로 툴팁 토글 (hover 없는 환경)
    path.addEventListener('click', (e) => {
      const tt = document.getElementById('chart-tooltip');
      const wasVisible = !tt.hidden;
      hideChartTooltip();
      if (!wasVisible) {
        showChartTooltip(h, pct, color);
        positionChartTooltip(e);
      }
    });
    svg.appendChild(path);

    if (pct > 0.07) {
      const midAngle = (a1 + a2) / 2;
      const labelR = (rOuter + rInner) / 2;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);

      const tickerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      tickerText.setAttribute('x', lx);
      tickerText.setAttribute('y', ly - 4);
      tickerText.setAttribute('text-anchor', 'middle');
      tickerText.setAttribute('fill', '#fff');
      tickerText.setAttribute('font-size', '12');
      tickerText.setAttribute('font-weight', '700');
      const displayT = h.tickerFull || h.ticker;
      tickerText.textContent = displayT.length > 10 ? displayT.slice(0,9)+'…' : displayT;
      svg.appendChild(tickerText);

      const pctText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      pctText.setAttribute('x', lx);
      pctText.setAttribute('y', ly + 12);
      pctText.setAttribute('text-anchor', 'middle');
      pctText.setAttribute('fill', '#fff');
      pctText.setAttribute('font-size', '13');
      pctText.setAttribute('font-weight', '700');
      pctText.textContent = (pct * 100).toFixed(1) + '%';
      svg.appendChild(pctText);
    }

    angle = a2;
  });

  // 레전드는 별도 정렬 (사용자가 선택한 기준)
  const legendItems = sortHoldingsForLegend(holdings, amountKey);
  legendItems.forEach(h => {
    const pct = h[amountKey] / total;
    const color = colorMap[h.tickerFull || h.ticker];
    const retCls = h.returnPct == null ? '' : (h.returnPct >= 0 ? 'up' : 'down');
    const retText = h.returnPct != null
      ? `${h.returnPct>=0?'+':''}${(h.returnPct*100).toFixed(2)}%`
      : '-';
    const item = document.createElement('div');
    item.className = 'legend-item';
    const mInfo = getMarket(h.market);
    item.innerHTML = `
      <div class="legend-color" style="background:${color}"></div>
      <div class="legend-name">${escapeHtml(h.tickerFull || h.ticker)}</div>
      <div class="legend-market">${mInfo.flag} ${mInfo.short} · ${h.currency}</div>
      <div class="legend-return ${retCls}">${retText}</div>
      <div class="legend-amt">₩${h[amountKey].toLocaleString('ko-KR',{maximumFractionDigits:0})}</div>
      <div class="legend-pct">${(pct*100).toFixed(1)}%</div>
    `;
    legend.appendChild(item);
  });

  const centerLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  centerLabel.setAttribute('x', cx);
  centerLabel.setAttribute('y', cy - 6);
  centerLabel.setAttribute('text-anchor', 'middle');
  centerLabel.setAttribute('fill', '#444');
  centerLabel.setAttribute('font-size', '14');
  centerLabel.setAttribute('font-weight', '600');
  centerLabel.textContent = chartBasis === 'buy' ? '매수 기준' : '평가 기준';
  svg.appendChild(centerLabel);

  const centerVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  centerVal.setAttribute('x', cx);
  centerVal.setAttribute('y', cy + 14);
  centerVal.setAttribute('text-anchor', 'middle');
  centerVal.setAttribute('fill', '#222');
  centerVal.setAttribute('font-size', '15');
  centerVal.setAttribute('font-weight', '700');
  const shortTotal = total >= 1e8
    ? (total/1e8).toFixed(2) + '억'
    : total >= 1e4
    ? (total/1e4).toFixed(0) + '만'
    : total.toFixed(0);
  centerVal.textContent = '₩' + shortTotal;
  svg.appendChild(centerVal);
}

// ========== 도넛 조각 호버 툴팁 ==========
function showChartTooltip(h, pct, color) {
  const tt = document.getElementById('chart-tooltip');
  const mInfo = getMarket(h.market);
  const retHtml = h.returnPct != null
    ? `<span class="${h.returnPct >= 0 ? 'tt-up' : 'tt-down'}">${h.returnPct >= 0 ? '+' : ''}${(h.returnPct*100).toFixed(2)}%</span>`
    : '-';
  const curStr = h.currentPrice ? h.currentPrice.toLocaleString('ko-KR', {maximumFractionDigits: 2}) : '-';
  const buyStr = h.buyPrice ? h.buyPrice.toLocaleString('ko-KR', {maximumFractionDigits: 2}) : '-';
  tt.innerHTML = `
    <div class="tt-ticker"><span style="display:inline-block;width:8px;height:8px;background:${color};border-radius:2px;margin-right:6px;"></span>${escapeHtml(h.tickerFull || h.ticker)}</div>
    <div class="tt-name">${escapeHtml(h.name || '')} · ${mInfo.flag} ${mInfo.short}</div>
    <div class="tt-row"><span class="tt-label">평가금액</span><span class="tt-val">₩${Math.round(h.valueKRW).toLocaleString('ko-KR')}</span></div>
    <div class="tt-row"><span class="tt-label">비중</span><span class="tt-val">${(pct*100).toFixed(2)}%</span></div>
    <div class="tt-row"><span class="tt-label">수익률</span><span class="tt-val">${retHtml}</span></div>
    <div class="tt-row"><span class="tt-label">매수단가</span><span class="tt-val">${buyStr} ${h.currency}</span></div>
    <div class="tt-row"><span class="tt-label">현재가</span><span class="tt-val">${curStr} ${h.currency}</span></div>
    <div class="tt-row"><span class="tt-label">수량</span><span class="tt-val">${h.qty.toLocaleString('ko-KR')}</span></div>
  `;
  tt.hidden = false;
}
function positionChartTooltip(e) {
  const tt = document.getElementById('chart-tooltip');
  // 마우스 우상단을 기준으로 + viewport 경계 보정
  let x = e.clientX;
  let y = e.clientY;
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
  // 우측/상단 잘림 보정 — 한 프레임 후 측정해 조정
  requestAnimationFrame(() => {
    const r = tt.getBoundingClientRect();
    if (r.right > innerWidth - 8) tt.style.left = (innerWidth - 8 - r.width / 2) + 'px';
    if (r.left < 8) tt.style.left = (8 + r.width / 2) + 'px';
    if (r.top < 8) {
      // 위쪽에 공간 없으면 마우스 아래쪽에 표시
      tt.style.transform = 'translate(-50%, 12px)';
    } else {
      tt.style.transform = 'translate(-50%, calc(-100% - 12px))';
    }
  });
}
function hideChartTooltip() {
  document.getElementById('chart-tooltip').hidden = true;
}

// 모바일: 도넛/툴팁 바깥 영역을 탭하면 툴팁 닫힘
document.addEventListener('click', (e) => {
  if (!e.target.closest || (!e.target.closest('#chart path') && !e.target.closest('#chart-tooltip'))) {
    hideChartTooltip();
  }
});

// 화면 회전·리사이즈 시 모바일/데스크탑 전환되면 회사명 표시 재계산
let _resizeT;
window.addEventListener('resize', () => {
  clearTimeout(_resizeT);
  _resizeT = setTimeout(() => {
    renderTable();
  }, 150);
});
