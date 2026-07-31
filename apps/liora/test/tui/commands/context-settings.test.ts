import { describe, expect, it, vi } from 'vitest';

import { showCompactionSettings } from '#/tui/commands/config/compaction-settings';
import { showContextSettings } from '#/tui/commands/config/context-settings';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeSettingsHost(
  options: {
    memoryStats?: {
      total: number;
      active: number;
      archived: number;
      deleted: number;
      byKind: Record<string, number>;
      byScope: Record<string, number>;
    };
    workDir?: string;
  } = {},
) {
  const transcriptContainer = { addChild: vi.fn() };
  return {
    state: {
      transcriptContainer,
      transcriptEntries: [],
      appState: {
        model: '',
        availableModels: {},
        workDir: options.workDir,
      },
      renderer: { invalidateFrame: vi.fn() },
    },
    harness: {
      homeDir: '/tmp/.superliora-test',
      getConfig: vi.fn(async () => ({
        loopControl: {
          maxWorkingSetTokens: 256_000,
          asyncWorkingSetTokens: 128_000,
          compactionTriggerRatio: 0.7,
        },
      })),
      memory: {
        stats: vi.fn(async () =>
          options.memoryStats ?? {
            total: 2,
            active: 2,
            archived: 0,
            deleted: 0,
            byKind: { semantic: 2, episodic: 0, procedural: 0, prospective: 0 },
            byScope: { user: 2, workspace: 0, session: 0 },
          },
        ),
      },
    },
  } as unknown as SlashCommandHost;
}

describe('W9 compaction/context settings tips', () => {
  it('compaction panel mentions structured handoff and Expand recover', async () => {
    const host = makeSettingsHost();
    host.requireSession = vi.fn(() => ({
      getStatus: vi.fn(async () => ({
        contextUsage: 0.5,
        contextTokens: 100_000,
        maxContextTokens: 256_000,
        microCompaction: {
          total: 1,
          lastTrigger: 'tool_clear',
          lastContextUsageRatio: 0.6,
          byTrigger: { tool_clear: 1 },
        },
      })),
      getContext: vi.fn(async () => ({ contextArchive: { entryCount: 1, maxEntries: 512 } })),
    })) as never;
    showCompactionSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('Structured handoff');
    expect(lines).toContain('Objective · Work state · Next move · Relevant files');
    expect(lines).toContain('Expand recover');
    expect(lines).toContain('Expand(id=<archiveId>)');
    expect(lines).toContain('archiveId=<12-hex>');
    expect(lines).toContain('context-archive store');
    expect(lines).toContain('[liora-archived id=');
    expect(lines).toContain('~/.superliora/tool-results/');
    expect(lines).toContain('Context archive: 1 entry');
    expect(lines).toContain('── Session (live) ──');
  });

  it('context panel explains Instruction vs Learning memory with live wiring', async () => {
    const host = makeSettingsHost();
    showContextSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('Instruction vs Learning');
    expect(lines).toContain('Live');
    expect(lines).toContain('Instruction files:');
    expect(lines).toContain('Learning (Liora Recall): 2 active / 2 total');
    expect(lines).toContain('/memory remember');
    expect(lines).toContain('/context');
    expect(lines).toContain('Trace→Skill draft tips');
    expect(lines).toContain('no PR bot yet');
    expect(host.harness.memory.stats).toHaveBeenCalled();
  });
});
