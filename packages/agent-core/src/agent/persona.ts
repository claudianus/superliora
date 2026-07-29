/**
 * Persona configuration → ROLE_ADDITIONAL system prompt section.
 * Extracted from Agent class.
 */
import type { PersonaConfig } from '../config';

export const PERSONA_PRESETS: Record<string, { personality: string; tone: string }> = {
  friendly: {
    personality: 'Warm, approachable, and encouraging. Uses gentle humor and celebrates progress.',
    tone: 'Casual and supportive, like a helpful friend who happens to be an expert.',
  },
  professional: {
    personality: 'Precise, thorough, and dependable. Prioritizes clarity and correctness.',
    tone: 'Formal but not stiff; direct and business-like with structured responses.',
  },
  concise: {
    personality: 'Efficient and to-the-point. Values the user\'s time above all.',
    tone: 'Terse and minimal; answers in the fewest words that preserve accuracy.',
  },
  creative: {
    personality: 'Imaginative and curious. Suggests unconventional angles and novel approaches.',
    tone: 'Expressive and vivid; uses analogies, metaphors, and occasional wit.',
  },
  mentor: {
    personality: 'Patient and Socratic. Guides understanding rather than giving answers outright.',
    tone: 'Encouraging and educational; explains the "why" behind recommendations.',
  },
  playful: {
    personality: 'Witty and energetic. Makes interactions fun while staying helpful.',
    tone: 'Light-hearted with puns and playful remarks; never at the expense of correctness.',
  },
};

export function buildPersonaRoleAdditional(persona: PersonaConfig | undefined): string | undefined {
  if (persona === undefined) return undefined;

  const parts: string[] = [];

  // Resolve preset first as a base layer.
  if (persona.preset !== undefined && persona.preset !== 'none') {
    const preset = PERSONA_PRESETS[persona.preset];
    if (preset !== undefined) {
      parts.push(`Personality: ${preset.personality}`);
      parts.push(`Tone: ${preset.tone}`);
    }
  }

  // User overrides layer on top of the preset.
  if (persona.personality !== undefined && persona.personality.trim().length > 0) {
    parts.push(`Personality: ${persona.personality.trim()}`);
  }
  if (persona.tone !== undefined && persona.tone.trim().length > 0) {
    parts.push(`Tone: ${persona.tone.trim()}`);
  }
  if (persona.instructions !== undefined && persona.instructions.trim().length > 0) {
    parts.push(persona.instructions.trim());
  }

  if (parts.length === 0) return undefined;

  const header = persona.name !== undefined && persona.name.trim().length > 0
    ? `# Persona: ${persona.name.trim()}`
    : '# Persona';

  return `${header}\n\n${parts.join('\n')}`;
}
