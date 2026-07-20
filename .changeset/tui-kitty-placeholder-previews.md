---
'@superliora/liora': minor
---

이미지 첨부 프리뷰가 kitty 그래픽 프로토콜의 유니코드 플레이스홀더를 지원하는 터미널(kitty, ghostty, rio + truecolor)에서 원본 해상도로 표시됩니다. PNG를 조용히 전송해 가상 배치(virtual placement)를 만들고, 플레이스홀더 텍스트 셀로 이미지를 출력하므로 스크롤·리플로우·diff 렌더러와 그대로 호환됩니다. 미지원 터미널에서는 기존 half-block 프리뷰로 자동 폴백합니다.
