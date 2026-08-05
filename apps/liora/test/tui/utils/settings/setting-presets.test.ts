import { describe, expect, it } from 'vitest';

import { APPEARANCE_PRESETS } from '#/tui/utils/settings/appearance-presets';
import { COMPACTION_PRESETS } from '#/tui/utils/settings/compaction-presets';
import { FOOTER_PRESETS } from '#/tui/utils/settings/footer-presets';
import { SKILLS_PRESETS } from '#/tui/utils/settings/skills-presets';
import {
  findSettingPreset,
  settingPresetChoiceOptions,
} from '#/tui/utils/settings/setting-presets';

describe('setting presets catalogs', () => {
  it('exposes appearance / footer / skills / compaction packs', () => {
    expect(APPEARANCE_PRESETS.map((p) => p.id)).toEqual(['off', 'calm', 'subtle', 'premium']);
    expect(FOOTER_PRESETS.map((p) => p.id)).toEqual(['minimal', 'standard', 'dense']);
    expect(SKILLS_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(COMPACTION_PRESETS.map((p) => p.id)).toEqual(['aggressive', 'balanced', 'patient']);
  });

  it('builds choice options and finds by id', () => {
    const options = settingPresetChoiceOptions(APPEARANCE_PRESETS);
    expect(options[0]?.value).toBe('off');
    expect(findSettingPreset(APPEARANCE_PRESETS, 'premium')?.label).toBe('Premium');
  });
});
