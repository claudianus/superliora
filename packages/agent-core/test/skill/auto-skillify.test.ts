import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'pathe';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it, mock, test } from 'node:test';

import {
  batchSkillify,
  detectInsightCandidates,
  detectSkillifiableEvents,
  deduplicateAndFilter,
  DEFAULT_MIN_QUALITY_SCORE,
  scoreCandidate,
  skillContentHash,
  skillify,
  type SkillCandidate,
  type ToolCallEvent,
} from '../../src/skill/auto-skillify';

describe('auto-skillify — detectSkillifiableEvents', () => {
  test('detects retry recovery when a tool succeeds after retries', () => {
    const events: ToolCallEvent[] = [
      { toolName: 'Bash', success: true, retryCount: 2, error: 'timeout', inputSummary: 'ls', outputSummary: 'file.txt' },
    ];
    const candidates = detectSkillifiableEvents(events);
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0]!.name.startsWith('retry-bash-'));
    assert.ok(candidates[0]!.qualityScore > 0);
  });

  test('detects recoverable errors from failed tool calls', () => {
    const events: ToolCallEvent[] = [
      { toolName: 'Read', success: false, retryCount: 0, error: 'ENOENT: no such file' },
    ];
    const candidates = detectSkillifiableEvents(events);
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0]!.name.startsWith('debug-read-'));
  });

  test('ignores successful first-try tool calls', () => {
    const events: ToolCallEvent[] = [
      { toolName: 'Grep', success: true, retryCount: 0 },
    ];
    const candidates = detectSkillifiableEvents(events);
    assert.equal(candidates.length, 0);
  });

  test('ignores non-recoverable errors', () => {
    const events: ToolCallEvent[] = [
      { toolName: 'Write', success: false, retryCount: 0, error: 'permission denied by policy' },
    ];
    const candidates = detectSkillifiableEvents(events);
    assert.equal(candidates.length, 0);
  });
});

describe('auto-skillify — detectInsightCandidates', () => {
  test('converts insight events to candidates', () => {
    const candidates = detectInsightCandidates([
      { type: 'insight', description: 'Using LioraRead before Read saves context budget significantly', context: 'Large file exploration' },
    ]);
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0]!.qualityScore > DEFAULT_MIN_QUALITY_SCORE);
  });

  test('converts mistake events to candidates', () => {
    const candidates = detectInsightCandidates([
      { type: 'mistake', description: 'Forgot to re-read file before editing after a compaction', toolName: 'Edit' },
    ]);
    assert.equal(candidates.length, 1);
  });
});

describe('auto-skillify — scoreCandidate', () => {
  test('insight type scores higher than mistake', () => {
    const insightScore = scoreCandidate('insight', 'A sufficiently detailed insight description for testing purposes here');
    const mistakeScore = scoreCandidate('mistake', 'A sufficiently detailed mistake description for testing purposes here');
    assert.ok(insightScore > mistakeScore);
  });

  test('longer description with context scores higher', () => {
    // Use a low-base type so the cap doesn't mask the context bonus
    const withContext = scoreCandidate('mistake', 'Short', 'extra context about the situation that adds value');
    const withoutContext = scoreCandidate('mistake', 'Short');
    assert.ok(withContext > withoutContext);
  });
});

describe('auto-skillify — deduplicateAndFilter', () => {
  test('filters out candidates below quality threshold', () => {
    const candidates: SkillCandidate[] = [
      { name: 'a', description: 'd', whenToUse: 'w', body: 'b', sourceEvent: { type: 'insight', description: 'd' }, qualityScore: 0.2 },
      { name: 'b', description: 'd', whenToUse: 'w', body: 'b', sourceEvent: { type: 'insight', description: 'd' }, qualityScore: 0.8 },
    ];
    const filtered = deduplicateAndFilter(candidates, [], 0.5);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.name, 'b');
  });

  test('filters out duplicates against existing skill names', () => {
    const candidates: SkillCandidate[] = [
      { name: 'existing-skill', description: 'd', whenToUse: 'w', body: 'b', sourceEvent: { type: 'insight', description: 'd' }, qualityScore: 0.9 },
      { name: 'new-skill', description: 'd', whenToUse: 'w', body: 'b', sourceEvent: { type: 'insight', description: 'd' }, qualityScore: 0.9 },
    ];
    const filtered = deduplicateAndFilter(candidates, ['existing-skill'], 0.5);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.name, 'new-skill');
  });

  test('filters out duplicate names within the same batch', () => {
    const candidates: SkillCandidate[] = [
      { name: 'dup', description: 'd', whenToUse: 'w', body: 'b', sourceEvent: { type: 'insight', description: 'd' }, qualityScore: 0.9 },
      { name: 'dup', description: 'd2', whenToUse: 'w', body: 'b', sourceEvent: { type: 'insight', description: 'd2' }, qualityScore: 0.9 },
    ];
    const filtered = deduplicateAndFilter(candidates, [], 0.5);
    assert.equal(filtered.length, 1);
  });
});

