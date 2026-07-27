---
"@superliora/kosong": minor
---

Qwen/DashScope 엔드포인트에 명시적 컨텍스트 캐시 마커(`cache_control: ephemeral`)를 붙입니다. Qwen Token Plan이 사용하는 OpenAI 호환(Chat Completions) 제공자와 Kimi 제공자 모두 공유 마커 모듈을 통해 시스템 프롬프트와 끝에서 두 번째 메시지에 경계를 표시하므로, 세션 내내 정적인 시스템+도구 프리픽스와 매 턴 자라는 대화 프리픽스가 모두 캐시 경계에 걸립니다. qwen 모델명 또는 dashscope/qwen/aliyuncs URL에서만 활성화하고 그 외 제공자에는 요청을 바꾸지 않습니다. 히트 시 암시 캐시(20%)보다 낮은 10% 과금 구간의 재사용을 노립니다.
