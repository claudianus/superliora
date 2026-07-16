Schedule a prompt for a future time — recurring or one-shot. Uses 5-field cron in the user's local timezone (`minute hour dom month dow`); `0 9 * * *` = 9am local.

## One-shot (`recurring: false`)
"Remind me at X" / single deadlines. Pin minute/hour/dom/month:
- today 2:30pm → `30 14 <today_dom> <today_month> *`
- tomorrow morning → `57 8 <tomorrow_dom> <tomorrow_month> *`
Favor near-term reminders (hours/few days) — tasks only fire while the session is alive.

## Recurring (`recurring: true`, default)
`*/5 * * * *` (every 5m), `0 * * * *` (hourly), `0 9 * * 1-5` (weekdays 9am).

## Avoid :00 and :30 when approximate
Fleet herd risk — nudge minutes unless user names exact time ("9:00 sharp"):
- "around 9" → `57 8` or `3 9`, not `0 9`
- hourly → `7 * * * *`, not `0 * * * *`

## Coalesce & fire envelope
Missed fires while offline collapse to one delivery with `coalescedCount` — treat `>1` as "only latest state matters". Fires wrap prompt in:
`<cron-fire jobId="..." cron="..." recurring="..." coalescedCount="N" stale="true|false"><prompt>...</prompt></cron-fire>`
`stale="true"` = recurring task past 7 days — final fire, then auto-delete; recreate with same `cron`+`prompt` to reset.

## Jitter
Recurring: forward ≤min(10% period, 15m). One-shot on :00/:30: pull earlier ≤90s.

## Session & limits
Tasks persist on `kimi resume` of the same session, not new sessions. Max **50 live cron tasks**. Returns `id` (8-hex), `cron`, `humanSchedule`, `recurring`, `nextFireAt`. Tell the user how to cancel/modify via you (include `id`) — no self-service `/cron` UI.
