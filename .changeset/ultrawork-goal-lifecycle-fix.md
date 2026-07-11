---
"@superliora/agent-core": minor
---

Ultrawork Goal 생성/종료 경로를 수정합니다. ExitPlanMode 승인 시 Goal이 없으면 run objective로 자동 생성하여 모델 실행이 멈추지 않도록 하고, UltraSwarm의 `updateWorkNodes`에 work graph sync와 `maybeFinishUltraworkRun`을 추가해 swarm 완료 시 run/goal이 정상 종료되도록 합니다. `exit-plan-mode.test.ts`와 `recovery.test.ts`에서 43개 테스트 모두 통과합니다.
