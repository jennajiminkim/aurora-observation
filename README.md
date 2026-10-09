# Aurora Observation Terminal

핀란드 북부 라플란드 Kilpisjärvi 관측소 콘셉트의 ASCII animation 실시간 정보판입니다.

## 주제

- 값 하나: Kilpisjärvi 주변 NOAA OVATION aurora grid 값에서 뽑은 `Aurora Activity`
- 단위: `pt`
- 공개 원천: NOAA SWPC OVATION Aurora Forecast JSON
- 기준 시간대: `Asia/Seoul`
- 저장 방식: 브라우저 `localStorage`
- 비밀키: 없음

## 사용 방법

1. GitHub 저장소에 이 폴더의 파일을 그대로 업로드합니다.
2. GitHub Pages를 켜고 `index.html`을 공개합니다.
3. 새 시크릿 창에서 결과물 주소를 열고 `Fetch live data`를 누릅니다.
4. 다른 KST 날짜에 다시 조회하면 같은 날짜는 갱신, 다음 날짜는 새 기록으로 저장됩니다.

## 카드 3 고정자산

`assets/studio-task-assets/t04-real-information-board/` 안에 제공된 public fixture 꾸러미를 포함했습니다.
화면의 `SYNTHETIC FAILURE REPLAY / CARD 3` 영역에서 느림·401/403·429·오프라인·스키마 변경·복구를 합성 fixture로 재생할 수 있습니다.

## 데이터 실패 처리

실패가 발생하면 마지막 정상값을 삭제하지 않고 `stale / error_code` 상태로 표시합니다. 오류 종류별로 timeout, auth, rate_limit, offline, schema_error를 구분합니다.

## 제출 확인 문구 초안

### 짧은 확인 방법 4줄

1. 어디로 가나요: GitHub Pages 결과물 주소로 갑니다.
2. 3단계 이내 무엇을 하나요: 새 시크릿 창에서 열기 → `Fetch live data` 클릭 → `AURORA ACTIVITY`와 기록 표 확인.
3. 무엇이 보이면 통과인가요: 값, 단위, 출처, 출처 시각, 조회 시각, 기준 시간대, 어제 대비 값이 보입니다.
4. 안 될 때 무엇이 보이나요: 마지막 정상값은 남고 `STALE / timeout·auth·rate_limit·offline·schema_error` 중 하나가 보입니다.

### AI와 나의 판단 3줄

1. AI에게 맡긴 일: 공개 API 후보 조사, NOAA 데이터 구조에 맞는 정규화·저장·실패 재생 코드 초안 작성.
2. 직접 판단한 일: 주제를 북부 라플란드 오로라 관측소로 정하고 ASCII animation 관측 장비 스타일을 선택.
3. AI 제안을 따르지 않은 일: 레퍼런스의 한자 부유 효과는 너무 비슷해 보여 제외하고, 실제 오로라 데이터에 반응하는 하늘 애니메이션으로 바꿈.

## v2.5 ASCII 장면 중앙 정렬 수정

- CSS만 정렬하는 대신 관측 장면의 실제 가용 폭과 고정폭 문자 너비를 브라우저에서 측정해 ASCII 열 수를 자동 결정합니다.
- 화면 크기 변경 시 열 수를 다시 계산하며, 관측소는 각 행마다 중앙축을 기준으로 배치합니다.
- 산맥·지평선은 장면 양쪽 끝까지 그리고, 오른쪽 공백은 유지합니다.
- 변경 파일: `index.html`, `styles.css`, `app.js` (공개 고정자산·실제 데이터 처리 로직은 변경하지 않음).
- **주의**: 저장 기록은 해당 브라우저의 localStorage에 있습니다. 기존 기록 보존을 위해 화면 하단의 `Export review JSON`으로 먼저 백업하고, 동일한 GitHub Pages 주소에서 업데이트하세요. 새 경로로 파일을 열면 이전 브라우저 저장 기록이 표시되지 않을 수 있습니다.

## v2.6 — Aurora Preview & Browser Event Capture (2026-10)

### PREVIEW MODE (synthetic; safe)

- Click `PREVIEW MODE` in the command bar. A dedicated modal opens using the **same** `buildAuroraGrid()` ASCII generator as the real scene.
- Move the 0–100 pt slider or select LOW 4 / MODERATE 35 / ACTIVE 65 / STORM 85.
- The modal prominently says **SIMULATED / NOT SAVED**. These values are *never* sent to NOAA, the real `aot_live_records_v1` daily record, or the event archive.
- Click `Return to LIVE` or press Escape. The live reading in the main board continues independently. The actual NOAA API may continue updating while preview is open.

### Browser automatic monitoring / captures

- On opening the page, the browser requests NOAA once and then approximately **every 15 minutes** while it stays open. Returning to a tab after suspension triggers an overdue request. Browser throttling, offline status, and tab closure can delay or stop requests. **This is not 24/7 server-side monitoring.**
- For a successfully parsed **real NOAA OVATION** forecast at/above **65 pt**, capture the ASCII renderer's real score/frame and its source/fetch timestamps into `localStorage` key `aot_aurora_events_v1`.
- Snapshot is a frozen **ASCII text-and-color frame**, not an all-sky camera photograph or independently verified visible aurora; `pt` is this project's locally derived grid score, and the 65pt threshold is a project rule, not NOAA's official alert scale.
- A prolonged >=65pt period creates **one event only**. Allow another capture after **two separate NOAA forecast timestamps** both show <60pt, followed by a new >=65pt reading. Repeated fetches returning the same forecast timestamp do not count toward re-arming.
- The last **40** captured events are retained in this browser. Select an event from `AURORA EVENT ARCHIVE` to view its frozen 45-line ASCII frame, source time, fetched time, and value. Export a PNG snapshot or a standalone offline HTML snapshot.
- Daily records (`aot_live_records_v1`) and public synthetic test fixtures (`aot_fixture_records_v1`) are **independent** of captured events. `Clear live records` affects only daily records; it does not erase captured events. `Export review JSON` includes the event archive separately.
- Privacy: no accounts or personal records. All capture information is saved locally in the current browser. Changing file URL/origin, browser storage cleaning, private/incognito sessions, or switching devices can hide/remove saved events.

### Verify without faking NOAA evidence

1. In a secret browser window, open GitHub Pages and confirm `AURORA ACTIVITY` / source / source timestamp / fetch timestamp / `Asia/Seoul`.
2. Click `PREVIEW MODE`, drag to **85pt**, verify `STORM` and visibly stronger ASCII aurora, then close. Confirm real score and daily rows are unchanged and that no event was added by preview.
3. The event archive remains empty until a **real** >=65pt forecast is received while the browser is monitoring; no fake capture is added for demonstration. A captured row contains timestamp, score, and the full frozen ASCII frame.
4. Independently run the five Card 3 failure fixtures and `Recover D2`; the capture archive must not gain synthetic events. On another **real** KST date, recheck actual daily record counts and values per Card 5.

### Deployment/backup

Keep the same public GitHub Pages URL and browser origin to preserve saved daily/event records. **Before replacing files, click `Export review JSON` to back up real daily records.** This output is a backup/evidence file, not a one-click import mechanism. Do not replace the provided Card 3 assets; their SHA-256 values are unchanged (see `docs/hash-check.txt`).
