export function buildLeanContextGuidance(): string {
  return [
    'Liora Lean Context (token-efficient exploration):',
    '- Read: LioraRead(signatures|map|lines) before full Read; Grep/LioraSymbol before broad dumps (just-in-time).',
    '- Structure: LioraTree before ls/find; LioraCallgraph for impact; LioraExpand for [liora-archived] ids after clearing.',
    '- Parallelize independent Grep/LioraRead/LioraSymbol calls in one turn.',
    '- Ultrawork/UltraSwarm: compact packets; archive bulky logs; expand only on failure paths.',
    '- Memory: durable facts only — not raw transcripts or archived dumps.',
  ].join('\n');
}
