// ========== file:// 프로토콜 감지 — 외부 API 호출이 차단되므로 안내 ==========
const IS_FILE_PROTOCOL = location.protocol === 'file:';

// ========== 인앱 브라우저 감지 (카카오톡/네이버/페이스북/인스타 등) ==========
function isInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /KAKAOTALK|NAVER\(inapp|FBAN|FBAV|FB_IAB|Instagram|Line\//i.test(ua);
}

function openInExternalBrowser() {
  const url = location.href;
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    // Android: Chrome intent URL로 직접 호출
    const host = location.host;
    const path = location.pathname + location.search;
    const intent = `intent://${host}${path}#Intent;scheme=https;package=com.android.chrome;end`;
    location.href = intent;
  } else if (/KAKAOTALK/i.test(ua)) {
    // iOS 카카오톡: 외부 브라우저 호출 스킴 시도
    location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
    setTimeout(() => {
      alert('카카오톡 우측 상단 메뉴 ⋯ → "다른 브라우저로 열기"를 선택해주세요.');
    }, 1500);
  } else {
    // 그 외 iOS 인앱(인스타·페북 등): 안내만
    alert('우측 상단 메뉴 → "Safari로 열기" 또는 "외부 브라우저로 열기"를 선택해주세요.');
  }
}

function dismissInAppBanner() {
  document.getElementById('inapp-banner').hidden = true;
  try { sessionStorage.setItem('inapp-banner-dismissed', '1'); } catch (e) {}
}

// 페이지 로드 시 체크 — 인앱이고 같은 세션에서 dismiss 안 됐으면 배너 표시
window.addEventListener('DOMContentLoaded', () => {
  if (isInAppBrowser() && !sessionStorage.getItem('inapp-banner-dismissed')) {
    document.getElementById('inapp-banner').hidden = false;
  }
});

// ========== 뷰 전환 (홈 ↔ 사용방법) ==========
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => {
    v.hidden = v.id !== 'view-' + view;
  });
  document.querySelectorAll('.bottom-nav .nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ========== PWA 설치 ==========
// "이미 앱 모드(홈 화면 아이콘에서 실행)"이면 설치 버튼 숨김 — 설치 의미 없음
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true
      || document.referrer.startsWith('android-app://');
}

let deferredInstallPrompt = null;

// 헤더 + 탭바 두 install 버튼을 한 번에 토글
function setInstallBtnHidden(hidden) {
  document.querySelectorAll('.install-btn').forEach(b => { b.hidden = hidden; });
}

// Chrome/Edge/Android: 설치 가능 시점 이벤트 → prompt 보관 + 버튼 표시
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isStandalone()) setInstallBtnHidden(false);
});

// 설치 완료 → 두 버튼 모두 숨김 (다음 standalone 진입 시에도 안 보임)
window.addEventListener('appinstalled', () => {
  setInstallBtnHidden(true);
  deferredInstallPrompt = null;
});

async function installPWA() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') setInstallBtnHidden(true);
    deferredInstallPrompt = null;
    return;
  }
  // iOS Safari는 beforeinstallprompt 미지원 — 수동 안내
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) {
    alert('iPhone/iPad에서는 Safari 하단의 공유 버튼 □↑ 을 누르고 "홈 화면에 추가"를 선택해주세요.');
  } else {
    alert('브라우저 메뉴에서 "홈 화면에 추가" 또는 "앱 설치"를 선택해주세요.');
  }
}

// 페이지 로드 시 설치 버튼 표시 결정
window.addEventListener('DOMContentLoaded', () => {
  if (isStandalone()) {
    setInstallBtnHidden(true);  // 이미 설치된 앱으로 실행 → 두 버튼 모두 숨김
    return;
  }
  // 모바일이면 install 버튼 항상 표시:
  // - iOS Safari: beforeinstallprompt 미지원 → 안내 alert로 fallback
  // - Android Chrome: beforeinstallprompt 휴리스틱 미충족 시 안내 alert로 fallback,
  //   이벤트 도착 시 deferredPrompt에 저장되어 자동 설치 동작
  const isMobile = /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  if (isMobile) setInstallBtnHidden(false);
});

// Service Worker 등록 — PWA "설치 가능" 판정에 필수 (https + manifest + sw)
if ('serviceWorker' in navigator && !IS_FILE_PROTOCOL) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ========== launcher 연동: heartbeat + 페이지 닫힘 시 서버 종료 ==========
// localhost로 띄운 launcher만 /heartbeat과 /shutdown 엔드포인트를 가지고 있음.
// file:// 또는 외부 서버에서는 무의미하지만 fetch가 실패해도 catch로 무시.
if (!IS_FILE_PROTOCOL && location.hostname === 'localhost') {
  // 5초마다 ping. 서버는 15초 동안 못 받으면 자동 종료.
  setInterval(() => {
    fetch('/heartbeat', { method: 'GET', cache: 'no-store' }).catch(() => {});
  }, 5000);

  // 페이지 닫힘/탭 닫힘/창 닫힘 시 즉시 종료 신호 (sendBeacon은 unload 중에도 신뢰성 보장)
  const sendShutdown = () => {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/shutdown', new Blob([''], { type: 'text/plain' }));
      } else {
        fetch('/shutdown', { method: 'POST', keepalive: true, body: '' }).catch(() => {});
      }
    } catch (e) { /* 무시 */ }
  };
  window.addEventListener('pagehide', sendShutdown);
  // 일부 브라우저는 pagehide 안 발생, beforeunload는 일부 안 발생 — 양쪽 다 걸어 두기
  window.addEventListener('beforeunload', sendShutdown);
}
