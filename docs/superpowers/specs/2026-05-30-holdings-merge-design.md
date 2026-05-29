# 동일 종목 합산 (계좌별 매수내역 보존) — 설계 문서

- 날짜: 2026-05-30
- 대상 파일: `portfolio.html` (단일 파일 앱)
- 작성: 브레인스토밍 합의 기반

## 1. 문제

A계좌 보유 종목을 입력한 뒤 B계좌 보유 종목을 입력하면, 같은 종목(예: AAPL)이
**서로 다른 행으로 따로 저장**된다. 동일 종목은 하나로 합산되어 **수량 합계 +
가중평균 매수단가 + 재계산된 수익률·평가금액**으로 보여야 하는데 그렇지 않다.

## 2. 합의된 요구사항 (브레인스토밍 결정)

1. **합치되 계좌별 내역 보존** — 표에는 합산 1행, 펼치면 계좌별 원본 내역 표시
2. **계좌명 직접 입력** — 펼침 시 "키움 10주 / 신한 5주"처럼 계좌 라벨로 구분
3. **저장 시 자동 합산** — 종목 추가/저장 시 같은 티커+시장이 이미 있으면 그 종목의
   매수내역으로 자동 합산
4. **계좌 입력은 선택** — 비워도 됨. 단일 계좌/기존 사용자 경험 유지
5. **접근법 A** — 데이터 모델 도입 + 편집은 모달로 일원화 (인라인 셀 편집 제거)

## 3. 현재 아키텍처 요약 (변경 전)

- **DOM이 진실의 원천**: 종목 1개 = `<tr>` 1줄, 셀 안 `<input>`의 `oninput`이 곧 데이터.
- `readHoldings()`가 DOM을 읽어 평가금액·수익률을 계산 → localStorage·차트·KPI가 소비.
- 저장 스키마: 평면 배열 `[{ticker, market, qty, buyPrice, currentPrice, ...}]`.
- `migrateHolding()`: 구 스키마(`069500.KS`+currency) → 신 스키마(`ticker`+`market`).
- 로드 우선순위(`init`): 파일핸들 → fetch한 `portfolio_data.json` → localStorage → `DEFAULTS`.
- 모든 로드 경로가 항목별 `addRow(d)` 호출로 DOM 행 생성.
- 인라인 편집(`syncDisplay`, 셀 `oninput`)과 모달 편집이 공존.

## 4. 데이터 모델 (변경 후)

`let HOLDINGS = []`를 진실의 원천으로 도입. 표는 이 모델에서 렌더.

```js
holding = {
  ticker,        // 'AAPL'  (대문자 본체)
  market,        // 'US' | 'KS' | ...
  name,          // 회사명 (API 갱신)
  currentPrice,  // 종목당 1개 (공유)
  lots: [        // 매수내역(계좌) 배열
    { account: '키움', qty: 10, buyPrice: 280 },
    { account: '신한', qty: 5,  buyPrice: 310 }
  ]
}
```

- **합산 식별 키** = `ticker.toUpperCase() + '|' + market`.
  같은 키면 합산, 다르면 별개. (AAPL 미국 ≠ AAPL 런던)
- `currency`, `tickerFull`은 `market`에서 파생 (저장 안 함, 렌더 시 `getMarket()`로 계산).

### 파생값 (렌더·차트·KPI용, 저장하지 않음)

| 값 | 식 |
|---|---|
| 합산수량 `totalQty` | Σ lot.qty |
| **가중평균 매수가 `avgBuyPrice`** | totalQty>0 ? Σ(lot.qty×lot.buyPrice) ÷ totalQty : 0 |
| 매수금액(KRW) `buyKRW` | Σ(lot.qty×lot.buyPrice) × FX[currency] |
| 평가금액(KRW) `valueKRW` | totalQty × currentPrice × FX[currency] |
| 합산수익률 `returnPct` | (avgBuyPrice>0 && currentPrice>0) ? (currentPrice−avgBuyPrice)/avgBuyPrice : null |
| lot별 수익률 | (currentPrice − lot.buyPrice) / lot.buyPrice |

