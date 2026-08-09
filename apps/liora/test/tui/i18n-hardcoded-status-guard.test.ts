import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const TUI_ROOT = join(PACKAGE_ROOT, 'src/tui');
const ALLOWLIST_PATH = join(PACKAGE_ROOT, 'test/tui/i18n-hardcoded-allowlist.txt');

const SHOW_LITERAL_RE =
  /show(?:Status|Error|Notice)\(\s*(['"])(?:\\.|(?!\1)[^\\])*\1/g;

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkTsFiles(path, out);
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function loadAllowlist(): Set<string> {
  const raw = readFileSync(ALLOWLIST_PATH, 'utf8');
  return new Set(
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

function scanHardcodedLiterals(): string[] {
  const hits: string[] = [];
  for (const file of walkTsFiles(TUI_ROOT)) {
    const rel = relative(PACKAGE_ROOT, file).replaceAll('\\', '/');
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.includes('showStatus(') && !line.includes('showError(') && !line.includes('showNotice(')) {
        continue;
      }
      if (line.includes('ttui(')) continue;
      const matches = line.matchAll(SHOW_LITERAL_RE);
      for (const match of matches) {
        const quote = match[1]!;
        const literal = match[0].slice(match[0].indexOf(quote) + 1, match[0].lastIndexOf(quote));
        hits.push(`${rel}:${i + 1}:${literal}`);
      }
    }
  }
  return hits.sort();
}

describe('i18n hardcoded status guard', () => {
  it('has no new English showStatus/showError/showNotice string literals outside the allowlist', () => {
    const allowlist = loadAllowlist();
    const hits = scanHardcodedLiterals();
    const unexpected = hits.filter((hit) => !allowlist.has(hit));
    const staleAllowlist = [...allowlist].filter((entry) => !hits.includes(entry));

    expect(
      unexpected,
      unexpected.length > 0
        ? `New hardcoded TUI status strings — move to ttui() or add to ${relative(PACKAGE_ROOT, ALLOWLIST_PATH)}:\n${unexpected.join('\n')}`
        : undefined,
    ).toEqual([]);

    expect(
      staleAllowlist,
      staleAllowlist.length > 0
        ? `Stale allowlist entries (string migrated or removed):\n${staleAllowlist.join('\n')}`
        : undefined,
    ).toEqual([]);
  });
});
