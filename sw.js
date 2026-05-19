// 최소 Service Worker — PWA 설치 가능성 활성화 + 즉시 활성화
// 캐시 전략은 의도적으로 안 함: 가격/환율은 항상 최신이어야 하고 페이지도 자주 갱신됨
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* 패스스루: 네트워크 직행, 캐시 X */ });
