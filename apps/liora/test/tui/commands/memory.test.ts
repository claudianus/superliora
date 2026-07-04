import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MemoryRecord, MemoryStats } from '@superliora/sdk';
import { describe, expect, it, vi } from 'vitest';

import { memoryArgumentCompletions } from '#/tui/commands/registry';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import {
  buildMemoryReadinessLines,
  handleMemoryCommand,
  loadMemoryReadinessEvidence,
  redactMemoryReadinessText,
} from '#/tui/commands/memory';
import { createUltraworkEvidenceSeed } from '#/tui/commands/ultrawork';

describe('memory readiness slash command builders', () => {
  it('builds a concise redacted readiness panel from stats, recall, and evidence', () => {
    const lines = buildMemoryReadinessLines({
      stats: memoryStats({ total: 2, active: 2 }),
      query: 'launch recall',
      searchResults: [
        {
          score: 0.91,
          reasons: ['subject'],
          memory: memoryRecord('recall launch token sk-proj-1234567890abcdef'),
        },
      ],
      evidence: {
        sourceRoot: '/repo/.superliora/evidence',
        llmWiki: {
          ready: true,
          matchCount: 1,
          sourcePath: '/repo/.superliora/evidence/llm-wiki.md',
          summary: 'evidence found',
        },
        knowledgeMap: {
          ready: true,
          matchCount: 1,
          sourcePath: '/repo/.superliora/evidence/liora-knowledge-map.json',
          summary: 'evidence found',
        },
        browserUse: {
          ready: true,
          matchCount: 2,
          sourcePath: '/repo/.superliora/evidence/browser-use.json',
          summary: 'evidence found',
        },
        computerUse: {
          ready: true,
          matchCount: 1,
          sourcePath: '/repo/.superliora/evidence/computer-use-state.json',
          summary: 'evidence found',
        },
        warnings: [],
      },
    });
    const text = lines.join('\n');

    expect(text).toContain('Durable memory  active 2 / total 2');
    expect(text).toContain('Recall search  1 matches for "launch recall"; top 0.91 recall launch token [REDACTED_SECRET]');
    expect(text).toContain('LLM-wiki/durable  ready; 1 match');
    expect(text).toContain('Knowledge-map evidence  ready; 1 match');
    expect(text).toContain('Browser-use evidence  ready; 2 matches');
    expect(text).toContain('Computer-use evidence  ready; 1 match');
    expect(text).toContain('Next  Ready: run the harness with current recall and evidence.');
    expect(text).not.toContain('sk-proj-1234567890abcdef');
  });

  it('degrades honestly for empty memory and missing evidence', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-memory-readiness-empty-'));
    try {
      const evidence = loadMemoryReadinessEvidence(workDir);
      const lines = buildMemoryReadinessLines({
        stats: memoryStats({ total: 0, active: 0 }),
        query: '',
        evidence,
      });
      const text = lines.join('\n');

      expect(text).toContain('Durable memory  active 0 / total 0');
      expect(text).toContain('Recall search  skipped; pass a query to verify retrieval');
      expect(text).toContain('Knowledge-map evidence  missing; No Liora Knowledge Map evidence found.');
      expect(text).toContain('Browser-use evidence  missing; No browser-use evidence found.');
      expect(text).toContain('Computer-use evidence  missing; No computer-use evidence found.');
      expect(text).toContain('Next  Create a durable memory with /memory remember <subject> :: <content>.');
      expect(text).toContain('Warning  No local evidence found at');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('loads browser-use, computer-use, knowledge-map, and llm-wiki evidence from local files', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-memory-readiness-evidence-'));
    try {
      const evidenceDir = join(workDir, '.superliora/evidence/g006');
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, 'llm-wiki.md'), 'llm-wiki durable memory readiness PASS');
      writeFileSync(
        join(evidenceDir, 'liora-knowledge-map.json'),
        '{"relationship_confidence":"EXTRACTED, INFERRED, or AMBIGUOUS","status":"PASS"}',
      );
      writeFileSync(join(evidenceDir, 'browser-use.json'), '{"tool":"browser-use","status":"PASS"}');
      writeFileSync(
        join(evidenceDir, 'computer-use-state.json'),
        '{"tool":"mcp__computer_use.get_app_state","status":"PASS"}',
      );

      const evidence = loadMemoryReadinessEvidence(workDir);

      expect(evidence.llmWiki.ready).toBe(true);
      expect(evidence.knowledgeMap.ready).toBe(true);
      expect(evidence.browserUse.ready).toBe(true);
      expect(evidence.computerUse.ready).toBe(true);
      expect(evidence.llmWiki.sourcePath).toContain('llm-wiki.md');
      expect(evidence.knowledgeMap.sourcePath).toContain('liora-knowledge-map.json');
      expect(evidence.browserUse.sourcePath).toContain('browser-use.json');
      expect(evidence.computerUse.sourcePath).toContain('computer-use-state.json');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('recognizes Ultrawork startup seed files as local LLM Wiki and knowledge-map evidence', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-memory-readiness-ultrawork-seed-'));
    try {
      const seed = createUltraworkEvidenceSeed(
        workDir,
        '갤러그 형태의 2D 게임이고 아이템도 있습니다. 비주얼 검사까지 해주세요.',
        'manual',
        false,
        new Date('2026-07-02T00:00:00.000Z'),
      );

      const evidence = loadMemoryReadinessEvidence(workDir);

      expect(seed.root).toContain('.superliora/evidence/ultrawork-runs');
      expect(evidence.llmWiki.ready).toBe(true);
      expect(evidence.knowledgeMap.ready).toBe(true);
      expect(evidence.browserUse.ready).toBe(false);
      expect(evidence.computerUse.ready).toBe(false);
      expect(evidence.llmWiki.sourcePath).toContain('llm-wiki.md');
      expect(evidence.knowledgeMap.sourcePath).toContain('liora-knowledge-map.json');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('recognizes project-local LLM Wiki v2 index and manifest even without run evidence', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-memory-readiness-wiki-v2-'));
    try {
      const seed = createUltraworkEvidenceSeed(
        workDir,
        'Improve LLM Wiki quality without leaking secrets token=secret-value',
        'manual',
        false,
        new Date('2026-07-02T00:00:00.000Z'),
      );
      rmSync(join(workDir, '.superliora/evidence'), { recursive: true, force: true });

      const evidence = loadMemoryReadinessEvidence(workDir);

      expect(seed.wikiIndexPath).toBe('.superliora/wiki/index.md');
      expect(evidence.llmWiki.ready).toBe(true);
      expect(evidence.llmWiki.sourcePath).toContain('.superliora/wiki/index.md');
      expect(evidence.knowledgeMap.ready).toBe(false);
      expect(evidence.warnings.join('\n')).not.toContain('Malformed');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('shows project-local LLM Wiki status through /memory wiki', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-memory-wiki-command-'));
    try {
      createUltraworkEvidenceSeed(
        workDir,
        'Document the harness wiki layer',
        'manual',
        false,
        new Date('2026-07-02T00:00:00.000Z'),
      );
      const host = {
        state: { appState: { workDir } },
        showNotice: vi.fn(),
      } as unknown as SlashCommandHost;

      await handleMemoryCommand(host, 'wiki');

      expect(host.showNotice).toHaveBeenCalledWith(
        'LLM Wiki',
        expect.stringContaining('State  ready'),
      );
      expect(host.showNotice).toHaveBeenCalledWith(
        'LLM Wiki',
        expect.stringContaining('.superliora/wiki/index.md'),
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('does not treat research notes as browser or computer-use runtime evidence', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-memory-readiness-research-'));
    try {
      const evidenceDir = join(workDir, '.superliora/evidence/superliora-g006-memory-readiness');
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(
        join(evidenceDir, 'research-adoption-matrix.md'),
        'LLM-wiki says browser-use and computer-use should report status=pass only from runtime evidence.',
      );

      const evidence = loadMemoryReadinessEvidence(workDir);

      expect(evidence.llmWiki.ready).toBe(true);
      expect(evidence.knowledgeMap.ready).toBe(false);
      expect(evidence.browserUse.ready).toBe(false);
      expect(evidence.computerUse.ready).toBe(false);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('ignores malformed json evidence instead of claiming readiness', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-memory-readiness-malformed-'));
    try {
      const evidenceDir = join(workDir, '.superliora/evidence/g006');
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, 'browser-use.json'), '{"tool":"browser-use",');

      const evidence = loadMemoryReadinessEvidence(workDir);

      expect(evidence.browserUse.ready).toBe(false);
      expect(evidence.warnings.join('\n')).toContain('Malformed evidence ignored');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('summarizes malformed evidence warnings so readiness panels stay scannable', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-memory-readiness-warning-summary-'));
    try {
      const evidenceDir = join(workDir, '.superliora/evidence/g006');
      mkdirSync(evidenceDir, { recursive: true });
      for (let index = 0; index < 5; index += 1) {
        writeFileSync(join(evidenceDir, `bad-${index}.json`), '{"status":"PASS",');
      }

      const evidence = loadMemoryReadinessEvidence(workDir);
      const malformedWarnings = evidence.warnings.filter((warning) => warning.startsWith('Malformed evidence ignored: '));

      expect(malformedWarnings).toHaveLength(4);
      expect(evidence.warnings.join('\n')).toContain('Malformed evidence ignored: 5 files total; 2 more hidden');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('does not offer internal readiness and health subcommands in memory completions', () => {
    const primaryValues = memoryArgumentCompletions('')?.map((item) => item.value);
    const healthValues = memoryArgumentCompletions('h')?.map((item) => item.value);
    const readinessValues = memoryArgumentCompletions('r')?.map((item) => item.value);

    expect(primaryValues).toContain('wiki');
    expect(healthValues).toBeUndefined();
    expect(readinessValues).toEqual(['remember']);
  });

  it('redacts secret-looking text defensively', () => {
    expect(
      redactMemoryReadinessText(
        'api_key=secret-value KIMI_MODEL_API_KEY sk-proj-1234567890abcdef',
      ),
    ).toBe('api_key=[REDACTED_SECRET] [REDACTED_ENV] [REDACTED_SECRET]');
  });
});

function memoryStats(input: { readonly total: number; readonly active: number }): MemoryStats {
  return {
    total: input.total,
    active: input.active,
    archived: 0,
    deleted: 0,
    byKind: {
      semantic: input.active,
      episodic: 0,
      procedural: 0,
      prospective: 0,
      governance: 0,
    },
    byScope: {
      user: input.active,
      workspace: 0,
      session: 0,
    },
  };
}

function memoryRecord(subject: string): MemoryRecord {
  return {
    id: 'mem_1',
    kind: 'semantic',
    scope: 'workspace',
    subject,
    content: 'Harness readiness memory.',
    tags: ['manual'],
    confidence: 1,
    importance: 1,
    status: 'active',
    source: { kind: 'user' },
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    supersedes: [],
    metadata: {},
  };
}
