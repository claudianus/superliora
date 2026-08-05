import { describe, expect, it } from 'vitest';

import {
  PERSONA_PRESET_CATALOG,
  atomicPersonaConfigForPreset,
  buildPersonaRoleAdditional,
  isEmptyPersona,
  normalizePersonaPresetId,
} from '../../src/persona';

describe('normalizePersonaPresetId', () => {
  it('maps legacy concise to efficient', () => {
    expect(normalizePersonaPresetId('concise')).toBe('efficient');
  });

  it('leaves canonical ids unchanged', () => {
    expect(normalizePersonaPresetId('mentor')).toBe('mentor');
    expect(normalizePersonaPresetId('none')).toBe('none');
    expect(normalizePersonaPresetId('caveman')).toBe('caveman');
    expect(normalizePersonaPresetId('adhd')).toBe('adhd');
  });
});

describe('atomicPersonaConfigForPreset', () => {
  it('clears custom overrides and normalizes concise', () => {
    expect(atomicPersonaConfigForPreset('concise')).toEqual({
      preset: 'efficient',
      personality: '',
      tone: '',
      instructions: '',
    });
  });
});

describe('buildPersonaRoleAdditional', () => {
  it('compiles the default liora preset when persona is unset', () => {
    const liora = PERSONA_PRESET_CATALOG.find((p) => p.id === 'liora')!;
    const text = buildPersonaRoleAdditional(undefined);
    expect(text).toContain('# Persona: Liora');
    expect(text).toContain(liora.personality);
    expect(text).toContain(liora.tone);
  });

  it('returns undefined only for explicit none without overrides', () => {
    expect(buildPersonaRoleAdditional({ preset: 'none' })).toBeUndefined();
  });

  it('layers custom fields on the default base when no preset is chosen', () => {
    const liora = PERSONA_PRESET_CATALOG.find((p) => p.id === 'liora')!;
    const text = buildPersonaRoleAdditional({ name: 'Scout', tone: 'deadpan' });
    expect(text).toContain('# Persona: Scout');
    expect(text).toContain('Tone: deadpan');
    expect(text?.match(/Tone:/g)?.length).toBe(1);
    expect(text).toContain(liora.personality);
  });

  it('compiles a preset without duplicate Personality/Tone lines', () => {
    const text = buildPersonaRoleAdditional({ preset: 'efficient', name: 'Scout' });
    expect(text).toContain('# Persona: Scout');
    expect(text).toContain('Personality:');
    expect(text).toContain('Tone:');
    expect(text?.match(/Personality:/g)?.length).toBe(1);
    expect(text?.match(/Tone:/g)?.length).toBe(1);
  });

  it('normalizes concise when compiling', () => {
    const text = buildPersonaRoleAdditional({ preset: 'concise' });
    expect(text).toContain(PERSONA_PRESET_CATALOG.find((p) => p.id === 'efficient')!.personality);
  });

  it('lets custom tone replace the preset tone line', () => {
    const text = buildPersonaRoleAdditional({
      preset: 'friendly',
      tone: 'deadpan',
    });
    expect(text).toContain('Tone: deadpan');
    expect(text?.match(/Tone:/g)?.length).toBe(1);
  });

  it('compiles caveman and adhd presets with skill-backed bundles', () => {
    const caveman = buildPersonaRoleAdditional({ preset: 'caveman' });
    expect(caveman).toContain(PERSONA_PRESET_CATALOG.find((p) => p.id === 'caveman')!.personality);
    expect(caveman).toContain('~65% fewer tokens');

    const adhd = buildPersonaRoleAdditional({ preset: 'adhd' });
    expect(adhd).toContain(PERSONA_PRESET_CATALOG.find((p) => p.id === 'adhd')!.personality);
    expect(adhd).toContain('concrete next action');
  });
});

describe('isEmptyPersona', () => {
  it('treats cleared fields as empty', () => {
    expect(
      isEmptyPersona({
        name: '',
        preset: 'none',
        personality: '',
        tone: '',
        instructions: '',
      }),
    ).toBe(true);
  });
});
