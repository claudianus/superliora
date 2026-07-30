import sliceAnsi from 'slice-ansi';

import { visibleWidth } from '#/tui/renderer';
import type { ColorPalette } from '#/tui/theme';

import { highlightLines, langFromPath } from './code-highlight';
import type { DiffLine, DiffStyles, WordSpan } from './diff-preview';

export function buildSyntaxLookup(
  diffLines: DiffLine[],
  path: string,
  enabled: boolean,
  palette?: ColorPalette,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!enabled) return map;
  const lang = langFromPath(path);
  if (lang === undefined) return map;

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const line of diffLines) {
    if (seen.has(line.code)) continue;
    seen.add(line.code);
    unique.push(line.code);
  }
  if (unique.length === 0) return map;

  const joined = unique.join('\n');
  const highlighted = highlightLines(joined, lang, palette);
  for (let i = 0; i < unique.length; i++) {
    map.set(unique[i]!, highlighted[i] ?? unique[i]!);
  }
  return map;
}

export function formatDiffRow(
  line: DiffLine,
  s: DiffStyles,
  syntaxByCode?: ReadonlyMap<string, string>,
  wordSpans?: WordSpan[],
  fullRow?: { readonly width?: number },
): string {
  const gutter = s.gutter(String(line.lineNum).padStart(4) + ' ');
  if (line.kind === 'context') {
    const code =
      syntaxByCode !== undefined ? (syntaxByCode.get(line.code) ?? line.code) : line.code;
    return gutter + '  ' + code;
  }
  const code = renderCodeWithSpans(line, syntaxByCode, wordSpans, s);
  const lineBg = line.kind === 'add' ? s.addLineBg : s.delLineBg;
  const marker = line.kind === 'add' ? s.add('+ ') : s.del('- ');
  if (fullRow === undefined) {
    return gutter + lineBg(marker + code);
  }
  const inner = gutter + marker + code;
  const target = fullRow.width;
  const pad = target !== undefined && target > 0 ? Math.max(0, target - visibleWidth(inner)) : 0;
  return lineBg(inner + ' '.repeat(pad));
}

function renderCodeWithSpans(
  line: DiffLine,
  syntaxByCode: ReadonlyMap<string, string> | undefined,
  wordSpans: WordSpan[] | undefined,
  s: DiffStyles,
): string {
  const highlighted = syntaxByCode?.get(line.code);
  if (wordSpans === undefined) {
    return highlighted ?? line.code;
  }
  const wordBg = line.kind === 'add' ? s.addWordBg : s.delWordBg;
  if (highlighted === undefined) {
    return wordSpans.map((span) => (span.changed ? wordBg(span.text) : span.text)).join('');
  }
  let out = '';
  let start = 0;
  for (const span of wordSpans) {
    const end = start + span.text.length;
    const slice = sliceAnsi(highlighted, start, end);
    out += span.changed ? wordBg(slice) : slice;
    start = end;
  }
  return out;
}
