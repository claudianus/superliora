/**
 * User persona preset catalog types (main-agent ROLE_ADDITIONAL).
 * Skill bundle names are catalog hints only — not stored in config.toml.
 */

/** Canonical preset ids (after legacy normalize). */
export type PersonaPresetId =
  | 'none'
  | 'liora'
  | 'efficient'
  | 'professional'
  | 'friendly'
  | 'candid'
  | 'mentor'
  | 'reviewer'
  | 'pair'
  | 'creative'
  | 'nerdy'
  | 'playful'
  | 'skeptical'
  | 'caveman'
  | 'adhd';

/** Legacy ids accepted when reading config; normalized before apply/compile. */
export type PersonaPresetLegacyId = 'concise';

export type PersonaPresetInputId = PersonaPresetId | PersonaPresetLegacyId;

export interface PersonaSkillBundle {
  /** Remove these names from skills-state.json `disabled`. */
  readonly enableSkills?: readonly string[];
  /** Add these names to skills-state.json `disabled`. */
  readonly disableSkills?: readonly string[];
}

export interface PersonaPresetDefinition {
  readonly id: PersonaPresetId;
  readonly label: string;
  /** One-line UI description. */
  readonly description: string;
  readonly personality: string;
  readonly tone: string;
  /** Optional extra prompt lines for this preset. */
  readonly instructions?: string;
  /** Applied by the TUI client when the preset is selected; not persisted on [persona]. */
  readonly skillBundle?: PersonaSkillBundle;
}
