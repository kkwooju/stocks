// ========== 저장/불러오기 ==========
// 저장용 직렬화 — 원본 lots 보존(파생 readHoldings를 저장하면 계좌별 내역이 단일 lot으로 붕괴됨)
function serializeHoldings() {
  return HOLDINGS.filter(h => h.ticker && (h.lots || []).length).map(h => ({
    ticker: h.ticker, market: h.market, name: h.name || '', currentPrice: h.currentPrice || 0,
    lots: h.lots.map(l => ({ account: l.account || '', qty: l.qty, buyPrice: l.buyPrice }))
  }));
}

function saveToLocal() {
  try {
    const holdings = serializeHoldings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
    localStorage.setItem(FX_KEY, JSON.stringify(FX));
    const hhmm = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    if (!fileHandle) showSaveStatus('✓ 저장됨 · ' + hhmm);
    scheduleAutoSave();
  } catch (e) {
    showSaveStatus('⚠ 저장 실패: ' + e.message, true);
  }
}

function loadFromLocal() {
  try {
    const fxRaw = localStorage.getItem(FX_KEY);
    if (fxRaw) FX = { ...FX, ...JSON.parse(fxRaw) };

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        HOLDINGS = normalizeHoldings(data);
        return true;
      }
    }
  } catch (e) { console.error('Load error:', e); }
  return false;
}

function showSaveStatus(msg, isError = false) {
  const el = document.getElementById('save-status');
  el.textContent = msg;
  el.className = 'save-status ' + (isError ? 'error' : 'saved');
}

function saveAndDraw() {
  saveToLocal();
  renderTable();
}

// ========== 파일 동기화 ==========
const DATA_FILENAME = 'portfolio_data.json';
const FSA_SUPPORTED = 'showSaveFilePicker' in window;
let fileHandle = null;           // 연결된 파일 핸들 (FSA 사용 시)
let saveDebounceTimer = null;    // 자동 저장 디바운스

// ----- IndexedDB로 파일 핸들 영속화 -----
function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('portfolio-fs', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPutHandle(handle) {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'main');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbGetHandle() {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get('main');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function dbDeleteHandle() {
  const db = await openHandleDB();
  return new Promise((resolve) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete('main');
    tx.oncomplete = () => resolve();
  });
}

// ----- 핸들 권한 확인/요청 -----
async function ensurePerm(handle, mode = 'readwrite') {
  if (!handle?.queryPermission) return 'granted'; // 권한 API 없는 환경
  let p = await handle.queryPermission({ mode });
  if (p === 'granted') return p;
  if (p === 'prompt') p = await handle.requestPermission({ mode });
  return p;
}

// ----- 사용자가 직접 파일 위치 선택해 연결 -----
async function connectFile(opts = { open: false }) {
  if (!FSA_SUPPORTED) {
    alert('이 브라우저는 직접 저장 기능을 지원하지 않습니다 (Chrome/Edge에서만 작동).\n대신 💾 파일 저장으로 다운로드 후 옆에 두세요.');
    return false;
  }
  try {
    let handle;
    if (opts.open) {
      // 기존 파일 선택해 연결
      [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON 데이터', accept: { 'application/json': ['.json'] } }],
        excludeAcceptAllOption: false,
        multiple: false
      });
    } else {
      // 새 파일 위치 지정 (또는 기존 파일 덮어쓰기)
      handle = await window.showSaveFilePicker({
        suggestedName: DATA_FILENAME,
        types: [{ description: 'JSON 데이터', accept: { 'application/json': ['.json'] } }]
      });
    }
    const perm = await ensurePerm(handle, 'readwrite');
    if (perm !== 'granted') {
      alert('파일 쓰기 권한이 거부되었습니다.');
      return false;
    }
    fileHandle = handle;
    await dbPutHandle(handle);
    showSaveStatus(`🔗 ${handle.name} 와 동기화 — 변경 시 자동 저장`);
    updateFileButtons();
    // 새로 연결한 직후 현재 데이터로 즉시 저장
    await writeToHandle();
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('connectFile error:', e);
    return false;
  }
}

async function disconnectFile() {
  fileHandle = null;
  await dbDeleteHandle();
  showSaveStatus('🔌 파일 연결 해제');
  updateFileButtons();
}

// ----- 연결된 핸들로 직접 쓰기 -----
async function writeToHandle() {
  if (!fileHandle) return false;
  try {
    const perm = await ensurePerm(fileHandle, 'readwrite');
    if (perm !== 'granted') return false;
    const holdings = serializeHoldings();
    const data = { holdings, fx: FX, savedAt: new Date().toISOString() };
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    return true;
  } catch (e) {
    console.warn('writeToHandle error:', e);
    return false;
  }
}

