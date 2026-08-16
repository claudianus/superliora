import { mkdir, readFile, writeFile, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';

import {
  collectStorageGarbage,
  formatBytes,
  measureStorageBytes,
} from '#/session/storage-gc';
import { compressWireJsonl, resolveWirePath, WIRE_JSONL, WIRE_JSONL_GZ } from '#/session/store/wire-gzip';
import { FileSystemAgentRecordPersistence } from '#/agent/records/persistence';
import { SessionStore } from '#/session/store/session-store';

const temps: string[] = [];

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

describe('wire gzip', () => {
  it('compresses plain wire and reads the same records back', async () => {
    const home = await tempDir('wire-gz-');
    const agentDir = join(home, 'agent');
    await mkdir(agentDir, { recursive: true });
    const wirePath = join(agentDir, WIRE_JSONL);
    const persistence = new FileSystemAgentRecordPersistence(wirePath);
    persistence.append({
      type: 'turn.prompt',
      input: [{ type: 'text', text: 'hello gzip' }],
      origin: { kind: 'user' },
    } as never);
    await persistence.flush();

    const ok = await compressWireJsonl(agentDir);
    expect(ok).toBe(true);
    await expect(stat(join(agentDir, WIRE_JSONL_GZ))).resolves.toBeTruthy();
    await expect(stat(wirePath)).rejects.toThrow();

    const reader = new FileSystemAgentRecordPersistence(wirePath);
    const records = [];
    for await (const r of reader.read()) records.push(r);
    expect(records).toHaveLength(1);
    expect((records[0] as { type?: string }).type).toBe('turn.prompt');
  });

  it('close() gzips when compressOnClose is enabled', async () => {
    const home = await tempDir('wire-close-');
    const agentDir = join(home, 'agent');
    await mkdir(agentDir, { recursive: true });
    const wirePath = join(agentDir, WIRE_JSONL);
    const persistence = new FileSystemAgentRecordPersistence(wirePath, {
      compressOnClose: true,
    });
    persistence.append({
      type: 'turn.prompt',
      input: [{ type: 'text', text: 'bye' }],
      origin: { kind: 'user' },
    } as never);
    await persistence.close();
    expect(await resolveWirePath(agentDir)).toMatch(/wire\.jsonl\.gz$/);
  });

  it('gzip → resume → append → read keeps prior events and new events', async () => {
    const home = await tempDir('wire-resume-');
    const agentDir = join(home, 'agent');
    await mkdir(agentDir, { recursive: true });
    const wirePath = join(agentDir, WIRE_JSONL);

    const first = new FileSystemAgentRecordPersistence(wirePath, { compressOnClose: true });
    first.append({
      type: 'turn.prompt',
      input: [{ type: 'text', text: 'old-event' }],
      origin: { kind: 'user' },
    } as never);
    await first.close();
    expect(await resolveWirePath(agentDir)).toMatch(/wire\.jsonl\.gz$/);

    const resumed = new FileSystemAgentRecordPersistence(wirePath, { compressOnClose: true });
    const prior: Array<{ type?: string; input?: Array<{ text?: string }> }> = [];
    for await (const r of resumed.read()) prior.push(r as never);
    expect(prior).toHaveLength(1);
    expect(prior[0]!.input?.[0]?.text).toBe('old-event');

    resumed.append({
      type: 'turn.prompt',
      input: [{ type: 'text', text: 'new-event' }],
      origin: { kind: 'user' },
    } as never);
    await resumed.flush();

    const all: Array<{ type?: string; input?: Array<{ text?: string }> }> = [];
    for await (const r of resumed.read()) all.push(r as never);
    expect(all.map((r) => r.input?.[0]?.text)).toEqual(['old-event', 'new-event']);
    await resumed.close();
  });

  it('appendForkedMarkers never writes raw JSONL into wire.jsonl.gz', async () => {
    const home = await tempDir('fork-gz-');
    const agentDir = join(home, 'agent-main');
    await mkdir(agentDir, { recursive: true });
    const wirePath = join(agentDir, WIRE_JSONL);
    const writer = new FileSystemAgentRecordPersistence(wirePath, { compressOnClose: true });
    writer.append({
      type: 'turn.prompt',
      input: [{ type: 'text', text: 'pre-fork' }],
      origin: { kind: 'user' },
    } as never);
    await writer.close();

    const { appendForkedMarkers } = await import('#/session/store/session-store-helpers');
    const { createGunzip } = await import('node:zlib');
    const { createReadStream, existsSync } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { createWriteStream } = await import('node:fs');
    const { readFile } = await import('node:fs/promises');

    await appendForkedMarkers({
      agents: {
        main: { homedir: agentDir },
      },
    });

    // Must not leave a corrupt gzip (raw JSONL appended onto binary).
    // After fork marker, plain is preferred; if only gz remains it must gunzip cleanly.
    const plain = join(agentDir, WIRE_JSONL);
    const gz = join(agentDir, WIRE_JSONL_GZ);
    if (existsSync(plain)) {
      const text = await readFile(plain, 'utf-8');
      expect(text).toContain('"type":"forked"');
      expect(text).toContain('pre-fork');
    } else {
      expect(existsSync(gz)).toBe(true);
      const out = join(agentDir, 'wire.out');
      await pipeline(createReadStream(gz), createGunzip(), createWriteStream(out));
      const text = await readFile(out, 'utf-8');
      expect(text).toContain('"type":"forked"');
      expect(text).toContain('pre-fork');
    }

    const reader = new FileSystemAgentRecordPersistence(wirePath);
    const records: Array<{ type?: string }> = [];
    for await (const r of reader.read()) records.push(r as never);
    expect(records.some((r) => r.type === 'forked')).toBe(true);
    expect(records.some((r) => r.type === 'turn.prompt')).toBe(true);
  });
});

describe('state.json compact JSON', () => {
  it('writes compact state without pretty indentation', async () => {
    const root = await tempDir('state-compact-');
    const store = new SessionStore(root);
    await store.create({
      id: 'session_compact_test',
      workDir: root,
    });
    const statePath = join(
      store.sessionDirFor({ id: 'session_compact_test', workDir: root }),
      'state.json',
    );
    await writeFile(statePath, `${JSON.stringify({ title: 'seed', workDir: root })}\n`, 'utf-8');
    await store.rename('session_compact_test', 'compact-title');
    const text = await readFile(statePath, 'utf-8');
    expect(text.includes('\n  ')).toBe(false);
    expect(JSON.parse(text).title).toBe('compact-title');
  });
});

describe('collectStorageGarbage', () => {
  it('does not touch active session wires and reports dry-run', async () => {
    const home = await tempDir('gc-home-');
    const sessionDir = join(home, 'sessions', 'wd_test', 'session_active');
    const agentDir = join(sessionDir, 'agents', 'agent-1');
    await mkdir(agentDir, { recursive: true });
    const wire = join(agentDir, WIRE_JSONL);
    await writeFile(wire, '{"type":"message"}\n', 'utf-8');
    await writeFile(join(sessionDir, 'state.json'), '{}', 'utf-8');
    // fresh mtime => active
    const now = Date.now();
    await utimes(wire, now / 1000, now / 1000);
    await utimes(join(sessionDir, 'state.json'), now / 1000, now / 1000);

    // idle cache extract
    const cacheDir = join(home, 'cache', 'old-extract');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'blob'), 'x'.repeat(100), 'utf-8');
    const old = (now - 10 * 24 * 60 * 60 * 1000) / 1000;
    await utimes(cacheDir, old, old);

    // idle closed session wire
    const idleSession = join(home, 'sessions', 'wd_test', 'session_idle');
    const idleAgent = join(idleSession, 'agents', 'agent-1');
    await mkdir(idleAgent, { recursive: true });
    const idleWire = join(idleAgent, WIRE_JSONL);
    await writeFile(idleWire, '{"type":"message","id":"idle"}\n', 'utf-8');
    await writeFile(join(idleSession, 'state.json'), '{}', 'utf-8');
    await utimes(idleWire, old, old);
    await utimes(join(idleSession, 'state.json'), old, old);

    const dry = await collectStorageGarbage({
      homeDir: home,
      dryRun: true,
      idleMs: 7 * 24 * 60 * 60 * 1000,
      now,
    });
    expect(dry.dryRun).toBe(true);
    // active wire still plain
    await expect(stat(wire)).resolves.toBeTruthy();
    // dry-run did not delete cache
    await expect(stat(cacheDir)).resolves.toBeTruthy();
    expect(dry.items.some((i) => i.kind === 'skipped-active')).toBe(true);
    expect(dry.items.some((i) => i.kind === 'cache' || i.kind === 'wire-gzip')).toBe(true);

    const applied = await collectStorageGarbage({
      homeDir: home,
      dryRun: false,
      idleMs: 7 * 24 * 60 * 60 * 1000,
      now,
    });
    expect(applied.deleted + applied.compressed).toBeGreaterThan(0);
    // active still present
    await expect(stat(wire)).resolves.toBeTruthy();
    // idle compressed
    await expect(stat(join(idleAgent, WIRE_JSONL_GZ))).resolves.toBeTruthy();
  });

  it('measureStorageBytes reports home/sessions/cache/logs', async () => {
    const home = await tempDir('bytes-');
    await mkdir(join(home, 'sessions'), { recursive: true });
    await mkdir(join(home, 'cache'), { recursive: true });
    await mkdir(join(home, 'logs'), { recursive: true });
    await writeFile(join(home, 'sessions', 'a.txt'), '12345', 'utf-8');
    await writeFile(join(home, 'cache', 'b.txt'), '1234567890', 'utf-8');
    await writeFile(join(home, 'logs', 'c.txt'), '12', 'utf-8');
    const report = await measureStorageBytes(home);
    expect(report.sessionsBytes).toBeGreaterThanOrEqual(5);
    expect(report.cacheBytes).toBeGreaterThanOrEqual(10);
    expect(report.logsBytes).toBeGreaterThanOrEqual(2);
    expect(report.homeBytes).toBeGreaterThanOrEqual(report.sessionsBytes);
    expect(formatBytes(1024)).toContain('KB');
  });

  it('skips locked idle wires via isPathLocked seam', async () => {
    const home = await tempDir('gc-locked-');
    const sessionDir = join(home, 'sessions', 'wd_test', 'session_locked');
    const agentDir = join(sessionDir, 'agents', 'agent-1');
    await mkdir(agentDir, { recursive: true });
    const wire = join(agentDir, WIRE_JSONL);
    await writeFile(wire, '{"type":"message","id":"locked"}\n', 'utf-8');
    await writeFile(join(sessionDir, 'state.json'), '{}', 'utf-8');
    const now = Date.now();
    const old = (now - 10 * 24 * 60 * 60 * 1000) / 1000;
    await utimes(wire, old, old);
    await utimes(join(sessionDir, 'state.json'), old, old);

    const lockedPaths: string[] = [];
    const report = await collectStorageGarbage({
      homeDir: home,
      dryRun: false,
      idleMs: 7 * 24 * 60 * 60 * 1000,
      now,
      pruneCache: false,
      pruneWorktreeTmp: false,
      isPathLocked: async (path) => {
        lockedPaths.push(path);
        return true;
      },
    });

    expect(lockedPaths.some((p) => p.endsWith(WIRE_JSONL))).toBe(true);
    expect(report.items.some((i) => i.kind === 'skipped-locked' && i.action === 'skip')).toBe(
      true,
    );
    await expect(stat(wire)).resolves.toBeTruthy();
    await expect(stat(join(agentDir, WIRE_JSONL_GZ))).rejects.toThrow();
  });
});
