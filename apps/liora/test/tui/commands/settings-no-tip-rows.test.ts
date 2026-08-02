/**
 * Guard: Settings panes must not ship tip-only menu rows.
 * Help copy belongs in glance panels / status strings, not fake actions.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONFIG_ROOT = join(import.meta.dirname, '../../../src/tui/commands/config');

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTsFiles(full));
    else if (name.endsWith('-settings.ts') || name.endsWith('settings.ts')) out.push(full);
  }
  return out;
}

describe('settings panes have no tip-only menu rows', () => {
  it('contains zero value: tip-* option declarations under commands/config', () => {
    const files = walkTsFiles(CONFIG_ROOT);
    expect(files.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const re = /value:\s*'tip-[^']+'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        hits.push(`${file}:${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