- 수익률은 **현지통화 기준**(환차익 제외) — 기존 관례 유지.

## 5. 저장 스키마 (변경 후)

```json
{
  "holdings": [
    { "ticker": "AAPL", "market": "US", "name": "Apple Inc.",
      "lots": [ {"account":"키움","qty":10,"buyPrice":280},
                {"account":"신한","qty":5,"buyPrice":310} ] }
  ],
  "fx": { "KRW":1, "USD":1380, ... },
  "savedAt": "2026-05-30T..."
}
```

- 저장은 **원본 lots**만 직렬화(파생값은 저장 안 함, 로드 시 재계산).
- `currentPrice`는 캐시 목적상 holding에 함께 저장 가능(갱신 전 표시용). 선택사항.

## 6. 마이그레이션 / 정규화

**`normalizeHoldings(rawArray) → HOLDINGS[]`** 를 도입하고 **모든 로드 경로**
(파일핸들·fetch·localStorage·import·DEFAULTS·resetData)가 이 함수를 통과한다.

처리 순서:
1. 각 항목에 기존 `migrateHolding()` 적용 (구 스키마 접미사 → market).
2. `lots`가 있으면(신 스키마) 그대로, 없으면 `lots:[{account: d.account||'', qty, buyPrice}]`로 래핑.
3. **키(`ticker|market`)별로 그룹핑해 lots를 이어붙임** → 기존 중복 행도 로드 시 1종목으로 정리.
4. `name`/`currentPrice`는 그룹 내 첫 비어있지 않은 값 사용.

> **결정**: "로드 시 기존 중복 자동 정리"를 **포함**한다. 요구사항 3은 "저장 시 자동 합산"이지만,
> 로드 시 중복을 합쳐두는 것은 레거시 데이터 정리에 유리하고 동작이 일관된다.

계좌명이 비어있는 lot은 펼침 표시에서 "내역 1 / 내역 2"로 자동 라벨링.

## 7. 표 렌더링

`renderTable()`이 `HOLDINGS`로 `#holdings-body`를 다시 그린다.

- **요약 행** (`tr.holding-row`, 종목당 1줄):
  `티커(+계좌 N개 배지) | 시장 | 합산수량 | 평균매수가 | 현재가 | 합산수익률 | ＋ ✕`
  - `lots.length > 1`이면 펼침 토글 **▸/▾** 표시.
- **계좌 하위행** (`tr.lot-row`, 펼쳤을 때만 표시):
  `└ 계좌명 | 수량 | 매수가 | lot수익률 | ✎ ✕` — 들여쓰기 + 연한 배경으로 구분.

차트/레전드/툴팁은 `h.tickerFull || h.ticker` 키를 그대로 사용하므로 합산 holding 기준으로 자동 동작.

## 8. 편집/추가 동작 (모달 일원화)

모달에 **`계좌`(선택 입력)** 필드(`#m-account`)를 시장과 수량 사이에 추가.
모달 컨텍스트를 `modalCtx = { mode, key, lotIndex }`로 관리(기존 `modalRowId`/`modalIsNew` 대체).

| 진입 | mode | 동작 |
|---|---|---|
| **＋종목 추가** | `new` | 전체 입력. 저장 시 같은 키 있으면 lot 추가(토스트 "기존 NAME에 합산됨"), 없으면 신규 holding |
| **요약행 ＋** | `addLot` | 해당 종목에 매수내역 추가 (티커·시장 잠금, 계좌/수량/매수가만 입력) |
| **하위행 탭/✎**, 단일 lot 요약행 탭 | `editLot` | 해당 lot 수정. 티커·시장 변경 시 다른 종목으로 이동·합산 |

- 요약행 **✕** = 종목 전체 삭제(confirm).
- 하위행 **✕** = 그 lot만 삭제. 마지막 lot이면 holding 제거.
- 단일 lot 종목: 펼침 없이 요약행 탭 → 바로 `editLot`.

### 핵심 머지 함수

