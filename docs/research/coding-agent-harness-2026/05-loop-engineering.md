# 05 — Loop Engineering

## 1. 슬로건과 논문

2026년 6월 전후 실무 슬로건:

> Stop prompting your agent. Design the loop that prompts it.

정식 처리: Macedo, *Stop Hand-Holding Your Coding Agent: Engineering the Loops that Replace Step-by-Step Prompting* (arXiv:2607.00038, 2026-06-28).

주 객체: **Loop Specification** — 사람이 하네스에 건네는 유계·재사용 아티팩트.

## 2. Loop Specification 해부

| 부품 | 역할 |
|---|---|
| **Trigger** | 누가/무엇이 시작하나 (수동 · 스케줄 · 이벤트) |
| **Goal** | 무엇이면 성공인가 (가능하면 검증 가능) |
| **Execution** | 에이전트가 일하는 구간 (검증된 skills 호출 권장) |
| **Verification** | 진짜로 끝났는지 재현 가능한 증거 |
| **Stopping rule** | named terminal state로 탈출 |
| **Memory** | 턴·세션을 넘는 디스크 상태 |

**황금률:** 한 턴의 결과가 다음 행동을 바꾸지 않으면 루프가 아니라 **스케줄된 원샷**이다.

## 3. Verification Ladder (가장 중요한 그림)

| Level | 이름 | 예 | 구역 |
|---|---|---|---|
| L1 | Deterministic | exit code, golden file, assert | **Autonomous** |
| L2 | Rule / constraint | linter, schema, policy engine | **Autonomous** |
| L3 | Delayed field truth | e2e, deploy, 실제 사용자 반응 | Objective (느림) |
| L4 | Model-as-judge | rubric 점수 | Assisted |
| L5 | Human checkpoint | 승인·페어 | Assisted |

규칙:

- 루프의 자율성은 **검증기가 실제로 앉은 레벨**을 넘을 수 없다
- L4를 L1인 척하지 말 것
- L4가 불가피하면 **maker ≠ judge** (다른 모델/세션/에이전트)
- Loop Library(50개) 코딩 결과: ~70%가 L1–L2 autonomous zone, ~74%가 terminal state 이름 있음. 약한 쪽은 automated trigger·durable memory·named skills 호출

## 4. 아키텍처 선택

| 형태 | 언제 |
|---|---|
| Solo | L1/L2 검증이 강하고 범위가 작을 때 |
| Maker–Checker | L4 또는 주관 품질, 보안·결제 |
| Manager + helpers | 병렬 조사·대규모 리팩터 (비용↑) |

멀티에이전트 디베이트는 “자기 답을 믿기 시작하는 순간”을 늦춘다. 그래도 **정합성 ≠ 정확성**.

## 5. Named Terminal States

필수 이름 (최소셋):

| 상태 | 의미 |
|---|---|
| `success` | 검증 통과 |
| `no-op` | 할 일 없음 (정상) |
| `blocked` | 사람/권한/외부 입력 필요 |
| `stalled` | 진전 없음 (stagnation detector) |
| `exhausted` | 예산·스텝 소진 |

**에러나 예산 소진을 success로 치지 말 것.**  
“더 이상 돌리기 싫음” ≠ done.

## 6. 디자인 원칙 4가족 (논문 Family A–D)

### A — Define done first

- 매 턴 같은 frozen yardstick
- 연속 N회 성공 streak
- stagnation / budget로 정지
- unaided “다 한 것 같음” 금지

### B — Act without breaking

- 턴당 한 변수
- worst-first
- before 스냅샷
- surgical edit
- clean state로 시작 (Ralph / Anthropic coding agent)

### C — Earn trust

- maker ≠ approver
- hold-out에서 판정
- 주장마다 증거
- verifier 자체 red→green 증명

### D — Sustain

- 디스크 메모리 + 큐레이션
- progress / decisions 로그
- 스킬을 이름으로 재사용
- (현재 실무에서 가장 덜 성숙)

## 7. 안티패턴

| 안티패턴 | 결과 |
|---|---|
| 검증 없는 while true | 비용 소각, 자기동의 |
| 같은 모델이 자기 채점 | reward hacking |
| terminal state 없음 | 피곤함을 성공으로 보고 |
| 목표 = “더 좋게” | 루프 불가 |
| 메모리 junk drawer | context rot 재수입 |
| 트리거만 자동화, 검증은 약함 | 빠르게 망가짐 |

## 8. Ralph · Goal Loop · Anthropic — 한자리에

| 패턴 | 트리거 | 메모리 | 검증 | 비고 |
|---|---|---|---|---|
| Ralph | 셸/플러그인 재주입 | 파일+git | 태스크리스트/테스트 | fresh context every iter |
| `/goal` (agentic-goal-loop) | 사용자 계약 | 체크포인트 로그 | Validate 명령 | pursuing/achieved/… |
| Anthropic long-running | 세션 스케줄 | feature JSON + progress | E2E / browser | initializer + coding |

공통 DNA: **상태는 창이 아니라 파일**, **done은 외부 신호**, **한 번에 하나**.

## 9. SuperLiora에서의 루프

| 개념 | 구현·스킬 |
|---|---|
| Internal cycle | `packages/agent-core/src/loop` (`runTurn`, tool-call guards) |
| Goal / Ralph 계약 | `agentic-goal-loop` skill |
| Plan 게이트 | ultraplan 관련 specs / plan mode |
| Swarm 오케스트레이션 | ultraswarm, `collaboration/` |
| Repo-level loop | CI + `check:test-baseline` ratchet |
| Overnight 안전 | budget, permissions, 관측 (vis / telemetry) |

루프 순수성 규칙 (agent-core AGENTS.md): `src/loop`는 session/RPC/UI를 import하지 않는다.  
→ **엔진(내부 사이클)과 호스트(외부 루프 트리거)의 분리**가 코드에도 반영됨.

## 10. 루프 작성 템플릿

```markdown
# Loop: <이름>

## Trigger
manual | cron | on:pull_request | …

## Goal
<검증 가능한 한 문장>

## Read first
- …

## Constraints
- …

## Skills / tools allowed
- …

## Verify (ladder level: L?)
`<exact command>`

## Stop
- success: …
- blocked: …
- stalled: N rounds no progress
- exhausted: max_steps / max_tokens / max_$

## Memory
- progress: path
- decisions: path
- code: git
```

## 11. 연습

1. 자주 하는 수작업을 하나 고른다.
2. L1/L2 검증 명령을 먼저 쓴다. 없으면 루프를 쓰지 말고 테스트를 만든다.
3. Terminal states를 이름 붙인다.
4. Trigger를 수동으로 두고 3회 돌린 뒤, 자동화할지 결정한다.

다음: [06 — 필수 체크리스트](./06-essential-checklist.md)
