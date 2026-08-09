import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { STRINGS_TUI_EN } from '#/cli/i18n/strings-tui';

const ROOT = join(import.meta.dirname, '../../src');

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'test') continue;
      walkTsFiles(full, out);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function collectTtuiKeys(): Set<string> {
  const keys = new Set<string>();
  const re = /ttui\(\s*['"]([^'"]+)['"]/g;
  for (const file of walkTsFiles(ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(re)) {
      const key = match[1];
      if (key !== undefined && key.length > 0) keys.add(key);
    }
  }
  return keys;
}

describe('ttui() static keys', () => {
  it('are defined in STRINGS_TUI_EN (and KO via parity test)', () => {
    const used = collectTtuiKeys();
    const missing = [...used].filter((key) => STRINGS_TUI_EN[key] === undefined).sort();
    expect(missing, `missing catalog keys: ${missing.join(', ')}`).toEqual([]);
  });
});
