---
"@superliora/liora": patch
---

test(liora): pin `native-frame-policy` chrome-cache contract

The TUI's chrome-cache decisions gate clear→rewrite flicker on the
stage/letterbox and on whether live patches (request/manual causes) reach
the chrome at all. The helpers in `apps/liora/src/tui/utils/native-frame-policy.ts`
were the latest change site for this contract; pin them with 24
regression tests covering:

- `frameInvalidationIntentToCause` mapping
- `isPureTranscriptScrollFrame` geometry/cause gating
- `isPureInputFrame` mixed-cause rejection
- `shouldReuseTUIChromeCache` cache/width/stage/epoch/request/manual gates
- `tuiChromeEpoch` streaming/thinking/goal-id/goal-status drift
- `isLiveGoalChromeActive` active/paused/blocked vs terminal vs null

The cache is now provably conservative on live patches (no request/manual
cause is ever served from a stale cache) and provably aggressive on static
chrome (animation ticks reuse the cache when no live goal is attached).
