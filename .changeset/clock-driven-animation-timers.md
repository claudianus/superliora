---
"@superliora/liora": patch
---

Remove private setInterval animation timers in favor of the shared render-loop clock.

Three components previously ran their own setInterval timers for animation
and periodic refresh, bypassing the single-clock architecture in
PREMIUM.md §7.1:

- ShellRunComponent: 1s elapsed timer → now derived from
  appearanceAnimationNow() during render().
- ToolCallComponent: streaming-progress (1s) and subagent-elapsed (1s)
  timers → now driven by tickClockDrivenRefresh() in render(), which
  only rebuilds once per interval even when the render loop fires faster.
- AgentSwarmProgressComponent: 80ms frame timer → now driven by
  tickClockDrivenAnimation() in render(), throttled to FRAME_INTERVAL_MS.

This eliminates three more private timers that could drift out of sync
with the render loop and keeps all animation on a single clock.
