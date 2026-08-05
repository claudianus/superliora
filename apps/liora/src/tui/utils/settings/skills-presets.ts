/**
 * Skills enable/disable packs (skills-state.json) — no global wipe of unrelated names.
 */

import type { SettingPreset } from './setting-presets';

export type SkillsPresetId = 'minimal' | 'coding' | 'writing' | 'research';

export interface SkillsPresetPatch {
  /** Skill names that should be enabled (removed from disabled). */
  readonly enable: readonly string[];
  /** Skill names that should be disabled for this pack. */
  readonly disable: readonly string[];
}

/** Builtin skill names that packs may toggle. */
const BUILTIN = {
  avoidAi: 'avoid-ai-writing',
  writeGoal: 'write-goal',
  recursive: 'recursive-improve',
  mission: 'mission',
  mcp: 'mcp-config',
  theme: 'custom-theme',
  update: 'update-config',
  importCc: 'import-from-cc-codex',
} as const;

export const SKILLS_PRESETS: readonly SettingPreset<SkillsPresetId, SkillsPresetPatch>[] = [
  {
    id: 'minimal',
    label: 'Minimal',
    badge: 'few slash skills',
    description: 'Disable noisy builtins; keep core config helpers.',
    patch: {
      enable: [BUILTIN.update, BUILTIN.mcp],
      disable: [
        BUILTIN.avoidAi,
        BUILTIN.writeGoal,
        BUILTIN.recursive,
        BUILTIN.mission,
        BUILTIN.theme,
        BUILTIN.importCc,
      ],
    },
  },
  {
    id: 'coding',
    label: 'Coding',
    badge: 'ship',
    description: 'Mission + recursive improve + avoid AI slop.',
    patch: {
      enable: [BUILTIN.mission, BUILTIN.recursive, BUILTIN.avoidAi, BUILTIN.writeGoal],
      disable: [],
    },
  },
  {
    id: 'writing',
    label: 'Writing',
    badge: 'prose',
    description: 'Avoid AI writing + goal framing.',
    patch: {
      enable: [BUILTIN.avoidAi, BUILTIN.writeGoal],
      disable: [BUILTIN.mission],
    },
  },
  {
    id: 'research',
    label: 'Research',
    badge: 'explore',
    description: 'Goals + recursive improve; leave MCP helpers on.',
    patch: {
      enable: [BUILTIN.writeGoal, BUILTIN.recursive, BUILTIN.mcp],
      disable: [],
    },
  },
];
