import { describe, expect, it } from 'vitest';

import { APPEARANCE_PRESETS } from '#/tui/utils/settings/appearance-presets';
import { FOOTER_PRESETS } from '#/tui/utils/settings/footer-presets';
import {
  findSettingPreset,
  settingPresetChoiceOptions,
} from '#/tui/utils/settings/setting-presets';

describe('setting presets catalogs', () => {
  it('builds footer picker choices with their badge and description', () => {
    const options = settingPresetChoiceOptions(FOOTER_PRESETS);
    expect(options).toEqual(FOOTER_PRESETS.map((preset) => ({
      value: preset.id,
      label: `${preset.label} · ${preset.badge}`,
      description: preset.description,
    })));
    expect(findSettingPreset(FOOTER_PRESETS, 'dense')?.patch.labels).toBe('compact');
    expect(findSettingPreset(FOOTER_PRESETS, 'unknown')).toBeUndefined();
  });

  it('builds choice options and finds by id', () => {
    const options = settingPresetChoiceOptions(APPEARANCE_PRESETS);
    expect(options[0]?.value).toBe('off');
    expect(findSettingPreset(APPEARANCE_PRESETS, 'premium')?.label).toBe('Premium');
  });
});
