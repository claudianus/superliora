/**
 * Compatibility re-export — SSOT lives in `#/persona`.
 */
export {
  PERSONA_PRESET_CATALOG,
  PERSONA_PRESET_IDS,
  PERSONA_PRESETS,
  atomicPersonaConfigForPreset,
  buildPersonaRoleAdditional,
  getPersonaPreset,
  isEmptyPersona,
  isPersonaPresetId,
  normalizePersonaPresetId,
} from '../persona';
export type {
  PersonaPresetDefinition,
  PersonaPresetId,
  PersonaPresetInputId,
  PersonaSkillBundle,
} from '../persona';
