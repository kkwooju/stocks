# 자동 업데이트 / 배포 전략

코드를 수정하면 이미 배포된 사용자도 *별도 행동 없이* 새 버전을 보게 만드는 방법 정리.

> **현재 상태**: `portfolio.html` + `portfolio-launcher.exe`를 zip으로 묶어 사용자에게 전달. 수정 사항 반영하려면 새 zip 재전달 필요.
>
> **목표**: 코드 변경 → push 한 번 → 모든 사용자가 다음 실행 시 자동으로 새 버전.

---

## 목차

1. [자동 업데이트의 본질](#1-자동-업데이트의-본질)
2. [3가지 옵션 비교](#2-3가지-옵션-비교)
3. [옵션 A — 웹 호스팅](#3-옵션-a--웹-호스팅)
4. [옵션 B — launcher 자동 fetch](#4-옵션-b--launcher-자동-fetch)
5. [옵션 C — 하이브리드](#5-옵션-c--하이브리드)
6. [캐시 / 버전 전략](#6-캐시--버전-전략)
7. [사용자 데이터 보존](#7-사용자-데이터-보존)
8. [롤백 / 핫픽스](#8-롤백--핫픽스)
9. [보안 / 인증](#9-보안--인증)
10. [단계적 도입 권장 경로](#10-단계적-도입-권장-경로)
11. [의사결정 체크리스트](#11-의사결정-체크리스트)

---

## 1. 자동 업데이트의 본질

자동 업데이트가 가능한지 여부는 **"코드가 어디에 사느냐"** 에 달렸다.

| 현재 | 자동 업데이트 가능 형태 |
|---|---|
| 사용자 디스크의 `portfolio.html` | (X) 사용자가 새 파일 받아 덮어써야 함 |
| 원격 서버의 `portfolio.html` | (O) 사용자는 `fetch`만 하면 항상 최신 |

따라서 모든 자동 업데이트 전략의 공통 토대는:

> **portfolio.html을 한 곳(원격)에 두고, 모든 사용자의 클라이언트가 거기서 읽어오게 한다.**

원격은 GitHub Pages 같은 정적 호스팅이면 충분 — 비용 0, 대역폭 충분, push로 배포.

차이는 *클라이언트가 그 원격을 어떻게 부르느냐* — 직접 URL로 가느냐, exe가 fetch해서 로컬에 캐시하느냐.

## 2. 3가지 옵션 비교

| | A. 웹 호스팅 | B. launcher fetch | C. 하이브리드 |
|---|---|---|---|
| **사용자 진입점** | 북마크 URL | exe 더블클릭 | 둘 다 |
| **인터넷 의존도** | 항상 필요 | 가격 조회 시점만 (코드는 캐시) | 사용 방식별 |
| **오프라인 동작** | ❌ | ✅ 마지막 캐시로 동작 | 부분 |
| **자동 업데이트 트리거** | 페이지 새로고침 | exe 재실행 | 둘 다 |
| **모바일/태블릿 지원** | ✅ | ❌ (Windows 한정) | 부분 |
| **사용자 데이터 위치** | 호스팅 도메인의 localStorage 또는 FSA | 로컬 `portfolio_data.json` | 두 방식 공존 |
| **셋업 작업량** | 작음 (repo + Pages 활성화) | 중간 (launcher 코드 + 재빌드) | 두 작업 합 |
| **반영 시간** | ~1분 (CI) | 즉시 (다음 실행) | 즉시 |
| **launcher.exe 자체 업데이트** | 해당 없음 | ❌ 별도 메커니즘 필요 | ❌ 동일 |

## 3. 옵션 A — 웹 호스팅

### 핵심 아이디어

`portfolio.html`을 GitHub Pages (또는 Vercel/Netlify/Cloudflare Pages) 에 올린다. 사용자는 그 URL을 북마크하고 매번 접속.

### 사용자 흐름

```
사용자: 북마크 클릭 또는 즐겨찾기에서 사이트 오픈
브라우저: https://<user>.github.io/portfolio/ 로딩
        → 자동으로 최신 portfolio.html 받음
페이지: 가격 자동 갱신, 데이터는 localStorage 또는 FSA에서 복원
```

### 셋업 단계 (GitHub Pages)

```bash
# 1) GitHub repo 생성 + 코드 push
cd /d/projects/주식/portfolio
git init
git add portfolio.html README.md DEPLOYMENT.md
git commit -m "init"
gh repo create portfolio --public --source=. --remote=origin --push
# 또는 GitHub 웹에서 repo 만든 뒤
# git remote add origin https://github.com/<user>/portfolio.git
# git push -u origin main

# 2) Pages 활성화 (gh CLI 사용)
gh repo edit --enable-pages --pages-branch main
# 또는 GitHub 웹: Settings → Pages → Source: Deploy from a branch → main → /

# 3) 1~2분 후 https://<user>.github.io/portfolio/portfolio.html 접속 가능
```

### 셋업 단계 (Vercel - 더 빠른 배포 + 커스텀 도메인 쉬움)

```bash
# 1) GitHub repo는 위와 동일하게 생성
# 2) vercel.com 에서 "Import Project" → GitHub repo 선택
# 3) Build Command: (없음, 정적 사이트), Output Directory: ./ 그대로
# 4) Deploy 클릭 → 30초 후 your-project.vercel.app/portfolio.html 사용 가능
```

### 장점

- **진짜 자동 업데이트**: `git push` 한 번 → CI가 1분 내 배포 → 사용자 새로고침
- **모바일/태블릿/Mac/Linux 모두 지원**: 브라우저만 있으면 됨
- exe / launcher 부담 0 — 별도 배포 산출물 관리 없음
- 무료, 대역폭 풍부

### 단점

- 인터넷 항상 필요 (가격 API는 어차피 인터넷 필요하긴 함)
- **자동 fetch의 `portfolio_data.json`은 호스팅 도메인엔 없음** → 사용자가 본인 데이터를 가져오려면:
  - 🔗 파일 연결 (File System Access API)로 로컬 파일과 동기화하거나
  - 📂 불러오기 한 번 + 이후 localStorage 자동 저장
- localStorage origin = 호스팅 도메인이라 도메인 바꾸면 데이터 손실 위험 → FSA 권장

### 캐시 주의

GitHub Pages는 CDN 캐시가 있어 push 후 1~2분 지연. 또 브라우저 캐시 때문에 사용자가 새 버전을 못 볼 수도. 해결:

- `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">` 추가
- 또는 빌드 시 `?v=20260519` 같은 cache-buster 쿼리

## 4. 옵션 B — launcher 자동 fetch

### 핵심 아이디어

`launcher.exe`는 그대로 사용자 디스크에 두되, **시작할 때 원격에서 최신 `portfolio.html`을 fetch해 로컬 캐시 갱신**. 그 뒤 평소처럼 로컬 HTTP server로 서빙.

### 사용자 흐름

```
사용자: portfolio-launcher.exe 더블클릭
launcher: GitHub raw URL에서 portfolio.html 다운로드 시도
   ├─ 성공 → 로컬 portfolio.html 덮어쓰기
   └─ 실패 (오프라인 등) → 기존 로컬 파일 그대로 사용
launcher: 평소처럼 HTTP server + 브라우저 오픈
```

### launcher.py에 추가할 로직 (의사 코드)

```python
import urllib.request

REMOTE_HTML = "https://raw.githubusercontent.com/<user>/portfolio/main/portfolio.html"
LOCAL_HTML  = os.path.join(base_dir, "portfolio.html")

def try_update():
    try:
        req = urllib.request.Request(REMOTE_HTML, headers={"User-Agent": "portfolio-launcher"})
        with urllib.request.urlopen(req, timeout=5) as r:
            new_html = r.read()
        # 이전 파일과 다를 때만 쓰기 (디스크 I/O 절약)
        if not os.path.exists(LOCAL_HTML) or open(LOCAL_HTML, "rb").read() != new_html:
            open(LOCAL_HTML, "wb").write(new_html)
    except Exception:
        pass  # 오프라인 / 타임아웃 / 4xx 모두 조용히 무시 → 기존 파일 사용
```

이 함수는 `main()` 시작부에서 한 번 호출. 5초 timeout이라 인터넷이 느려도 launcher 시작이 5초 이상 지연되지 않음.

### 셋업 단계

1. GitHub repo 만들고 `portfolio.html` push (옵션 A의 1단계와 동일)
2. raw URL 확보: `https://raw.githubusercontent.com/<user>/<repo>/main/portfolio.html`
3. `launcher.py`에 위 `try_update()` 함수 추가 + main에서 호출
4. PyInstaller 재빌드: `pyinstaller --onefile --noconsole --name portfolio-launcher launcher.py`
5. 새 exe를 사용자에게 한 번만 배포

이후로는 코드 수정 시:

```bash
# 코드 수정 후
git add portfolio.html
git commit -m "fix: 도넛 라벨 임계값 조정"
git push
# 끝. 사용자가 다음에 exe를 실행하면 자동 적용.
```

### 장점

- 오프라인에서도 마지막 캐시로 동작
- 로컬 HTTP server 환경이라 file:// CORS 이슈 없음
- 사용자 데이터(`portfolio_data.json`)는 로컬에 그대로 — 영속성 명확

### 단점

- **launcher.exe 자체는 자동 업데이트 안 됨**. launcher 로직을 수정하면 새 exe 재배포 필요. 다만 launcher는 거의 변경 없음 (서버 띄우고 fetch만) → 영향 작음.
- Windows 한정 (Mac/Linux용 exe 별도 빌드 필요)
- 모바일/태블릿 미지원

### launcher 자체 업데이트 (선택)

정말 launcher까지 자동 업데이트하려면:

- GitHub Releases API로 최신 버전 확인
- 새 버전 있으면 백그라운드 다운로드
- 다음 실행 시 새 exe로 자가 교체 (`os.rename` + `subprocess.Popen` 트릭)

복잡도가 크므로 보통 launcher는 "한 번 배포 후 거의 안 건드림" 정책으로 가는 게 실용적. portfolio.html만 자동 업데이트되면 90%의 기능 변경을 커버 가능.

## 5. 옵션 C — 하이브리드

### 핵심 아이디어

A의 GitHub Pages 셋업 + B의 launcher fetch를 둘 다 적용. 사용자가 상황에 맞게 선택.

| 시나리오 | 사용자 행동 |
|---|---|
| 데스크탑에서 빠르게 보기 | exe 더블클릭 |
| 모바일/카페에서 잠깐 확인 | URL 북마크 접속 |
| 오프라인 (비행기 등) | exe만 사용 가능 (로컬 캐시) |

### 셋업 단계

1. 옵션 A 셋업 (GitHub repo + Pages 활성화) — 30분
2. 옵션 B 셋업 (launcher 코드 + 재빌드) — 30분

추가 작업량이 거의 없는 이유: A의 GitHub repo + raw URL이 B의 fetch 소스로 그대로 쓰임. 한 번 GitHub에 올리면 둘 다 활용.

### 권장 흐름

대부분의 사용자에게 이 옵션이 가장 안전하다. 단점은 셋업 작업이 두 번이라는 것뿐인데, 30분 + 30분이라 전체 한 시간 이내.

## 6. 캐시 / 버전 전략

### 브라우저 캐시

GitHub Pages는 정적 파일에 캐시 헤더 (보통 10분~1시간). 사용자가 새 버전을 즉시 못 볼 수 있다. 해결책 3가지:

```html
<!-- 옵션 1: HTML 자체에 캐시 무력화 메타 -->
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">

<!-- 옵션 2: cache-buster 쿼리 (HTML 변경 자체로) -->
<!-- 일반적으론 sub-resource(CSS/JS)에만 쓰지만 HTML도 가능 -->

<!-- 옵션 3: Service Worker (과한 수준, 추천 X) -->
```

옵션 1만 추가해도 대부분 해결됨. 우리 페이지엔 이미 launcher 단의 캐시 헤더가 있고, 호스팅 단에 옵션 1을 더하면 이중 안전.

### Launcher 캐시

`launcher.py`의 `try_update()`는 매 실행마다 fetch. 5초 timeout이라 오프라인이면 빠르게 fallback. 변경 없으면 디스크에 쓰지도 않음. 추가 캐시 로직 불필요.

### 버전 표시 (선택)

페이지 어딘가에 빌드 버전을 표시하면 사용자가 *내가 보는 것이 최신인지* 즉시 확인 가능:

```html
<span class="version">v2026.05.19</span>
```

GitHub Actions로 자동 갱신하면 더 좋음 (push 시 날짜로 교체).

## 7. 사용자 데이터 보존

코드가 자동 업데이트되어도 **사용자 보유 종목**(`portfolio_data.json`)은 보존되어야 한다. 각 옵션별 동작:

### 옵션 A (웹 호스팅)

| 저장소 | 보존성 |
|---|---|
| `localStorage` | 같은 도메인 유지 시 안전. 도메인 바꾸면 손실 |
| FSA (🔗 파일 연결) | 로컬 파일 핸들 사용 — 도메인 무관, 영구 보존 |
| 📂 불러오기 / 💾 저장 | 명시적 백업 — 가장 robust |

**권장**: FSA를 첫 사용 시 한 번 설정 + 정기적으로 💾 저장으로 백업.

### 옵션 B (launcher fetch)

- 사용자 디스크의 `portfolio_data.json`이 단일 진실 공급원
- 코드 업데이트로 스키마가 변하면 `migrateHolding()` 함수가 자동 마이그레이션 (이미 구현됨)
- 가장 안정적

### 옵션 C

- B의 `portfolio_data.json` + A의 FSA 둘 다 사용 가능
- 같은 파일에 두 경로로 접근 가능하므로 동기화 일관

### 스키마 마이그레이션 원칙

```javascript
// portfolio.html의 migrateHolding()이 항상 통과 지점
function migrateHolding(d) {
  if (d.market !== undefined) return d; // 새 스키마
  // 옛 스키마 → 새 스키마 변환
  ...
}
```

새 필드 추가 시: 옛 데이터는 *그 필드가 없는 채로* 변환 후 적재. 새 필드는 `null` 또는 기본값으로 채움. 다음 자동 저장 시 새 형태로 기록됨.

필드 제거 시: 옛 데이터의 해당 필드는 무시.

이 원칙을 지키면 어떤 버전 차이도 데이터 손실 없이 통과.

## 8. 롤백 / 핫픽스

### 잘못된 버전 배포했을 때

#### 옵션 A

```bash
# 마지막 정상 커밋으로 revert
git revert HEAD
git push
# 1~2분 후 사용자는 자동으로 이전 버전 복귀
```

또는 GitHub 웹에서 *Releases → 이전 릴리스 → Re-deploy*.

#### 옵션 B

- launcher의 `try_update()`는 *현재 원격* 을 가져옴 → 원격을 revert하면 다음 실행 때 자동으로 옛 버전 복귀
- 사용자가 *이미 새 버전 실행 중*이면 브라우저 닫고 재실행해야 반영

### 사용자별 강제 롤백

특정 사용자에게만 옛 버전 쓰게 하려면:

- 옵션 A: 별도 브랜치/URL 만들기 (`stable.<user>.github.io/portfolio/`)
- 옵션 B: 그 사용자에게만 다른 raw URL을 가리키는 launcher 빌드 제공

복잡도 커서 일반적으로는 안 함. 핫픽스는 *모두에게 동시에* 가는 게 정상.

## 9. 보안 / 인증

### Public vs Private repo

- **Public repo (권장)**: raw URL 직접 접근 가능, 토큰 불필요. 코드는 공개되지만 portfolio.html 자체는 민감 정보 없음 (사용자 데이터는 로컬에만).
- **Private repo**: raw URL 접근에 GitHub 토큰 필요. launcher exe에 토큰 박으면 디컴파일 위험.

### MITM 방어

- `https://` 강제 — GitHub raw도 GitHub Pages도 모두 HTTPS 기본 제공
- launcher의 `urllib.request`는 OS의 인증서 저장소를 사용 → 위변조 방지

### 코드 서명 (선택)

- launcher.exe에 코드 서명 인증서 적용 시 Windows SmartScreen 경고 사라짐
- 인증서 가격: 연 $100~300
- 일반 개인 도구엔 과한 비용 — 보통 안 함

## 10. 단계적 도입 권장 경로

전부 한 번에 안 해도 됨. 작은 것부터 단계 밟기:

### 1단계: GitHub repo만 (10분)

- 코드 백업 효과만으로도 가치 있음
- 변경 이력 추적 (언제 무엇 바꿨는지)
- 아직 자동 업데이트 X. 그러나 모든 후속 단계의 기반

### 2단계: GitHub Pages 활성화 (5분)

- URL 생성됨 → 모바일/태블릿에서도 사용 가능
- 사용자에게 URL만 알려주면 자동 업데이트 활성화
- 옵션 A 완료

### 3단계: launcher fetch 추가 (30분)

- launcher.py에 `try_update()` 추가
- PyInstaller 재빌드
- 새 exe 한 번 배포 → 이후 자동 업데이트
- 옵션 B 완료 (이미 1·2단계 했으면 옵션 C)

### 4단계 (선택): CI/CD

- GitHub Actions: push 시 lint + 자동 배포
- Vercel/Netlify는 GitHub 연동 자동
- 빌드 버전을 페이지에 자동 삽입

각 단계는 다음 단계 안 해도 단독으로 가치 있음. 1단계만 해도 코드 손실 방지 + 변경 추적 + 협업 가능.

## 11. 의사결정 체크리스트

다음 질문에 답하면 본인에게 맞는 옵션이 자동으로 결정됨:

- **모바일/태블릿에서도 보고 싶다?**
  - 예 → 옵션 A 필수 (B 추가는 선택)
  - 아니오 → B만으로도 충분

- **오프라인에서 (인터넷 없이) 가끔 봐야 한다?**
  - 예 → B 필수
  - 아니오 → A 단독 OK

- **사용자 수가 많고 모두에게 새 zip 보내기 번거롭다?**
  - 매우 그렇다 → A 또는 C
  - 1~2명이고 직접 알려주면 됨 → 현재 방식 유지도 가능

- **GitHub 사용에 익숙한가?**
  - 매우 익숙 → 모든 옵션 자유
  - 처음 사용 → 단계적 도입 (1단계부터)

- **launcher.exe 자체도 자동 업데이트되어야 하나?**
  - 그렇다 → 별도 메커니즘 필요 (복잡)
  - 아니다 (대부분 그렇다) → B 또는 C로 충분

### 일반적 권장

- **개인 사용 + 모바일 가끔** → 옵션 A 단독 (가장 단순)
- **개인 사용 + 데스크탑만 + 오프라인 가끔** → 옵션 B 단독
- **친구·가족과 공유, 일관성 중요** → 옵션 C 하이브리드

---

## 부록: 빠른 시작 명령어 모음

```bash
# 1. GitHub repo 만들고 push (gh CLI 사용)
cd /d/projects/주식/portfolio
git init && git add . && git commit -m "init"
gh repo create portfolio --public --source=. --remote=origin --push
gh repo edit --enable-pages --pages-branch main

# 2. Pages URL 확인
gh repo view --web   # 브라우저에서 Settings → Pages 확인

# 3. 코드 수정 후 배포 (반복)
# (파일 수정)
git add portfolio.html
git commit -m "feat: 도넛 라벨 임계값 조정"
git push
# 1~2분 후 사용자가 새로고침하면 새 버전
```

이게 옵션 A의 전부. launcher fetch까지 가려면 별도로 launcher.py에 fetch 코드 추가 후 재빌드만 더 하면 됨.
