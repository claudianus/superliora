# Goal Driver Jobs — 병렬 자율 Goal을 Job 원장으로 (하드 계약)

작성일: 2026-08-04
상태: 구현 착수 스펙 (수직 슬라이스)
선행 문서: `2026-08-03-meta-orchestrator-v2-contract.md`

## 1. 문제

- Goal은 세션당 1개(`"A goal already exists; use replace"`)이고, Goal 루프
  (`driveGoalTurnLoop`)는 **메인 에이전트의 턴**으로 돈다 — Goal이 active인 동안
  Conductor의 인터랙티브 레인은 점유된다.
- Mission도 단계 게이트 판정은 Conductor 턴을 소비한다.
- 하네스 취지(병렬 자율 루프)와 충돌: 여러 Goal/Mission을 동시에 돌릴 수 없다.

## 2. 핵심 설계 — 루프를 발명하지 않고 이주시킨다

턴 엔진은 이미 "활성 Goal이 있으면 자동 연속 턴을 돈다"
(`agent/turn/index.ts` → `driveGoalTurnLoop`). 워커의 태스크 프롬프트도 동일
턴 엔진(`child.turn.prompt`)을 거친다. 따라서:

> **Goal을 워커 에이전트에 이주시키면, 그 워커는 자동으로 자율 루프가 된다.**

- 새 기계 0개: 예산 회로차단(`budget.overBudget`), 정체 감지
  (`GOAL_NO_PROGRESS_STREAK_K`), 실패/중단 시 pause가 전부 공짜로 따라온다.
- Job 기계 재사용: worktree 격리, 스폰 큐(3병렬), 검증 ledger, 인박스, 병렬 N개.

## 3. 불변 조건

1. **드라이버는 Job이다.** `kind='goal-driver'` — 원장/스케줄러/백프레셔/인박스/
   취소/스티어/재개를 일반 Job과 동일하게 적용받는다. 별도 우회 경로 없음.
2. **Goal 생성은 기계적이다.** 드라이버 스폰 시 런타임이 워커 에이전트에
   `createGoal(actor='system')` + `setBudgetLimits`를 호출한다. 모델이 스스로
   Goal을 만들게 하는 프롬프트 시어터 금지.
3. **메인은 루프에서 자유롭다.** 드라이버의 연속 턴은 전부 워커 프로세스 안에서
   돈다. Conductor는 원장 조회/스티어/캔슬만 한다 (기존 Job 도구 재사용).
4. **종료는 증거와 함께.** 드라이버가 `UpdateGoal complete`을 선언해도 워커
   계약의 검증 게이트(`verification_failed`)가 우선한다 — 기존 완료 매핑 유지.
5. **Goal 종료 상태는 Job으로 올라온다.** 드라이버 Goal이 `blocked`/`paused`로
   끝나면 Job은 `blocked`(재개 가능)로 전이하고 사유를 원장에 기록한다.

## 4. 구현 귀결

| 변경 | 위치 |
|---|---|
| `JobKind` + `'goal-driver'`, Goal 필드(`goalId`, `goalObjective`, `goalCompletionCriterion`, `goalBudgetLimits`) | `job-store-key.ts` |
| JobCreate 스키마: `goal_completion_criterion`, `goal_budget` | `job-tools.ts` |
| `FanoutTask.goal` / `RunSubagentOptions.goal` 스펙 필드 | `fleet/spawn-agents.ts`, `subagent-host-types.ts` |
| 태스크 프롬프트 턴 직전 Goal 이주(생성+예산) | `subagent-completion-flow.ts` |
| `SubagentCompletion.goalStatus` 수집 → Job 상태 매핑 | `subagent-host-types.ts`, `job-worker.ts` |
| 드라이버 프로필(coder 도구 허리 + GetGoal/UpdateGoal + 미니 플레이북) | `profile/default/goal-driver.yaml` |
| `profileForJobKind('goal-driver') → 'goal-driver'` | `job-runtime.ts` |
| Conductor 라우팅: "백그라운드 장기 목표" → goal-driver JobCreate | `conductor.yaml` |

## 5. 범위 밖(후속)

- 드라이버의 중첩 위임(드라이버가 자기 서브 Job 생성) — 이번 슬라이스는
  드라이버가 직접 구현하는 자율 코더다.
- Mission 드라이버(`mission-driver` kind) — Goal 드라이버가 증명한 뒤 승격.
- 드라이버 간 머지 순서 중재 — worktree 격리 + 기존 신뢰 규칙으로 우선 커버.
