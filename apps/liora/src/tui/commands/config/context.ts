/**
 * Context working-set slash command handlers and pickers extracted from config.ts.
 *
 * Covers: /context command, working-set preset picker, status display,
 * and preset application logic.
 */

import { ContextWorkingSetSelectorComponent } from '../../components/dialogs/context-working-set-selector';
import { formatErrorMessage } from '../../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';
import {
  contextWorkingSetPresetById,
  contextWorkingSetSnapshotFromLoopControl,
  formatTokenCount,
  loopControlPatchForPreset,
  matchContextWorkingSetPreset,
  previewContextWorkingSet,
  type ContextWorkingSetPresetId,
} from '#/tui/utils/agent/context-working-set';
import type { SlashCommandHost } from '../dispatch';

/**
 * /context [economy|balanced|deep|full|status] — open the working-set picker
 * or apply a named preset without the dialog.
 */
export async function handleContextCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const raw = args.trim().toLowerCase();
  if (raw.length === 0) {
    await showContextWorkingSetPicker(host);
    return;
  }
  if (raw === 'status' || raw === 'show') {
    await showContextWorkingSetStatus(host);
    return;
  }
  const presetId = normalizeContextPresetArg(raw);
  if (presetId === undefined) {
    host.showError(
      `Unknown context preset: ${args.trim()}. Use economy, balanced, deep, full, or status.`,
    );
    return;
  }
  await applyContextWorkingSetPreset(host, presetId);
}

export async function showContextWorkingSetPicker(host: SlashCommandHost): Promise<void> {
  let currentPresetId: ContextWorkingSetPresetId | undefined;
  let maxContextTokens: number | undefined;
  try {
    const config = await host.harness.getConfig({ reload: true });
    currentPresetId = matchContextWorkingSetPreset({
      maxWorkingSetTokens: config.loopControl?.maxWorkingSetTokens,
      asyncWorkingSetTokens: config.loopControl?.asyncWorkingSetTokens,
    });
    maxContextTokens = resolveActiveMaxContextTokens(host);
  } catch (error) {
    host.showError(`Failed to load context settings: ${formatErrorMessage(error)}`);
    return;
  }

  mountPickerDialog(host, 
    new ContextWorkingSetSelectorComponent({
      currentPresetId,
      maxContextTokens,
      onSelect: (presetId) => {
        dismissPickerDialog(host);
        void applyContextWorkingSetPreset(host, presetId);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
  );
}

async function showContextWorkingSetStatus(host: SlashCommandHost): Promise<void> {
  try {
    const config = await host.harness.getConfig({ reload: true });
    const max = config.loopControl?.maxWorkingSetTokens;
    const async = config.loopControl?.asyncWorkingSetTokens;
    const matched = matchContextWorkingSetPreset({
      maxWorkingSetTokens: max,
      asyncWorkingSetTokens: async,
    });
    const maxContextTokens = resolveActiveMaxContextTokens(host);
    const preset = matched !== undefined ? contextWorkingSetPresetById(matched) : undefined;
    const preview =
      preset !== undefined
        ? previewContextWorkingSet({ preset, maxContextTokens })
        : undefined;
    const lines = [
      `Context working set: ${matched ?? 'custom'}`,
      `  maxWorkingSetTokens: ${max === undefined ? 'default' : formatTokenCount(max)}`,
      `  asyncWorkingSetTokens: ${async === undefined ? 'default' : formatTokenCount(async)}`,
      `  model window: ${
        maxContextTokens !== undefined ? formatTokenCount(maxContextTokens) : 'unknown'
      }`,
    ];
    if (preview !== undefined) {
      lines.push(`  effective: ${preview.softLabel} · ${preview.asyncLabel}`);
    }
    host.showStatus(lines.join('\n'));
  } catch (error) {
    host.showError(`Failed to read context settings: ${formatErrorMessage(error)}`);
  }
}

async function applyContextWorkingSetPreset(
  host: SlashCommandHost,
  presetId: ContextWorkingSetPresetId,
): Promise<void> {
  const preset = contextWorkingSetPresetById(presetId);
  if (preset === undefined) {
    host.showError(`Unknown context preset: ${presetId}`);
    return;
  }

  try {
    const config = await host.harness.getConfig({ reload: true });
    const patch = loopControlPatchForPreset(preset);
    await host.harness.setConfig({
      loopControl: {
        ...config.loopControl,
        maxWorkingSetTokens: patch.maxWorkingSetTokens,
        asyncWorkingSetTokens: patch.asyncWorkingSetTokens,
      },
    });

    host.setAppState({
      workingSet: contextWorkingSetSnapshotFromLoopControl({
        maxWorkingSetTokens: patch.maxWorkingSetTokens,
        asyncWorkingSetTokens: patch.asyncWorkingSetTokens,
      }),
    });

    const maxContextTokens = resolveActiveMaxContextTokens(host);
    const preview = previewContextWorkingSet({ preset, maxContextTokens });
    host.track('context_working_set_changed', { preset: presetId });
    host.showStatus(
      `Context set to ${preset.label}. ${preview.softLabel} · ${preview.asyncLabel} (window ${preview.windowLabel}). Reload the session if a turn is already in progress.`,
      'success',
    );
  } catch (error) {
    host.showError(`Failed to update context settings: ${formatErrorMessage(error)}`);
  }
}

function resolveActiveMaxContextTokens(host: SlashCommandHost): number | undefined {
  const alias = host.state.appState.model.trim();
  if (alias.length === 0) return undefined;
  const model = host.state.appState.availableModels[alias];
  const size = model?.maxContextSize;
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return undefined;
  return size;
}

function normalizeContextPresetArg(raw: string): ContextWorkingSetPresetId | undefined {
  if (raw === 'balanced' || raw === 'default' || raw === 'smart') return 'balanced';
  if (raw === 'economy' || raw === 'cheap' || raw === 'low') return 'economy';
  if (raw === 'deep' || raw === 'large' || raw === 'long') return 'deep';
  if (raw === 'full' || raw === 'full_window' || raw === 'full-window' || raw === 'off') {
    return 'full_window';
  }
  return undefined;
}
