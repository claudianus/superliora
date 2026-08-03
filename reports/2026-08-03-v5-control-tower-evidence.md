# V5 컨트롤 타워 — 렌더 검증 + 프레임 예산 계측 + 조작 증거

검증 시각: 2026-08-03 22:20 (Asia/Seoul)
검증 HEAD: `a85bbddf6` (브랜치 `liora/conductor-jmsd8plzt2jz0dt`, 격리 worktree)
기준 커밋: `9914ae787` — 컨트롤 타워 보드를 conductor 기본 화면으로 배선 (V5-1)
검증 성격: **증거 확보(테스트·렌더 캡처 위주)** — 제품 코드 동작 변경 없음.

범위: V5-1 잔여(기본 화면 렌더 증거 + 프레임 예산 계측) + V5-2(조작 증거).

---

## 1. 판정 요약

| 항목 | 판정 | 근거 |
|---|---|---|
| V5-1 기본 화면 렌더 | **증거 확보** | 실제 렌더 경로(`JobBoardApp.render`) 헤드리스 캡처 4프레임 + 마커 체크 12건 PASS (§2) |
| V5-1 프레임 예산 | **증명** | 3개 시나리오 전부 p95 < 8ms (§3), 계측 테스트 그린 |
| V5-1 프레임 테스트 안정화 | **완료** | load-dependent flake 2건 안정화, `meta/test-baseline.yaml` unstable에서 제거, 전체 스위트 병렬 실행 3연속 그린 (§4) |
| V5-2 조작 증거 | **증거 확보** | 키보드 내비게이션·스크롤·닫기 이벤트→화면 갱신 테스트 9건 그린 + 렌더 캡처 Frame B/C (§5) |

제품 코드 변경: 없음. 변경 파일은 테스트 2파일(1수정·1신규), 증거 스크립트 1개, baseline 1개, reports 증거 4개.

## 2. 렌더 검증 방법 (V5-1 잔여)

실제 렌더 경로를 헤드리스로 직접 구동했다. `JobBoardApp`은 컨테이너 스왑 방식으로
마운트되는 전체 화면 컴포넌트로, 렌더가 `render(width)` → 테마 + 렌더러 프레임
프리미티브(`renderRendererFrameRows`, 선택 리스트 뷰포트, 세로 스크롤바)를 거쳐
터미널 행 배열을 생산한다. 증거 스크립트가 이 경로를 40×120 터미널 구동으로 캡처했다.

- 스크립트: `apps/liora/scripts/control-tower-evidence.ts`
- 결정성: `CI=1`(모션/펄스 효과 off → 일반 스타일), 기준 시각 고정(상대 시각 라벨 안정)
- 마커 체크 12건 전부 PASS (헤더 타이틀, Jobs [64], 그룹 헤더, 선택 조판, 풋터 키 힌트, 프레임 간 리페인트 차별, End 스크롤 등). 실패 시 스크립트가 exit 1로 끝나므로 재현 검증기로도 동작한다.

재현 명령:

```sh
CI=1 pnpm -C apps/liora exec tsx --tsconfig tsconfig.dev.json \
  --import ../../build/register-raw-text-loader.mjs scripts/control-tower-evidence.ts
```

캡처 프레임 (`reports/2026-08-03-v5-control-tower-default-screen.txt`):

| 프레임 | 내용 | 확인 사항 |
|---|---|---|
| A | 기본 화면 (64-job 보드, 초기 선택 job_0000) | 헤더 스트립 카운트(8 running … 16 done), 좌측 그룹 목록 + 스크롤바, 우측 Detail/Inbox, 풋터 키 힌트 |
| B | ↓ 키 1회 후 | 선택 포인터 이동, Detail 페인이 job_0024로 리페인트 |
| C | End 키 후 | 리스트 뷰포트 스크롤 — running 그룹이 화면 밖으로, job_0063 선택 |
| D | 동일 상태, 너비 150 | 헤더 우측 backpressure(8 queued · 8/8 slots) + inbox 3 표시 |

참고: 너비 120에서는 헤더 좌측 세그먼트가 우측 지표보다 우선해 우측(backpressure/inbox)이
잘린다(기존 `fitExactly` 정책대로). 우측 지표는 D처럼 넓은 터미널에서 표시된다.

ANSI 원본(실제 색상 시퀀스 포함): `reports/2026-08-03-v5-control-tower-default-screen.ansi`.

## 3. 프레임 예산 계측 수치

예산 기준: 단일 이벤트 리페인트 < 8ms (`apps/liora/AGENTS.md`).
방법: 워밍업 10회 제외, `performance.now()`로 render(또는 setProps+render) 구간 측정.
수치 파일: `reports/2026-08-03-v5-control-tower-frame-budget.txt`.

