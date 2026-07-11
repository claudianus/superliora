---
"@superliora/liora": minor
---

Vanta 12종 테마 팩을 추가합니다. 6개의 기본 색조합(kiwi, blue, imperial, mint, wattle, pumpkin)을 원본과 반전(inverse) 12개의 `superliora-vanta-*` 테마로 번들하고 `superliora-vanta-imperial`을 기본 테마로 승격합니다. 36개 본문 텍스트 대비가 모두 WCAG AA 4.5:1을 통과하며, `pnpm -C apps/liora run check:contrast`로 검증 가능합니다. 이전 기본값(`theme = "auto"`)으로 복원하려면 `~/.superliora/tui.toml`에 `theme = "auto"`를 추가하세요.
