---
"@superliora/agent-core": minor
---

스킬 단계를 단순화합니다. SearchSkill/SearchExpert 메타데이터는 "로드 전 신뢰 금지"가 아니라 스킵 판단에 충분한 정보로 취급해, 워크플로가 필요할 때만 스킬을 로드하도록 안내 문구를 바꿉니다. no-ai-slop 빌트인 스킬 가족(본체·korean·ui·changelog·meta-prompt)은 시스템 프롬프트의 기본 No-AI-Slop 섹션과 통합해 폐기하고, 깊은 감사 워크플로인 avoid-ai-writing만 남깁니다(`/slop` 별칭도 이 스킬을 가리킵니다). 민감 경로 차단 목록은 Bash 설명 한 곳만 유지하고 Read는 이를 참조합니다.
