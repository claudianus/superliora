---
"@harness-kit/tui-renderer": minor
"@superliora/liora": minor
---

터미널 리사이즈 체감과 프레임 출력을 다듬습니다. 리사이즈 후 Kitty 포인터 shape 스택이 pop되지 않아 커서가 리사이즈 형태로 남던 문제를 고칩니다(leave 경로 pop + 리사이즈 시 drag/hover 상태·shape 초기화). 자식 행 수 계산 캐시를 너비 키 기반 LRU(캡 4)로 바꿔 리사이즈마다 반복되던 랩 재계산을 줄이고, 토폴로지 시그니처에서 버퍼 크기를 빼되 버퍼 재생성 시 합성 캐시를 명시적으로 비워 정합성을 지킵니다. DECSCUSR 커서 스타일은 상태성이므로 동일 (shape, blinking) 재출력을 생략하고 force/rewrite·리사이즈 직후에만 다시 씁니다.
