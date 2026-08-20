/**
 * Generic named-preset helpers for Settings panes (context-working-set pattern).
 */

import { ttui } from '#/tui/utils/tui-i18n';

export interface SettingPreset<TId extends string, TPatch> {
  readonly id: TId;
  readonly label: string;
  readonly description: string;
  readonly badge?: string;
  readonly labelKey?: string;
  readonly descriptionKey?: string;
  readonly badgeKey?: string;
  readonly patch: TPatch;
}

export function findSettingPreset<TId extends string, TPatch>(
  catalog: readonly SettingPreset<TId, TPatch>[],
  id: string,
): SettingPreset<TId, TPatch> | undefined {
  return catalog.find((preset) => preset.id === id);
}

/** First catalog entry whose `match` returns true; else undefined. */
export function matchSettingPreset<TId extends string, TPatch, TState>(
  catalog: readonly SettingPreset<TId, TPatch>[],
  state: TState,
  match: (preset: SettingPreset<TId, TPatch>, state: TState) => boolean,
): SettingPreset<TId, TPatch> | undefined {
  for (const preset of catalog) {
    if (match(preset, state)) return preset;
  }
  return undefined;
}

export function settingPresetChoiceOptions<TId extends string, TPatch>(
  catalog: readonly SettingPreset<TId, TPatch>[],
): readonly {
  readonly value: TId;
  readonly label: string;
  readonly description: string;
}[] {
  return catalog.map((preset) => {
    const label = preset.labelKey !== undefined ? ttui(preset.labelKey) : preset.label;
    const description =
      preset.descriptionKey !== undefined ? ttui(preset.descriptionKey) : preset.description;
    const badge = preset.badgeKey !== undefined ? ttui(preset.badgeKey) : preset.badge;
    return {
      value: preset.id,
      label: badge !== undefined ? `${label} · ${badge}` : label,
      description,
    };
  });
}
