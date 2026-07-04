export function buildLeanContextGuidance(): string {
  return [
    'Kimi Lean Context:',
    '- Prefer the LioraContext tool for compact code packets before broad file reads; it is the built-in lean-codegraph surface.',
    '- Prefer indexed codegraph lookup when available; otherwise use LioraContext, rg, or similarly precise search before broad file reads.',
    '- Retrieve exact symbols, call sites, and changed files first; cite file paths or source names for important evidence.',
    '- Keep working context small: summarize bulky outputs, retain decisions and open questions, and avoid dumping irrelevant context.',
    '- Use memory only for durable preferences and decisions, not raw transcripts or transient scratch data.',
  ].join('\n');
}
