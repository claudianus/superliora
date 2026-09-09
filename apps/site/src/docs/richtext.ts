/**
 * Inline rich-text tokenizer for docs prose.
 *
 * Pure (no JSX) so the contract tests can pin its edge cases without a DOM:
 * - `kbd`: Alt+J, Ctrl+K, Shift-Tab, … → keyboard caps
 * - `cmd`: /slash and `liora …` invocations → primary mono chips
 * - `mono`: --flags, $env:VARS, CAPS_IDENTS → dim mono chips
 *
 * Everything else stays plain text. The patterns are deliberately narrow:
 * prose around a command ("Use /plan for big design") must not be swallowed.
 */

export type RichKind = 'plain' | 'kbd' | 'cmd' | 'mono';

export interface RichToken {
  text: string;
  kind: RichKind;
}

const TOKEN_RE =
  /((?:Alt|Ctrl|Cmd|Shift)\+[A-Za-z0-9?]+(?:\+[A-Za-z0-9?]+)*)|(\/[a-z][a-z0-9-]*)|(\bliora(?:\s+(?:--[a-z0-9-]+|upgrade|doctor|gc|export|worktree|server|ps))?)|(--[a-z][a-z0-9-]*)|(\$env:[A-Za-z_]+)|([A-Z][A-Z0-9_]{2,}(?:=[^\s·,;()]+)?)/g;

export function splitRichText(text: string): RichToken[] {
  const out: RichToken[] = [];
  TOKEN_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), kind: 'plain' });
    const [full, kbd, slash, cli, flag, env, caps] = m;
    const kind: RichKind = kbd ? 'kbd' : slash || cli ? 'cmd' : flag || env || caps ? 'mono' : 'plain';
    out.push({ text: full, kind });
    last = m.index + full.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'plain' });
  return out;
}
