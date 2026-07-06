export function buildLeanContextGuidance(): string {
  return [
    'Liora Lean Context (token-efficient exploration):',
    '- Call LioraContext FIRST for orientation (mode=compose). One compose replaces search→read→symbol chains.',
    '- Read path: LioraContext → LioraRead(mode=signatures|map|lines) → Read only for edit-ready exact bytes.',
    '- Search path: LioraSearch or LioraSymbol before Grep/Read when exploring unknown code.',
    '- Structure path: LioraTree before Bash ls/find; LioraCallgraph for caller/callee impact.',
    '- Compressed output is reversible: use LioraExpand(id=...) when you see [liora-archived ...] markers.',
    '- Parallel work: fire independent LioraContext/LioraSearch/LioraRead calls in the same turn.',
    '- Ultrawork/UltraSwarm: keep subagent packets compact; archive bulky logs; expand only on failure paths; swarm handoffs are archived with LioraExpand(id=...).',
    '- Memory stays durable facts only — not raw transcripts or archived tool dumps.',
  ].join('\n');
}
