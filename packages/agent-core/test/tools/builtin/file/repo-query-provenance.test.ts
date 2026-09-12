import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Agent } from '../../../../src/agent';
import { createFileProvenanceHook } from '../../../../src/agent/tool/builtin-tools';
import { FileProvenanceRecorder } from '../../../../src/session/file-provenance';
import { RepoQueryTool } from '../../../../src/tools/builtin/file/repo-query';
import {
  formatProvenanceResultLine,
  parseRepoQueryInput,
  provenancePathFilter,
} from '../../../../src/tools/builtin/file/repo-query-core';
import { executeTool } from '../../fixtures/execute-tool';
import { createFakeKaos } from '../../fixtures/fake-kaos';

const WORKSPACE = { workspaceDir: '/ws', additionalDirs: [] };

function toolOutputText(result: { readonly output: unknown }): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

describe('provenancePathFilter', () => {
  it('normalizes separators and wildcards to match-all', () => {
    expect(provenancePathFilter('  src/a.ts ')).toBe('src/a.ts');
    expect(provenancePathFilter('src\\a.ts')).toBe('src/a.ts');
    expect(provenancePathFilter('*')).toBe('*');
    expect(provenancePathFilter('')).toBe('*');
  });
});

describe('formatProvenanceResultLine', () => {
  it('renders ranges, op, author, and timestamp', () => {
    const line = formatProvenanceResultLine({
      path: '/ws/a.ts',
      op: 'edit',
      ts: Date.UTC(2026, 8, 12, 10, 0, 0),
      added: [{ start: 2, end: 3 }],
      agentType: 'main',
      model: 'glm-5.3',
      turn: '7',
    });
    expect(line).toBe(
      '/ws/a.ts +L2-L3 [edit] by glm-5.3 (main, turn 7) at 2026-09-12T10:00:00.000Z',
    );
  });

  it('renders deletes and no-range records distinctly', () => {
    const base = {
      ts: Date.UTC(2026, 8, 12, 10, 0, 0),
      added: [],
      agentType: 'sub',
    };
    expect(formatProvenanceResultLine({ ...base, path: '/ws/gone.ts', op: 'delete' })).toBe(
      '/ws/gone.ts deleted by unknown-model (sub) at 2026-09-12T10:00:00.000Z',
    );
    expect(formatProvenanceResultLine({ ...base, path: '/ws/touch.ts', op: 'overwrite' })).toBe(
      '/ws/touch.ts no line changes [overwrite] by unknown-model (sub) at 2026-09-12T10:00:00.000Z',
    );
  });
});

describe('RepoQueryTool mode=provenance', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repo-query-provenance-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function sessionRecorder(
    mutations: readonly Parameters<FileProvenanceRecorder['record']>[0][],
  ): Promise<FileProvenanceRecorder> {
    const recorder = new FileProvenanceRecorder({ filePath: join(dir, 'provenance.ndjson') });
    const agent = {
      fileProvenance: recorder,
      type: 'main',
      config: { modelAlias: 'glm-5.3' },
      turn: { currentId: 2 },
    } as unknown as Agent;
    const hook = createFileProvenanceHook(agent);
    if (hook === undefined) throw new TypeError('expected a provenance hook');
    for (const mutation of mutations) {
      await hook.record(mutation);
    }
    return recorder;
  }

  it('soft-fails when no recorder is attached', async () => {
    const tool = new RepoQueryTool(createFakeKaos(), WORKSPACE);
    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'p0',
      args: { mode: 'provenance', query: '*' },
      signal: new AbortController().signal,
    });
    expect(result.isError).toBeFalsy();
    expect(toolOutputText(result)).toContain('No provenance recorder is attached');
  });

  it('lists matching records newest-first and respects the path filter', async () => {
    const recorder = await sessionRecorder([
      { path: '/ws/keep.ts', tool: 'Write', op: 'create', before: null, after: 'a\nb\n' },
      { path: '/ws/skip/other.ts', tool: 'Write', op: 'create', before: null, after: 'x\n' },
      { path: '/ws/keep.ts', tool: 'Edit', op: 'edit', before: 'a\nb\n', after: 'a\nB\nc\n' },
    ]);
    const tool = new RepoQueryTool(createFakeKaos(), WORKSPACE, undefined, { provenance: recorder });

    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'p1',
      args: { mode: 'provenance', query: 'keep.ts' },
      signal: new AbortController().signal,
    });
    expect(result.isError).toBeFalsy();
    const output = toolOutputText(result);
    expect(output).toContain('mode="provenance"');
    expect(output).toContain('/ws/keep.ts +L2-L3 [edit] by glm-5.3 (main, turn 2)');
    expect(output).toContain('/ws/keep.ts +L1-L2 [create]');
    expect(output).not.toContain('other.ts');
    const editIndex = output.indexOf('[edit]');
    const createIndex = output.indexOf('[create]');
    expect(editIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(editIndex);

    const everything = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'p2',
      args: { mode: 'provenance', query: '*' },
      signal: new AbortController().signal,
    });
    expect(String(everything.output)).toContain('other.ts');
  });

  it('reports an empty log without records', async () => {
    const recorder = await sessionRecorder([]);
    const tool = new RepoQueryTool(createFakeKaos(), WORKSPACE, undefined, { provenance: recorder });
    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'p3',
      args: { mode: 'provenance', query: '*' },
      signal: new AbortController().signal,
    });
    expect(toolOutputText(result)).toContain('No provenance records yet');
  });
});

describe('provenance mode input parsing', () => {
  it('accepts the provenance mode through the shared schema', () => {
    const parsed = parseRepoQueryInput({ mode: 'provenance', query: 'src/a.ts' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.mode).toBe('provenance');
  });
});
