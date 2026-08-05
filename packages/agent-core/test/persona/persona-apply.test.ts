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
  it('returns undefined for empty persona', () => {
    expect(buildPersonaRoleAdditional(undefined)).toBeUndefined();
    expect(buildPersonaRoleAdditional({ preset: 'none' })).toBeUndefined();
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
