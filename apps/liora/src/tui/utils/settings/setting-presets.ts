/**
 * Generic named-preset helpers for Settings panes (context-working-set pattern).
 */

export interface SettingPreset<TId extends string, TPatch> {
  readonly id: TId;
  readonly label: string;
  readonly description: string;
  readonly badge?: string;
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
  return catalog.map((preset) => ({
    value: preset.id,
    label: preset.badge !== undefined ? `${preset.label} · ${preset.badge}` : preset.label,
    description: preset.description,
  }));
}
