/**
 * Declarative slash command metadata — modes, settings, and harness controls.
 */

import type { LioraSlashCommand } from '../types';
import {
  toggleOnOffArgumentCompletions,
  permissionArgumentCompletions,
  contextArgumentCompletions,
  premiumArgumentCompletions,
  askArgumentCompletions,
  planArgumentCompletions,
  thinkingArgumentCompletions,
  helpArgumentCompletions,
  extensionsArgumentCompletions,
  cronArgumentCompletions,
  memoryArgumentCompletions,
  addDirArgumentCompletions,
  loopArgumentCompletions,
  goalArgumentCompletions,
  editorArgumentCompletions,
  themeArgumentCompletions,
  appearanceArgumentCompletions,
  personaArgumentCompletions,
  profileArgumentCompletions,
} from './completion-specs';
import { improveHarnessArgumentCompletions } from '../improve-harness';
import { pluginsArgumentCompletions } from '../plugins/plugins';
import { rendererArgumentCompletions } from '../renderer';
import { transcriptArgumentCompletions } from '../session/transcript';

export const BUILTIN_SLASH_COMMANDS_MODES = [

  {
    name: 'yolo',
    aliases: ['yes'],
    description: 'Toggle auto-approve mode (prefer Menu → Permission / Settings → Permission)',
    priority: 50,
    argumentHint: '[on|off]',
    completeArgs: toggleOnOffArgumentCompletions,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'auto',
    aliases: [],
    description: 'Toggle auto permission mode (prefer Menu → Permission / Settings → Permission)',
    priority: 50,
    argumentHint: '[on|off]',
    completeArgs: toggleOnOffArgumentCompletions,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'permission',
    aliases: [],
    description: 'Select permission mode',
    priority: 100,
    argumentHint: '[manual|auto|yolo]',
    completeArgs: permissionArgumentCompletions,
    availability: 'always',
  },
  {
    name: 'profile',
    aliases: [],
    description: 'Agent tool profile — Core waist (≤12): /profile core, /new · Mission/Fleet',
    priority: 95,
    argumentHint: '[status|core|agent|superliora-full]',
    completeArgs: profileArgumentCompletions,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'settings',
    aliases: ['config'],
    description: 'Open TUI settings (also: ? / Ctrl-K → menu)',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'context',
    aliases: ['working-set', 'workingset'],
    description: 'Set context working-set size (when auto-compaction fires on large windows)',
    priority: 90,
    argumentHint: '[economy|balanced|deep|full|status]',
    completeArgs: contextArgumentCompletions,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'premium',
    aliases: ['pq'],
    description: 'Toggle Visual Quality (motion/density; not task quality)',
    priority: 100,
    argumentHint: '[on|off|status]',
    completeArgs: premiumArgumentCompletions,
    availability: 'always',
  },
  {
    name: 'plan',
    aliases: [],
    description: 'Plan mode — model writes a plan file, you approve (interview → write)',
    priority: 80,
    argumentHint: '[on|off|clear]',
    completeArgs: planArgumentCompletions,
    availability: (args) => (args.trim().toLowerCase() === 'clear' ? 'idle-only' : 'always'),
  },
  {
    name: 'ask',
    aliases: [],
    description: 'Ask mode — investigate and answer without editing or delegating (Shift-Tab)',
    priority: 79,
    argumentHint: '[on|off]',
    completeArgs: askArgumentCompletions,
    availability: () => 'always',
  },
] as const satisfies readonly LioraSlashCommand[];
