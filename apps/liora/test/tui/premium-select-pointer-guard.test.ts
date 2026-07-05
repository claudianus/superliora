import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const DIALOGS_ROOT = join(__dirname, '..', '..', 'src', 'tui', 'components', 'dialogs');

const FORBIDDEN_SELECTION_PATTERNS = [
  /['"]▶['"]/,
  /[`'"]\s*→\s*\[/,
  /[`'"]\s*>\s*\[/,
] as const;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, files);
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('premium select pointer guard', () => {
  it('forbids non-premium list selection pointers in dialog components', () => {
    const offenders: { file: string; line: number; snippet: string }[] = [];
    let inBlockComment = false;

    for (const file of walk(DIALOGS_ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const trimmed = line.trimStart();

        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false;
          continue;
        }
        if (trimmed.startsWith('/*')) {
          if (!trimmed.includes('*/')) inBlockComment = true;
          continue;
        }
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

        for (const pattern of FORBIDDEN_SELECTION_PATTERNS) {
          if (pattern.test(line)) {
            offenders.push({
              file: relative(join(__dirname, '..', '..'), file),
              line: i + 1,
              snippet: line.trim(),
            });
            break;
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
