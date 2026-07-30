/**
 * Context working-set picker — named presets for how early auto-compaction
 * fires on large model windows. Mounted from Settings → Context, or /context.
 */

import type { ChoiceOption } from './choice-picker';
import { ChoicePickerComponent } from './choice-picker';
import {
  CONTEXT_WORKING_SET_PRESETS,
  contextWorkingSetPresetById,
  formatTokenCount,
  matchContextWorkingSetPreset,
  previewContextWorkingSet,
  type ContextWorkingSetPresetId,
} from '#/tui/utils/agent/context-working-set';
import { currentTheme } from '#/tui/theme';

export interface ContextWorkingSetSelectorOptions {
  readonly currentPresetId?: ContextWorkingSetPresetId | undefined;
  readonly maxContextTokens?: number | undefined;
  readonly onSelect: (presetId: ContextWorkingSetPresetId) => void;
  readonly onCancel: () => void;
}

function isPresetId(value: string): value is ContextWorkingSetPresetId {
  return contextWorkingSetPresetById(value) !== undefined;
}

function buildOptions(maxContextTokens: number | undefined): ChoiceOption[] {
  return CONTEXT_WORKING_SET_PRESETS.map((preset) => {
    const preview = previewContextWorkingSet({
      preset,
      maxContextTokens,
    });
    const capLabel =
      preset.loop.maxWorkingSetTokens > 0
        ? `cap ${formatTokenCount(preset.loop.maxWorkingSetTokens)}`
        : 'cap off';
    return {
      value: preset.id,
      label: `${preset.label}  ·  ${preset.badge}`,
      description: `${preset.description} ${preview.softLabel} · ${preview.asyncLabel} · window ${preview.windowLabel} · ${capLabel}`,
      descriptionTone: preset.id === 'full_window' ? 'warning' : undefined,
    };
  });
}

function renderPresetPreview(
  option: ChoiceOption,
  width: number,
  maxContextTokens: number | undefined,
): readonly string[] {
  const preset = contextWorkingSetPresetById(option.value);
  if (preset === undefined) return [];
  const preview = previewContextWorkingSet({ preset, maxContextTokens });
  const pad = Math.max(1, width - 4);
  const lines = [
    currentTheme.fg(
      'textMuted',
      `    Soft full compact: ${preview.softLabel}`,
    ),
    currentTheme.fg(
      'textMuted',
      `    Async pre-rot:     ${preview.asyncLabel}`,
    ),
    currentTheme.fg(
      'textMuted',
      `    Model window:      ${preview.windowLabel}`,
    ),
  ];
  if (preset.id === 'full_window') {
    lines.push(
      currentTheme.fg(
        'warning',
        truncateLine(
          '    Warning: long sessions on 1M models can get expensive and lose mid-context detail.',
          pad,
        ),
      ),
    );
  } else {
    lines.push(
      currentTheme.fg(
        'textDim',
        truncateLine(
          '    Hard overflow block still follows the full model window.',
          pad,
        ),
      ),
    );
  }
  return lines;
}

function truncateLine(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return '…';
  return `${text.slice(0, width - 1)}…`;
}

export class ContextWorkingSetSelectorComponent extends ChoicePickerComponent {
  constructor(opts: ContextWorkingSetSelectorOptions) {
    super({
      title: ' Context working set',
      hint: ' ↑↓ navigate · Enter apply · Esc cancel',
      notice:
        opts.maxContextTokens !== undefined && opts.maxContextTokens > 0
          ? `Active model window ≈ ${formatTokenCount(opts.maxContextTokens)}. Caps only matter when the window is larger than the cap.`
          : 'Pick how early auto-compaction should reclaim context on large windows.',
      noticeTone: 'success',
      options: buildOptions(opts.maxContextTokens),
      currentValue: opts.currentPresetId,
      pageSize: 6,
      renderPreview: (option, width) =>
        renderPresetPreview(option, width, opts.maxContextTokens),
      onSelect: (value) => {
        if (isPresetId(value)) opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}

export {
  matchContextWorkingSetPreset,
  contextWorkingSetPresetById,
  type ContextWorkingSetPresetId,
};
