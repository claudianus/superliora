import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildContextSettingsLines,
  discoverInstructionFiles,
  formatInstructionFilesLine,
  formatLearningMemoryLine,
} from '#/tui/utils/agent/context-glance';

describe('context glance', () => {
  it('discovers project AGENTS.md and CLAUDE.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'ctx-glance-'));
    try {
      writeFileSync(join(root, 'AGENTS.md'), '# project rules\n', 'utf8');
      writeFileSync(join(root, 'CLAUDE.md'), '# claude rules\n', 'utf8');
      const hits = discoverInstructionFiles({
        workDir: root,
        brandHome: join(root, '.brand'),
        realHome: join(root, 'home'),
      });
      const names = hits.map((hit) => hit.name);
      expect(names).toContain('AGENTS.md');
      expect(names).toContain('CLAUDE.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('formatInstructionFilesLine reports none when empty', () => {
    expect(formatInstructionFilesLine({ hits: [] })).toContain('none found');
  });

  it('formatLearningMemoryLine uses live counts when stats exist', () => {
    const line = formatLearningMemoryLine({
      stats: {
        total: 4,
        active: 3,
        archived: 1,
        deleted: 0,
        byKind: { semantic: 2, episodic: 1, procedural: 1, prospective: 0, governance: 0 },
        byScope: { user: 2, workspace: 2, session: 0 },
      },
    });
    expect(line).toContain('3 active / 4 total');
    expect(line).toContain('semantic 2');
  });

  it('buildContextSettingsLines includes live section', () => {
    const lines = buildContextSettingsLines({
      presetLine: 'Working-set preset: balanced',
      capLine: 'Caps: soft 256k · async 220k',
      instruction: { hits: [{ name: 'AGENTS.md', path: './AGENTS.md', scope: 'project' }] },
      memory: {
        stats: {
          total: 1,
          active: 1,
          archived: 0,
          deleted: 0,
          byKind: { semantic: 1, episodic: 0, procedural: 0, prospective: 0, governance: 0 },
          byScope: { user: 1, workspace: 0, session: 0 },
        },
      },
    });
    const text = lines.join('\n');
    expect(text).toContain('Instruction vs Learning');
    expect(text).toContain('Live');
    expect(text).toContain('AGENTS.md (./AGENTS.md)');
    expect(text).toContain('1 active / 1 total');
  });
});
