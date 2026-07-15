import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadMemoryReadinessEvidence } from '#/tui/commands/evidence-readiness';
import { createUltraworkEvidenceSeed } from '#/tui/commands/ultrawork';

describe('evidence readiness evaluator', () => {
  it('prefers wiki v2 index over legacy llm-wiki evidence paths', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-evidence-readiness-wiki-v2-'));
    try {
      await createUltraworkEvidenceSeed(workDir, 'Document wiki v2 canonical path', 'manual', false);

      const evidence = loadMemoryReadinessEvidence(workDir);

      expect(evidence.llmWiki.ready).toBe(true);
      expect(evidence.llmWiki.sourcePath).toContain('.superliora/wiki/index.md');
      expect(evidence.llmWiki.tier).toBe('seed');
      expect(evidence.llmWiki.verified).toBe(false);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('treats legacy llm-wiki markdown as verified fallback evidence', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-evidence-readiness-legacy-'));
    try {
      const evidenceDir = join(workDir, '.superliora/evidence/legacy');
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, 'llm-wiki.md'), 'llm-wiki durable memory readiness PASS');

      const evidence = loadMemoryReadinessEvidence(workDir);

      expect(evidence.llmWiki.ready).toBe(true);
      expect(evidence.llmWiki.verified).toBe(true);
      expect(evidence.llmWiki.tier).toBe('legacy');
      expect(evidence.llmWiki.sourcePath).toContain('llm-wiki.md');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('promotes knowledge maps with explicit verified state', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-evidence-readiness-knowledge-map-'));
    try {
      const evidenceDir = join(workDir, '.superliora/evidence/verified-map');
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(
        join(evidenceDir, 'liora-knowledge-map.json'),
        JSON.stringify({
          kind: 'liora knowledge map',
          evidenceState: 'verified',
          relationship_confidence: [],
        }),
      );

      const evidence = loadMemoryReadinessEvidence(workDir);

      expect(evidence.knowledgeMap.ready).toBe(true);
      expect(evidence.knowledgeMap.verified).toBe(true);
      expect(evidence.knowledgeMap.tier).toBe('verified');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