// ----- 디바운스: 입력 도중 매 키마다 쓰지 않고 2초 무변동 후 한 번만 -----
function scheduleAutoSave() {
  if (!fileHandle) return;
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    const ok = await writeToHandle();
    if (ok) {
      const hhmm = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      showSaveStatus(`🔗 ${fileHandle.name} 자동 저장 · ${hhmm}`);
    }
  }, 2000);
}

// ----- 페이지 로드 직후: 핸들 복구 + 권한 확인 + 읽기 -----
async function tryLoadFromHandle() {
  if (!FSA_SUPPORTED) return null;
  const handle = await dbGetHandle().catch(() => null);
  if (!handle) return null;
  // queryPermission은 reload 직후엔 'prompt'가 흔함 — 사용자 동의 한 번 필요할 수도
  const p = await handle.queryPermission?.({ mode: 'readwrite' }).catch(() => 'denied');
  if (p === 'granted') {
    try {
      const file = await handle.getFile();
      const text = await file.text();
      fileHandle = handle;
      return JSON.parse(text);
    } catch (e) {
      console.warn('handle read failed:', e);
    }
  } else {
    // 권한 prompt 상태 — 사용자에게 클릭 한 번 요청 후 재시도되도록 핸들만 살려둠
    fileHandle = handle; // 권한 prompt가 필요하다고 표시
  }
  return null;
}

// portfolio.html과 같은 폴더의 JSON을 자동 fetch (HTTP server에서만 동작)
async function loadFromFile() {
  // 공개 호스팅(.github.io, .vercel.app 등)엔 개인 데이터 파일 없음 — 404 콘솔 노이즈 회피
  if (/\.github\.io$|\.vercel\.app$|\.netlify\.app$|\.pages\.dev$/.test(location.hostname)) return null;
  try {
    const res = await fetch('./' + DATA_FILENAME, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function updateFileButtons() {
  const connectBtn = document.getElementById('btn-connect');
  if (!connectBtn) return;
  if (!FSA_SUPPORTED) {
    connectBtn.style.display = 'none';
    return;
  }
  if (fileHandle) {
    connectBtn.textContent = '🔗 ' + fileHandle.name;
    connectBtn.title = '클릭: 연결 해제';
    connectBtn.onclick = () => disconnectFile();
  } else {
    connectBtn.textContent = '🔗 파일 연결';
    connectBtn.title = '파일을 직접 선택하면 같은 위치에 자동 저장됩니다 (다운로드 폴더 X)';
    connectBtn.onclick = () => connectFile();
  }
}

// ========== JSON 내보내기/불러오기 ==========
async function exportJSON() {
  // 핸들 연결되어 있으면 그 파일에 직접 저장 (다운로드 폴더 우회)
  if (fileHandle) {
    const ok = await writeToHandle();
    if (ok) {
      const hhmm = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      showSaveStatus(`✓ ${fileHandle.name} 저장 · ${hhmm}`);
      return;
    }
  }
  // FSA 지원 환경이면 핸들 연결 권유, 아니면 다운로드 fallback
  if (FSA_SUPPORTED && !fileHandle) {
    const ok = await connectFile();
    if (ok) return;
  }
  // Fallback: 다운로드 폴더로
  const holdings = serializeHoldings();
  const data = { holdings, fx: FX, savedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = DATA_FILENAME;
  a.click();
  URL.revokeObjectURL(url);
  showSaveStatus(`💾 ${DATA_FILENAME} 다운로드 (브라우저 미지원) — portfolio.html 옆에 두세요`);
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const holdings = data.holdings || data;
      if (!Array.isArray(holdings)) throw new Error('잘못된 형식');

      HOLDINGS = normalizeHoldings(holdings);
      expandedKeys.clear();
      if (data.fx) { FX = { ...FX, ...data.fx }; renderFxInputs(); }
      saveAndDraw();
      alert('✓ 불러오기 완료: ' + holdings.length + '개 종목');
    } catch (err) {
      alert('불러오기 실패: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function resetData() {
  if (!confirm('저장된 데이터를 모두 지우고 기본 예시로 되돌립니다. 계속할까요?')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(FX_KEY);
  expandedKeys.clear();
  FX = { ...DEFAULT_FX };
  renderFxInputs();
  HOLDINGS = normalizeHoldings(DEFAULTS);
  saveAndDraw();
}