describe('auto-skillify — skillify', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(tmpdir(), `auto-skillify-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test('writes SKILL.md with front-matter and body', async () => {
    const candidate: SkillCandidate = {
      name: 'test-skill',
      description: 'A test skill for unit testing',
      whenToUse: 'When testing',
      body: '# Test Skill\n\n## What happened\n\nTest content',
      sourceEvent: { type: 'insight', description: 'A test skill for unit testing' },
      qualityScore: 0.9,
    };

    const writtenPath = await skillify(candidate, {
      skillsDir: tmpDir,
      existingSkillNames: [],
    });

    const content = await fs.readFile(writtenPath, 'utf-8');
    assert.ok(content.includes('name: test-skill'));
    assert.ok(content.includes('source: auto'));
    assert.ok(content.includes('# Test Skill'));
    assert.ok(content.includes('When testing'));
  });

  test('creates the auto/ subdirectory structure', async () => {
    const candidate: SkillCandidate = {
      name: 'nested-test',
      description: 'Tests directory creation',
      whenToUse: 'When testing',
      body: 'Body',
      sourceEvent: { type: 'insight', description: 'Tests directory creation' },
      qualityScore: 0.8,
    };

    const writtenPath = await skillify(candidate, {
      skillsDir: tmpDir,
      existingSkillNames: [],
    });

    assert.ok(writtenPath.includes(path.join('auto', 'nested-test', 'SKILL.md')));
    const stat = await fs.stat(writtenPath);
    assert.ok(stat.isFile());
  });

  test('throws on below-threshold candidate', async () => {
    const candidate: SkillCandidate = {
      name: 'low-quality',
      description: 'low',
      whenToUse: 'w',
      body: 'b',
      sourceEvent: { type: 'mistake', description: 'low' },
      qualityScore: 0.1,
    };

    await assert.rejects(
      skillify(candidate, { skillsDir: tmpDir, existingSkillNames: [], minQualityScore: 0.5 }),
      /below threshold/,
    );
  });

  test('skips writing if file content is unchanged', async () => {
    const candidate: SkillCandidate = {
      name: 'idempotent',
      description: 'Should not rewrite identical content',
      whenToUse: 'When testing idempotency',
      body: '# Idempotent Skill',
      sourceEvent: { type: 'insight', description: 'Should not rewrite identical content' },
      qualityScore: 0.8,
    };

    const options = { skillsDir: tmpDir, existingSkillNames: [] };
    const path1 = await skillify(candidate, options);
    const path2 = await skillify(candidate, options);
    assert.equal(path1, path2);
  });
});

describe('auto-skillify — batchSkillify', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(tmpdir(), `auto-skillify-batch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test('writes all passing candidates and returns paths', async () => {
    const candidates: SkillCandidate[] = [
      { name: 'batch-1', description: 'First skill', whenToUse: 'When 1', body: '# 1', sourceEvent: { type: 'insight', description: 'First skill' }, qualityScore: 0.8 },
      { name: 'batch-2', description: 'Second skill', whenToUse: 'When 2', body: '# 2', sourceEvent: { type: 'insight', description: 'Second skill' }, qualityScore: 0.7 },
      { name: 'batch-low', description: 'Low quality', whenToUse: 'When low', body: '# low', sourceEvent: { type: 'mistake', description: 'Low quality' }, qualityScore: 0.2 },
    ];

    const paths = await batchSkillify(candidates, {
      skillsDir: tmpDir,
      existingSkillNames: [],
    });

    assert.equal(paths.length, 2);
    for (const p of paths) {
      assert.ok(p.endsWith('SKILL.md'));
    }
  });

  test('filters out candidates that duplicate existing skills', async () => {
    const candidates: SkillCandidate[] = [
      { name: 'existing', description: 'Already exists', whenToUse: 'w', body: 'b', sourceEvent: { type: 'insight', description: 'd' }, qualityScore: 0.9 },
      { name: 'new-one', description: 'New skill', whenToUse: 'w', body: 'b', sourceEvent: { type: 'insight', description: 'd' }, qualityScore: 0.9 },
    ];

    const paths = await batchSkillify(candidates, {
      skillsDir: tmpDir,
      existingSkillNames: ['existing'],
    });

    assert.equal(paths.length, 1);
    assert.ok(paths[0].includes('new-one'));
  });
});

describe('auto-skillify — skillContentHash', () => {
  test('returns a 16-char hex string', () => {
    const hash = skillContentHash('test body content');
    assert.equal(hash.length, 16);
    assert.match(hash, /^[a-f0-9]+$/);
  });

  test('different content produces different hashes', () => {
    const hash1 = skillContentHash('content a');
    const hash2 = skillContentHash('content b');
    assert.notEqual(hash1, hash2);
  });
});