import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { scanSessionWire } from '../../src/session/export/wire-scan';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'liora-wire-scan-'));
  tempDirs.push(dir);
  return dir;
}

describe('scanSessionWire', () => {
  it('reads agents/main/wire.jsonl turn.prompt records', async () => {
    const sessionDir = await makeDir();
    const agentDir = join(sessionDir, 'agents', 'main');
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, 'wire.jsonl'),
      [
        JSON.stringify({ type: 'metadata', protocol_version: '1.4', created_at: 1, time: 1_700_000_000_000 }),
        JSON.stringify({
          type: 'turn.prompt',
          time: 1_700_000_001_000,
          input: [{ type: 'text', text: 'ship the export scanner' }],
          origin: { kind: 'user' },
        }),
        '',
      ].join('\n'),
      'utf-8',
    );

    await expect(scanSessionWire(sessionDir)).resolves.toEqual({
      firstActivityMs: 1_700_000_000_000,
      lastActivityMs: 1_700_000_001_000,
      lastUserMessageMs: 1_700_000_001_000,
      firstUserInput: 'ship the export scanner',
    });
  });

  it('falls back to a leftover session-root wire.jsonl turn_begin', async () => {
    const sessionDir = await makeDir();
    await writeFile(
      join(sessionDir, 'wire.jsonl'),
      `${JSON.stringify({
        type: 'turn_begin',
        time: Date.parse('2026-04-18T10:00:00Z'),
        user_input: 'hello',
      })}\n`,
      'utf-8',
    );

    await expect(scanSessionWire(sessionDir)).resolves.toMatchObject({
      firstUserInput: 'hello',
      lastUserMessageMs: Date.parse('2026-04-18T10:00:00Z'),
    });
  });

  it('reads gzipped main wire when the plain file is gone', async () => {
    const sessionDir = await makeDir();
    const agentDir = join(sessionDir, 'agents', 'main');
    await mkdir(agentDir, { recursive: true });
    const line = JSON.stringify({
      type: 'turn.prompt',
      time: 1_800_000_000_000,
      input: [{ type: 'text', text: 'gzipped' }],
      origin: { kind: 'user' },
    });
    await writeFile(join(agentDir, 'wire.jsonl.gz'), gzipSync(`${line}\n`));

    await expect(scanSessionWire(sessionDir)).resolves.toMatchObject({
      firstUserInput: 'gzipped',
    });
  });
});