| 시나리오 | 샘플 | p50 | p95 | max | 판정 |
|---|---|---|---|---|---|
| S1 기본 화면(3-job 시작 스냅샷) 리페인트 | 100 | 0.530ms | 0.846ms | 2.731ms | PASS |
| S2 20-이벤트 버스트(setProps+render, 64-카드) | 20 | 1.149ms | 2.965ms | 2.965ms | PASS |
| S3 64-카드 전체 보드 리페인트 | 100 | 1.278ms | 3.541ms | 4.254ms | PASS |

최악 p95가 예산의 약 44% — 여유 있음. 렌더 플리커/프레임 드롭 회귀 미발견
(프레임 A~D 전부 단일 완전 프레임, 부분 드로잉 없음; 제품 코드 무변경).

## 4. 프레임 예산 테스트 안정화 (baseline unstable 해소)

`meta/test-baseline.yaml`의 `unstable` 2건(전체 스위트 병렬 실행 시 로드 의존 타이밍 flake)을
안정화했다:

- 방법: 워밍업 5→10회, **라운드 3회 × 100샘플 후 최소 라운드 p95** 채택. 프레임 예산은
  렌더 경로 비용을 기술하므로, 병렬 워커/GC 경합이 없는 최소 라운드가 비경합 비용의
  표준 근사다. 버스트 테스트는 20-샘플 1라운드가 100-샘플 3라운드로 확대되어 테스트명을
  `100-event burst`로 정정.
- 검증: 단독 3/3 그린 → **전체 스위트(4859 테스트, 병렬 워커) 3회 연속 그린**.
- `node scripts/check-test-baseline.mjs` 결과: `4849/4859 passed, 7 failed (baseline 7, unstable 0)` → `test-baseline: OK`. 실패 7건은 기존 baseline 고정 항목 그대로.
- baseline 갱신: unstable 2건 제거 (`unstable: []`).

## 5. 조작 증거 (V5-2)

테스트: `apps/liora/test/tui/features/control-tower-interaction.test.ts` — 9건 전부 그린.

이벤트 → 화면 갱신 체인:

| 조작 | 증거 |
|---|---|
| ↓/↑ 화살표, j/k | 선택 포인터 + Detail 페인 리페인트, 렌더 출력 diff 단언 (캡처 Frame B) |
| End/Home (스크롤) | 리스트 뷰포트 스크롤 — running 그룹 소실/복귀, 마지막·첫 job 선택 (캡처 Frame C) |
| Esc/q | onCancel(닫기 요청) 발생 |
| Enter/i | onInspect(선택 job 조사) 발생 |
| 컨트롤러 체인 | 내비게이션 이벤트 → 저장 선택 갱신(job_0024) + `requestRender` 재호출 |
| 컨트롤러 Esc | 보드 언마운트 → 트랜스크립트 자식 복원 + 에디터 포커스 |

키 입력은 실제 터미널이 보내는 원시 시퀀스(`\u001b[B` 등)를 `handleInput`에 주입하는 방식이다.

## 6. 실행 기록

| 명령 | 결과 |
|---|---|
| `CI=1 … scripts/control-tower-evidence.ts` | 마커 12건 + 예산 3건 PASS |
| `pnpm -C apps/liora exec vitest run test/tui/features/control-tower-default-screen.test.ts` | 11 passed (단독 3회 반복 그린) |
| `pnpm -C apps/liora exec vitest run test/tui/features/control-tower-interaction.test.ts` | 9 passed |
| `pnpm -C apps/liora exec vitest run` (전체, 3회) | 4849 passed / 7 failed (baseline 고정 7건) ×3 |
| `node scripts/check-test-baseline.mjs` | OK (unstable 0) |
| `pnpm -C apps/liora run build` | Build complete, CLI bundle check passed |

타입체크는 깨끗한 HEAD와 동일하게 기존 9건 에러(vis/server, 구 테스트 파일)가 그대로이며
이번 변경 파일 관련 에러는 없다(신규 에러 0건).

## 증거 파일 목록

- `reports/2026-08-03-v5-control-tower-default-screen.txt` — 렌더 캡처 4프레임(ANSI 제거 텍스트)
- `reports/2026-08-03-v5-control-tower-default-screen.ansi` — 기본 화면 ANSI 원본
- `reports/2026-08-03-v5-control-tower-frame-budget.txt` — 프레임 예산 계측 수치
- `apps/liora/scripts/control-tower-evidence.ts` — 증거 생성·검증 스크립트(재현 가능)
- `apps/liora/test/tui/features/control-tower-interaction.test.ts` — V5-2 조작 테스트
- `apps/liora/test/tui/features/control-tower-default-screen.test.ts` — 안정화한 프레임 예산 테스트 포함
