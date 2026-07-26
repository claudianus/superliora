export function buildLeanContextGuidance(): string {
  return [
    'Liora Lean Context:',
    '- Prefer LioraRead(signatures|map|lines)/LioraSymbol/LioraTree/LioraCallgraph before full dumps; parallelize independent reads.',
    '- Expand [liora-archived] only on failure paths; keep Ultrawork/UltraSwarm packets compact.',
    '- Memory: durable facts only — not raw transcripts/archived dumps.',
    '- Prefer dedicated file tools over Bash cat/sed/grep when they fit; use Bash for real shell semantics only.',
  ].join('\n');
}
