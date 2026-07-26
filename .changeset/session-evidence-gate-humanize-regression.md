---
'@superliora/agent-core': patch
---

test(agent-core): pin session/swarm-evidence-gate.ts and swarm-humanize.ts regression cases

- `swarm-evidence-gate.ts` — pins `requiresNonEmptyRequiredEvidence` (AC/verification/verify-stage/ac_-prefix policy detection), `withDefaultRequiredEvidence` (no-op on non-policy + unchanged when any non-empty token), `evaluateEvidenceHardGate` (non-done pass-through, policy empty-evidence block, required-but-empty-evidenceIds block, non-check pass on evidence or summary, check-like unmatched tokens, best-effort normalize match), `isCheckLikeEvidenceToken` (known tool tokens, bidirectional substring, path-like), `isPathLikeEvidenceToken` (absolute/home/Windows/explicit-relative/workspace-paths), `normalizeEvidenceToken` (lowercase + alnum-only), `evidenceMatchesToken` (bidirectional normalize substring), `findEvidenceHardGateViolation` (first-failure, all-pass), and `applyEvidenceHardGate` (policy-bound demote + reason-append, healthy-node untouched).
- `swarm-humanize.ts` — pins `looksLikeProtocolMessage` (XML tag detection) and `humanizeCollaborationEvent` (empty body, free prose, `<handoff>` expert/phase/verdict inner, FAIL→error severity, `<expert>` name/outcome/verdict/selection_reason, 6-unique-name `<team_roster>` cap, neutral `<swarm_channel_rules>` preamble).
