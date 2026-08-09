import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveCamoufoxCliPlan } from '../src/browser/camoufox-binary';
import { runSetupCommand } from '../src/setup-command';

describe('resolveCamoufoxCliPlan', () => {
  it('uses npx outside a SuperLiora workspace (no pnpm --filter against user cwd)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'camoufox-cli-'));
    writeFileSync(join(dir, 'package.json'), '{"name":"metalslug1"}\n');
    expect(resolveCamoufoxCliPlan({ cwd: dir })).toEqual({ kind: 'npx' });
  });

  it('uses workspace filter only when packages/gui-use exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'camoufox-ws-'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    mkdirSync(join(root, 'packages', 'gui-use'), { recursive: true });
    writeFileSync(join(root, 'packages', 'gui-use', 'package.json'), '{"name":"@superliora/gui-use"}\n');
    expect(resolveCamoufoxCliPlan({ cwd: join(root, 'packages', 'gui-use') })).toEqual({
      kind: 'workspace',
      cwd: root,
    });
  });
});

describe('runSetupCommand quiet default', () => {
  it('does not echo child stdout onto process.stdout by default', async () => {
    const writes: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      const result = await runSetupCommand(process.execPath, ['-e', 'process.stdout.write("LEAK")'], {
        timeoutMs: 5_000,
      });
      expect(result.ok).toBe(true);
      expect(result.stdout).toBe('LEAK');
      expect(writes.join('')).not.toContain('LEAK');
    } finally {
      process.stdout.write = original;
    }
  });
});