```
upsertLot({ ticker, market, account, qty, buyPrice }, ref?)
  key = ticker.toUpperCase() + '|' + market
  if ref(editLot) and key 변경됨:
      ref.holding.lots에서 ref.lotIndex 제거 (비면 holding 삭제)
      → 아래 신규/추가 로직으로 진행
  if ref(editLot) and key 동일:
      ref.holding.lots[ref.lotIndex] 갱신
  else:
      target = HOLDINGS에서 key로 검색
      target 있으면 lots.push(lot)
      없으면 HOLDINGS.push({ticker, market, name:'', currentPrice:0, lots:[lot]})
  renderTable(); saveAndDraw(); (신규 티커면 refreshPrices)
```

## 9. 영향 범위 (변경되는 함수)

- `readHoldings()` → DOM이 아닌 `HOLDINGS`에서 파생 배열 생성(출력 형태 유지 +
  `lots`·집계 필드 추가). 차트·KPI·정렬 호출부는 거의 그대로.
- `saveToLocal()` → `readHoldings()`가 아닌 **원본 `HOLDINGS`(lots 포함)** 직렬화.
- `refreshPrices()` → 행이 아닌 holding 단위로 가격·회사명 조회 후 `currentPrice`/`name` 갱신 → `renderTable()`.
- `loadFromLocal()`, `loadFromFile()`, `importJSON()`, `resetData()`, `init()` →
  `addRow(d)` 루프 대신 `HOLDINGS = normalizeHoldings(raw); renderTable()`.
- `openEditModal()`/`saveModal()`/`closeEditModal()`/`deleteFromModal()`/`addRowAndOpenModal()`
  → 모달 컨텍스트 기반으로 재작성, `upsertLot` 호출.
- **제거**: `addRow()`(DOM 행 빌더), `syncDisplay()`, 셀 `oninput` 인라인 편집 경로.
  (필요 시 `addRow`는 `renderTable` 내부 헬퍼로 흡수)
- **DEFAULTS**: 형태 유지(각 단일 lot). `normalizeHoldings` 통과로 자동 래핑.

수정 파일: **`portfolio.html` 하나** (CSS: 하위행/펼침 스타일, HTML: 모달 `계좌` 필드, JS: 위 함수들).
`README.md`는 기능 안내 문단 추가(선택).

## 10. 엣지 케이스

- 계좌명 공란 → 펼침에서 "내역 N" 폴백 라벨.
- 단일 lot → 펼침 토글 없음, 요약행 탭이 곧 편집.
- 마지막 lot 삭제 → holding 제거.
- editLot에서 티커/시장을 다른 기존 종목과 같게 변경 → 해당 종목으로 합산.
- 같은 티커·다른 시장(AAPL 미국 vs AAPL.L) → 키가 달라 합산 안 됨(정상).
- 가중평균·수익률은 현지통화 기준(기존 관례).
- 정렬/레전드: 집계된 holding 기준으로 동작(기존과 동일한 사용자 체감).

## 11. 검증 (테스트 프레임워크 없음 → 브라우저 수동)

1. A계좌 AAPL 10@280 입력 → B계좌 AAPL 5@310 추가 → **15주 / 평균 290** 한 행,
   펼치면 키움·신한 두 내역 표시, lot별 수익률 각각 표시.
2. lot 수정(수량/단가/계좌) → 합산값 즉시 재계산.
3. lot 삭제 → 합산 재계산, 마지막이면 종목 제거.
4. 구버전(중복 행 포함) JSON import → 중복이 1종목으로 합쳐짐.
5. 초기화 → 시연 5종목(각 단일 lot)로 복원.
6. 가격 갱신 → 종목 단위로 현재가/회사명 갱신, 합산·차트 반영.
7. 계좌명 공란으로 2회 입력 → "내역 1/2"로 합산·보존.

## 12. 비목표 (YAGNI)

- 계좌 단위 손익 집계 화면(계좌별 총자산 등) — 이번 범위 아님.
- 매수일자/수수료/세금 필드 — 추가하지 않음.
- 가져오기 시 사용자 선택형 머지 UI — 자동 정규화로 충분.
- 자동 클라우드 동기화 — 기존대로 수동.
