# 주식 포트폴리오 차트

브라우저에서 동작하는 단일 파일 SPA. 보유 종목을 관리하고, Yahoo Finance API로 현재가를 자동 조회해 도넛 차트와 KPI로 비중·수익률을 시각화한다.

## 목차

1. [요약](#1-요약)
2. [파일 구성](#2-파일-구성)
3. [사용 흐름](#3-사용-흐름)
4. [데이터 모델](#4-데이터-모델)
5. [시장 매핑](#5-시장-매핑)
6. [저장 전략 (3단계 폴백)](#6-저장-전략-3단계-폴백)
7. [가격 조회와 CORS 우회](#7-가격-조회와-cors-우회)
8. [차트와 KPI](#8-차트와-kpi)
9. [Launcher와 자동 종료](#9-launcher와-자동-종료)
10. [빌드 / 배포](#10-빌드--배포)
11. [알려진 한계와 트레이드오프](#11-알려진-한계와-트레이드오프)
12. [개발 결정 기록](#12-개발-결정-기록)

> 자동 업데이트 / 배포 전략 정리는 별도 문서 → **[DEPLOYMENT.md](./DEPLOYMENT.md)**

---

## 1. 요약

| 항목 | 설명 |
|---|---|
| 형태 | 단일 HTML 파일 + 단일 .exe launcher |
| 외부 의존성 | (실행 시점) 인터넷, 기본 브라우저 / (빌드 시점) Python 3, PyInstaller |
| 클라이언트 기술 | Vanilla JS, SVG, File System Access API, IndexedDB |
| 데이터 출처 | Yahoo Finance v8 chart API (CORS 프록시 경유) |
| 데이터 저장 | 같은 폴더의 `portfolio_data.json` (1순위) → IndexedDB 파일 핸들 → localStorage → DEFAULTS |
| 라이센스/공유 | 단일 사용자 도구. 다른 사용자에게는 exe + html 두 파일만 전달 |

## 2. 파일 구성

```
portfolio/
├─ portfolio.html              # 메인 페이지 (UI + 모든 로직)
├─ portfolio_data.json         # 보유 종목 데이터 (자동 로드)
├─ portfolio-launcher.exe      # 단일 실행 파일 (콘솔 숨김, 브라우저 자동 오픈)
├─ launcher.py                 # exe 빌드 소스 (Python)
├─ start-portfolio.bat         # 보조 시작 스크립트 (Python 환경 가정)
└─ README.md                   # 이 문서
```

각 파일의 역할:

- **portfolio.html**: 모든 UI와 로직이 들어있는 SPA. localhost로 띄워야 외부 API 호출 가능.
- **portfolio_data.json**: 보유 종목·환율·회사명 등이 저장된 영속 데이터. 페이지가 로드 시 자동 fetch.
- **portfolio-launcher.exe**: Python 인터프리터 + 작은 HTTP 서버가 통째로 패킹된 실행 파일. 더블클릭하면 백그라운드에서 서버 시작 후 브라우저 자동 오픈, 브라우저 탭이 닫히면 자동 종료.
- **launcher.py**: 위 exe의 소스. PyInstaller로 빌드.
- **start-portfolio.bat**: exe 사용 전 단계의 폴백. Python이 시스템에 깔려있어야 함.

## 3. 사용 흐름

### 본인 사용

1. `portfolio-launcher.exe` 더블클릭
2. (백그라운드에서) HTTP 서버 시작 → 기본 브라우저로 `http://localhost:8765/portfolio.html` 자동 오픈
3. 가격 자동 갱신, 보유 종목 편집, 시장 비중 도넛 확인
4. (선택) **🔗 파일 연결**로 `portfolio_data.json`을 직접 자동 저장하도록 핸들 발급
5. 브라우저 탭을 닫으면 launcher 프로세스도 자동으로 백그라운드에서 종료

### 다른 사용자에게 전달

전달할 파일은 단 2개:

- `portfolio-launcher.exe` (≈ 8.2 MB)
- `portfolio.html` (≈ 40 KB)

받은 사용자는 Python 설치 불필요. 같은 폴더에 두고 exe만 더블클릭.

처음 만나는 시스템 메시지:

- **Windows SmartScreen**: "추가 정보 → 실행" (서명 안 된 exe라 1회만)
- **Windows Firewall**: 로컬호스트 통신 허용 (1회만)

## 4. 데이터 모델

`portfolio_data.json` 한 행의 스키마:

```json
{
  "ticker": "BESI",
  "market": "AS",
  "tickerFull": "BESI.AS",
  "name": "BE Semiconductor Industries N.V.",
  "currency": "EUR",
  "qty": 30,
  "buyPrice": 130,
  "currentPrice": 253.3,
  "buyKRW": 5772000,
  "valueKRW": 11246520,
  "returnPct": 0.948,
  "rowId": "row-4"
}
```

| 필드 | 출처 | 비고 |
|---|---|---|
| `ticker` | 사용자 입력 | 시장 접미사를 *뺀* 본체. 영문은 대문자로 정규화 |
| `market` | 사용자 선택 | `MARKETS` 테이블의 코드 (US/KS/T/AS/...) |
| `tickerFull` | 자동 계산 | `ticker + MARKETS[market].suffix` — Yahoo 호출용 |
| `name` | API 응답 | `meta.longName` 또는 `meta.shortName` |
| `currency` | market에서 도출 | KRW 환산용 |
| `qty`, `buyPrice` | 사용자 입력 | 현지 통화 기준 |
| `currentPrice` | API 응답 | 사용자 입력 불가 (읽기 전용 셀) |
| `buyKRW`, `valueKRW` | 자동 계산 | `qty × price × FX[currency]` |
| `returnPct` | 자동 계산 | `(current-buy)/buy` — 현지 통화 기준, 환차익 제외 |

루트의 `fx` 객체는 통화별 KRW 환산 환율. 사용자가 직접 수정 가능.

### 마이그레이션

기존 데이터(통화 컬럼 하나만 있던 옛 스키마)는 페이지 로드 시 자동으로 `migrateHolding()` 함수가 새 스키마로 변환:

- `ticker: '069500.KS'` + `currency: 'KRW'` → 정규식으로 접미사 분리 → `{ ticker: '069500', market: 'KS' }`
- `ticker: 'BESI'` + `currency: 'EUR'` → 접미사 없으면 통화로 시장 추론 → `market: 'AS'`

## 5. 시장 매핑

`MARKETS` 상수가 시장 코드 ↔ Yahoo 접미사 ↔ 통화 ↔ 한글 라벨 ↔ 국기를 한 곳에서 관리.

| 코드 | 국기 | 한글 | Yahoo 접미사 | 통화 |
|---|---|---|---|---|
| US | 🇺🇸 | 미국 | (없음) | USD |
| KS | 🇰🇷 | 코스피 | `.KS` | KRW |
| KQ | 🇰🇷 | 코스닥 | `.KQ` | KRW |
| T | 🇯🇵 | 일본 | `.T` | JPY |
| HK | 🇭🇰 | 홍콩 | `.HK` | HKD |
| SS | 🇨🇳 | 상하이 | `.SS` | CNY |
| SZ | 🇨🇳 | 선전 | `.SZ` | CNY |
| AS | 🇳🇱 | 네덜란드 | `.AS` | EUR |
| L | 🇬🇧 | 영국 | `.L` | GBP |
| PA | 🇫🇷 | 프랑스 | `.PA` | EUR |
| DE | 🇩🇪 | 독일 | `.DE` | EUR |
| MI | 🇮🇹 | 이탈리아 | `.MI` | EUR |
| SW | 🇨🇭 | 스위스 | `.SW` | CHF |

각 항목에 `short`(행/레전드 표시용)와 `long`(드롭다운 풀네임/툴팁) 라벨을 둬서 UI 위치마다 적절한 길이로 표현.

## 6. 저장 전략 (3단계 폴백)

페이지 로드 시 `init()`이 다음 순서로 데이터 소스를 시도:

```
1순위) IndexedDB 파일 핸들 (File System Access API)
       ↓ 핸들 없거나 권한 'prompt'
2순위) ./portfolio_data.json (HTTP fetch)
       ↓ HTTP 환경 아니거나 파일 없음
3순위) localStorage
       ↓ 비어있음
4순위) DEFAULTS (시연용 5종목)
```

상태바에 어느 소스에서 로드됐는지 즉시 표시 → 사용자가 혼동 없이 파악.

### 자동 저장 동작

- **localStorage**: 모든 입력에 대해 즉시 자동 저장 (작업 중 손실 방지)
- **파일 핸들 (FSA)**: 변경 후 2초 디바운스 → 같은 폴더의 `portfolio_data.json`에 직접 쓰기. 다운로드 폴더 우회.
- **💾 저장 버튼**: 핸들이 없으면 한 번에 파일 다운로드. 핸들 있으면 즉시 그 파일에 직접 저장.

### 왜 File System Access API인가

브라우저 보안 정책상 `<a download>` 방식은 항상 OS 기본 다운로드 폴더로만 갑니다. 임의 위치에 쓰는 유일하게 안전한 방법이 FSA — 사용자가 한 번 파일을 선택하면 브라우저가 `FileSystemFileHandle`이라는 권한 토큰을 발급하고, 이후 페이지가 그 핸들로 자동 읽기·쓰기. 핸들은 IndexedDB에 보관해 페이지 재시작에 걸쳐 영속화.

지원: Chrome 86+, Edge 86+. Firefox/Safari는 미지원이라 기존 다운로드 방식으로 자동 폴백.

## 7. 가격 조회와 CORS 우회

Yahoo Finance v8 chart 엔드포인트를 사용:

```
https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d
```

응답의 `chart.result[0].meta`에서 `regularMarketPrice`, `currency`, `longName`, `shortName`, `marketState`를 추출.

### 다중 CORS 프록시 fallback

브라우저는 Yahoo에 직접 호출 불가 (CORS 미허용). 공개 프록시 3개를 순서대로 시도:

```javascript
const PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`
];
```

한 프록시가 실패(rate limit, 일시 다운 등)하면 다음 프록시로 자동 전환. 전체 가용성 = `1 - Π(개별 다운 확률)`.

### 병렬 호출

`Promise.allSettled`로 모든 종목을 동시에 조회. 한 종목이 실패해도 나머지는 정상 진행. 성공·실패 결과를 종목별로 따로 추적해 상태바에 "✓ 5/6 성공 · 실패: XYZ" 형식으로 안내.

### 회사명 표시

API 응답에 이미 회사명이 포함되므로 추가 호출 없음. `meta.longName ?? meta.shortName`을 row의 `dataset.name`과 JSON에 저장 → 다음 페이지 로드 시 API 응답 오기 전에도 즉시 표시.

## 8. 차트와 KPI

### 도넛 차트

외부 라이브러리 없이 **순수 SVG `<path>`** 로 직접 그림:

```
M (시작점) → A (외곽 호, sweep=1) → L → A (내부 호, sweep=0) → Z
```

각 종목 조각에 색상 팔레트(13색)를 인덱스 순환으로 할당.

### 두 가지 비중 기준 (탭 전환)

| 탭 | 분자 | 의미 |
|---|---|---|
| **평가금액 기준** (기본) | `qty × currentPrice × FX` | "현재 내 포지션 비중" |
| **매수금액 기준** | `qty × buyPrice × FX` | "내가 어디에 자본 투입했나" |

두 도넛의 차이가 크면 = 일부 종목이 크게 오르거나 내려서 비중이 변동 = **시각적 리밸런싱 신호**.

### KPI 카드 4종

- 총 매수금액 (KRW)
- 총 평가금액 (KRW)
- 평가손익 (KRW, +/- 색)
- 총 수익률 (%, 현지통화 기준 환차익 제외)

### 한국식 색상

상승 = 빨강 (`var(--up)` = `#dc2626`), 하락 = 파랑 (`var(--down)` = `#2563eb`). 행별 수익률, KPI, 레전드 모두 일관.

## 9. Launcher와 자동 종료

`launcher.py`는 다음을 한다:

1. 자기 위치(`sys.argv[0]`의 dirname)를 web root로 설정
2. 8765부터 빈 포트 자동 탐색
3. `ThreadingTCPServer`로 HTTP 서버 시작
4. 1초 후 기본 브라우저로 `http://localhost:{port}/portfolio.html` 오픈
5. 별도 스레드에서 heartbeat 모니터 시작

### Heartbeat / Shutdown 엔드포인트

서버는 `SimpleHTTPRequestHandler`를 확장해 두 가지 특수 경로를 처리:

| 경로 | 메서드 | 동작 |
|---|---|---|
| `/heartbeat` | GET | `last_heartbeat[0] = time.time()` 갱신 |
| `/shutdown` | POST | `shutdown_requested[0] = True` |

페이지(JS)는 5초마다 `/heartbeat`를 호출. 모니터 스레드는 마지막 heartbeat로부터 15초가 지나면 `server.shutdown()` → 프로세스 종료.

브라우저 탭이 닫히는 순간엔 `pagehide`/`beforeunload` 이벤트에서 `navigator.sendBeacon('/shutdown')`을 호출 → 즉시 종료 신호. `sendBeacon`은 unload 중에도 브라우저가 끝까지 보낼 것을 보장한다.

### 다중 탭 안전

heartbeat 방식은 자연스럽게 다중 탭을 지원. 어느 한 탭이라도 ping을 보내면 서버 살아있음. 마지막 탭이 닫혀야 종료.

### noconsole 안전 패치

`--noconsole` 모드에선 `sys.stdout`/`sys.stderr`가 `None`이 되어 `print()`나 라이브러리 로그 호출이 `AttributeError`. 시작 시 `_NullIO`로 대체해 모든 출력을 조용히 흡수.

## 10. 빌드 / 배포

PyInstaller로 단일 .exe 생성:

```bash
pip install pyinstaller

pyinstaller --onefile --noconsole \
            --name portfolio-launcher \
            --distpath ./dist \
            --workpath ./build \
            --specpath ./build \
            launcher.py
```

| 옵션 | 의미 |
|---|---|
| `--onefile` | 모든 의존성을 .exe 하나에 압축 패킹 |
| `--noconsole` | 콘솔창 띄우지 않음 (백그라운드 실행) |
| `--name` | 출력 파일명 (영문 권장 — 한글 인코딩 회피) |
| `--distpath` / `--workpath` / `--specpath` | 임시 디렉터리를 한 폴더에 모아 정리 쉽게 |

결과물 `dist/portfolio-launcher.exe`를 portfolio 루트로 복사 후 `build/`·`dist/`·`*.spec` 정리. 약 8.2 MB.

## 11. 알려진 한계와 트레이드오프

### file:// 직접 열기 한계

`file://` origin은 브라우저가 외부 cross-origin fetch를 거의 모두 차단한다. 그래서:

- 더블클릭으로 portfolio.html을 직접 열면 → **가격 API 차단** → 갱신 실패
- 페이지 코드에 `IS_FILE_PROTOCOL` 감지 + 친절한 안내 메시지로 즉시 알림
- 정식 사용 경로 = **portfolio-launcher.exe 더블클릭** (HTTP server 환경 보장)

### 가격 지연

Yahoo Finance는 실시간이 아니라 보통 **15분 지연**. 장중 매매 결정용으로는 부정확. KPI 카드의 sub 라벨에 명시.

### 환차익 처리

수익률 계산은 *현지 통화 기준* (환차익 제외). 예: AAPL 매수 $250 → 현재 $409 → +63.6% (한 줄). 다만 KRW 평가금액(`valueKRW`)은 *현재 환율*로 환산해 표시 — 환율 변동이 평가금액에 반영. 매수 시점 환율은 별도 저장 안 함.

### 공개 프록시 신뢰성

corsproxy.io, allorigins.win 모두 무료 공개 서비스라 일시적 다운/rate limit 발생 가능. 다중 fallback으로 완화하지만 영구적 안정성이 필요하면 본인의 Cloudflare Worker로 대체 권장.

### Windows Defender SmartScreen

서명 안 된 exe는 처음 보는 사용자에게 "알 수 없는 게시자" 경고가 뜬다. "추가 정보 → 실행"으로 우회 가능하지만 매번 첫 사용자에게 한 번씩 발생. 코드 서명 인증서가 있어야 영구 해결.

## 12. 개발 결정 기록

다음 결정들은 트레이드오프 끝에 채택. 의도를 잊지 않도록 기록.

### 단일 HTML 파일

- 외부 빌드 도구·번들러 없이 누구나 텍스트 에디터로 수정 가능
- 의존성 폭주 없음, 보안 검토 쉬움
- 대신 코드량이 한 파일에 누적 → 1000줄 넘으면 분리 검토 필요

### Vanilla JS / 프레임워크 없음

- React/Vue 도입 시 빌드 단계 필요 → 단일 HTML 원칙과 충돌
- 도넛 차트도 직접 SVG로 그리는 게 라이브러리 도입보다 코드량 적음

### 통화 컬럼 → 시장 컬럼 변경

- 통화는 시장에서 도출 가능 (KS→KRW, AS→EUR…) → 컬럼 분리는 중복
- 사용자가 `.KS`/`.AS` 같은 Yahoo 접미사를 외울 필요 없음
- 시장 = 한글 라벨로 표시해 직관성 ↑

### 행 표시/편집 모드 분리

- 평소엔 텍스트, 편집 시에만 입력 폼이 더 시각적으로 깔끔
- 동일 셀에 `<span class="cell-display">`와 `<input class="cell-edit">`을 모두 두고 부모 `.editing` 클래스 토글로 전환
- input은 항상 SoT(단일 진실 공급원) — `readHoldings`/`saveToLocal` 등 데이터 로직은 그대로

### 영문 티커 대문자 정규화

- CSS `text-transform: uppercase`로 시각, JS `toUpperCase()`로 저장 데이터까지 일관
- 한글·숫자(005930·삼성전자)는 `toUpperCase()`에 영향 없음 → 안전

### scrollbar 시각 숨김

- `html { scrollbar-width: none }` + `::-webkit-scrollbar { display: none }`
- 스크롤 동작 자체는 유지되어 콘텐츠 길이가 늘어도 OK

### 자동 다운로드 안 함

- 모든 변경마다 파일 다운로드되면 OS 알림 폭주
- 명시적 💾 버튼 + (FSA 지원 시) 디바운스 자동 저장이 균형점

### exe 빌드 시 한글 회피

- 출력 파일명·옵션은 모두 영문
- 작업/임시 폴더(`build`, `dist`)도 영문이라 인코딩 이슈 없음
- 단, 작업 디렉터리 경로(`D:\projects\주식\portfolio`)에 한글이 있어도 PyInstaller 6.x는 안정적

### 한국식 색상

- 상승 = 빨강, 하락 = 파랑 (미국·유럽과 반대)
- CSS 변수 `--up`/`--down`으로 한 곳에서 관리 → 변경 쉬움
