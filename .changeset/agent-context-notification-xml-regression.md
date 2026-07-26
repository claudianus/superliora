---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/context/notification-xml regression cases

- `renderNotificationXml` covers the canonical `<notification …>` opening
  tag, the `unknown` fallback for every missing string attribute, the
  conditional `agent_id` attribute, double-quote escaping, the conditional
  `Title:` and `Severity:` lines, the body passthrough, single-string and
  string-array children, and the `children` / `extraBlocks` fallback.
