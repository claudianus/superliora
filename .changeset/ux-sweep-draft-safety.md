---
"@superliora/liora": patch
---

Stop drafts and queued messages from being lost silently: Ctrl-C on a non-empty editor now stashes the text for Ctrl-X restore instead of destroying it, recalling a queued message keeps a backup copy, a failed steer re-queues what it drained, and restored queue entries warn when their image attachments were dropped by the restart.
