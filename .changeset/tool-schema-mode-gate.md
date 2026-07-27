---
"@superliora/agent-core": minor
---

도구 스키마를 모드 뒤로 게이트합니다. 특정 모드에서만 의미가 있는 도구(NextPhase·RecordInterviewFinding는 울트라 플랜, ExitPlanMode는 플랜 모드, UltraworkGraph는 Ultrawork 실행 중)가 해당 모드 밖에서는 모델에 장착되지 않아 매 턴 스키마 토큰을 아낍니다. Premium이 켜진 비시각(코드) 밀도에서는 GenerateImage·GenerateVideo·VerifySurface·VisualDiff를 감춥니다. 모드 진입 도구(EnterPlanMode, UltraSwarm, CreateGoal 등)는 계속 항상 장착되며, 감춰진 도구도 SearchTools로 발견할 수 있습니다.
