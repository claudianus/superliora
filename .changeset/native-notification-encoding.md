---
"@superliora/liora": minor
---

macOS 네이티브 알림 메시지가 깨져 보이던 문제를 고칩니다. osascript가 환경 변수를 `system attribute`로 읽을 때 로케일과 무관하게 MacRoman으로 디코딩해 한글·이모지·대시 같은 비 ASCII 텍스트가 이중 인코딩으로 손상됐습니다(실기 검증: UTF-8 바이트가 U+0091/U+0085 계열으로 재인코딩됨). 텍스트를 argv(`on run argv`)로 전달해 UTF-8이 그대로 round-trip하도록 바꿨습니다. 추가로 알림 sanitizer가 ANSI 이스케이프 시퀀스(CSI/OSC/Fe)를 통째로 제거해 `[32m` 같은 파라미터 잔여가 알림에 섞이지 않게 합니다.
