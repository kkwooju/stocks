// ========== 초기화 ==========
async function init() {
  renderFxInputs();

  let source = null;

  // 1순위) 이전에 연결한 파일 핸들 자동 복구 (Chrome/Edge — 권한 'granted'일 때만)
  const handleData = await tryLoadFromHandle();
  if (handleData) {
    const holdings = handleData.holdings || handleData;
    if (Array.isArray(holdings) && holdings.length > 0) {
      HOLDINGS = normalizeHoldings(holdings);
      if (handleData.fx) FX = { ...FX, ...handleData.fx };
      source = 'handle';
    }
  }

  // 2순위) HTTP server에서 같은 폴더의 portfolio_data.json fetch
  if (!source) {
    const fileData = await loadFromFile();
    if (fileData) {
      const holdings = fileData.holdings || fileData;
      if (Array.isArray(holdings) && holdings.length > 0) {
        HOLDINGS = normalizeHoldings(holdings);
        if (fileData.fx) FX = { ...FX, ...fileData.fx };
        source = 'file';
      }
    }
  }

  // 3순위) localStorage
  if (!source) {
    if (loadFromLocal()) source = 'local';
  }

  // 4순위) 기본 예시
  if (!source) {
    HOLDINGS = normalizeHoldings(DEFAULTS);
    source = 'default';
  }

  renderFxInputs();
  renderLegendSortUI();
  setChartBasis(chartBasis);
  updateFileButtons();
  renderTable();

  if (source === 'handle') {
    showSaveStatus(`🔗 ${fileHandle.name} 와 동기화 중 — 변경 시 자동 저장`);
  } else if (source === 'file') {
    showSaveStatus(`📁 ${DATA_FILENAME}에서 로드됨 (읽기 전용) — 🔗 파일 연결로 자동 저장 활성화`);
  } else if (source === 'local') {
    showSaveStatus('💾 로컬 저장본 사용 — 🔗 파일 연결로 .json에 직접 저장 가능');
  } else {
    showSaveStatus('🆕 기본 데이터로 시작 — 🔗 파일 연결 후 자동 저장 사용');
  }

  // 핸들 복구는 됐지만 권한이 'prompt'인 케이스: 사용자가 한 번 클릭하도록 알림
  if (FSA_SUPPORTED && fileHandle && source !== 'handle') {
    showSaveStatus(`🔗 ${fileHandle.name} 권한 필요 — 🔗 버튼 한 번 클릭`, false);
  }

  // file:// 환경이면 API 호출이 거의 무조건 실패 — 사용자에게 즉시 안내하고 자동 갱신 스킵
  if (IS_FILE_PROTOCOL) {
    showSaveStatus('⚠ file:// 모드 — 가격 API 차단됨. start-portfolio.bat 더블클릭으로 실행하세요', true);
    return;
  }
  // 페이지 로드 직후 API로 현재가 자동 갱신
  refreshPrices();
}
init();
