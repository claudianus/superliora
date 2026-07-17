export function buildLeanContextGuidance(): string {
  return [
    'Liora Lean Context:',
    '- Prefer LioraRead(signatures|map|lines)/LioraSymbol/LioraTree/LioraCallgraph + Grep(head_limit default 20) before full dumps; parallelize independent reads.',
    '- Expand [liora-archived] only on failure paths; keep Ultrawork/UltraSwarm packets compact (expert body 1600 · total 6k).',
    '- After compact: honor Continuity notes and Context OS pages (inject ≤3, ≤3.5k); verify evidence IDs before long resume.',
    '- Memory: durable facts only — not raw transcripts/archived dumps.',
  ].join('\n');
}
