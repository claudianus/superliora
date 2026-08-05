import { describe, expect, it, vi } from 'vitest';

import { showCompactionSettings } from '#/tui/commands/config/context/compaction-settings';
import {
  CONTEXT_INSTRUCTION_SOFT_TIP,
  CONTEXT_LEARNING_SOFT_TIP,
  CONTEXT_WORKING_SET_TIP,
  showContextSettings,
} from '#/tui/commands/config/context/context-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function selectPickerAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

function makeSettingsHost(
  options: {
    memoryStats?: {
      total: number;
      active: number;
      archived: number;
      deleted: number;
      byType: Record<string, number>;
      candidates: number;
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
      centerModalStack: [] as readonly unknown[],
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
            byType: { fact: 2, event: 0, procedure: 0, task: 0, rule: 0 },
            byScope: { user: 2, workspace: 0, session: 0 },
            candidates: 0,
          },
        ),
      },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
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
      })),
      getContext: vi.fn(async () => ({ contextArchive: { entryCount: 1, maxEntries: 512 } })),
    })) as never;
    showCompactionSettings(host);
    selectPickerAction(host, 'status');
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

  it('exports working-set, instruction, and learning tips (glance copy, not menu rows)', () => {
    expect(CONTEXT_WORKING_SET_TIP).toContain('soft cap');
    expect(CONTEXT_INSTRUCTION_SOFT_TIP).toContain('AGENTS.md');
    expect(CONTEXT_LEARNING_SOFT_TIP).toContain('Liora Memory');
  });
});

describe('showContextSettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
    const host = makeSettingsHost();
    showContextSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'working-set',
      'compaction',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });

  it('context panel explains Instruction vs Learning memory with live wiring', async () => {
    const host = makeSettingsHost();
    showContextSettings(host);
    selectPickerAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('Instruction vs Learning');
    expect(lines).toContain('Live');
    expect(lines).toContain('Instruction files:');
    expect(lines).toContain('Learning (Liora Memory): 2 active / 2 total');
    expect(lines).toContain('/memory remember');
    expect(lines).toContain('/context');
    expect(lines).toContain('no PR bot yet');
    expect(host.harness.memory.stats).toHaveBeenCalled();
  });
});
