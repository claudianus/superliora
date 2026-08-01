import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';
import { SETTINGS_SEARCH_KEYWORDS } from '../../../commands/config/settings-keywords';

export type SettingsSelection =
  | 'model'
  | 'model-routing'
  | 'model-fallback'
  | 'theme'
  | 'appearance'
  | 'footer'
  | 'persona'
  | 'editor'
  | 'permission'
  | 'providers-api'
  | 'security'
  | 'accounts'
  | 'keybindings'
  | 'context'
  | 'compaction'
  | 'mission'
  | 'fleet'
  | 'ops'
  | 'media'
  | 'harness'
  | 'tools'
  | 'eyes'
  | 'premium'
  | 'mcp'
  | 'extensions'
  | 'hooks'
  | 'skills'
  | 'search'
  | 'index'
  | 'host'
  | 'cache'
  | 'never-halt'
  | 'telemetry'
  | 'bench-diagnostics'
  | 'network'
  | 'storage'
  | 'experiments'
  | 'upgrade'
  | 'usage';

/** Practical group order — everyday settings first, power tools later. */
type SettingsSection =
  | 'Models'
  | 'Safety'
  | 'Look & feel'
  | 'Agent'
  | 'Tools'
  | 'Account'
  | 'Advanced';

/** Exported for Settings → Harness → Settings inventory (SSOT §9 audit). */
const SETTINGS_OPTIONS_BASE: readonly (Omit<ChoiceOption, 'keywords'> & {
  readonly value: SettingsSelection;
  readonly section: SettingsSection;
})[] = [
  // ── Models ──────────────────────────────────────────────────────────────
  {
    value: 'model',
    section: 'Models',
    label: 'Model',
    description: 'Active model and thinking effort.',
  },
  {
    value: 'model-routing',
    section: 'Models',
    label: 'Model routing',
    description: 'Per-role model overrides for the agent loop.',
  },
  {
    value: 'model-fallback',
    section: 'Models',
    label: 'Model fallback',
    description: 'Automatic failover when a provider errors.',
  },
  // ── Safety ──────────────────────────────────────────────────────────────
  {
    value: 'permission',
    section: 'Safety',
    label: 'Permission',
    description: 'How tool actions are approved (manual · auto · YOLO).',
  },
  {
    value: 'security',
    section: 'Safety',
    label: 'Security',
    description: 'Sandbox, secret redaction, MCP allowlist.',
  },
  // ── Look & feel ─────────────────────────────────────────────────────────
  {
    value: 'theme',
    section: 'Look & feel',
    label: 'Theme',
    description: 'Color theme — dark, light, or custom.',
  },
  {
    value: 'appearance',
    section: 'Look & feel',
    label: 'Appearance',
    description: 'Motion, density, particles, background.',
  },
  {
    value: 'footer',
    section: 'Look & feel',
    label: 'Status bar',
    description: 'Footer badges, tips, pulses — full customization.',
  },
  {
    value: 'premium',
    section: 'Look & feel',
    label: 'Visual Quality',
    description: 'Premium motion and denser visual feedback.',
  },
  {
    value: 'persona',
    section: 'Look & feel',
    label: 'Persona',
    description: 'Agent tone and personality.',
  },
  {
    value: 'editor',
    section: 'Look & feel',
    label: 'Editor',
    description: 'External editor command (Ctrl-G).',
  },
  {
    value: 'keybindings',
    section: 'Look & feel',
    label: 'Keyboard',
    description: 'Shortcut reference and binding tips.',
  },
  // ── Agent ───────────────────────────────────────────────────────────────
  {
    value: 'context',
    section: 'Agent',
    label: 'Context',
    description: 'Working-set size and memory continuity.',
  },
  {
    value: 'compaction',
    section: 'Agent',
    label: 'Compaction',
    description: 'When and how context is compressed.',
  },
  {
    value: 'mission',
    section: 'Agent',
    label: 'Mission / Goals',
    description: 'Mission pipeline and goal auto-start.',
  },
  {
    value: 'fleet',
    section: 'Agent',
    label: 'Fleet / Parallel',
    description: 'Workers, budget, worktree isolation.',
  },
  {
    value: 'ops',
    section: 'Agent',
    label: 'Ops Theatre',
    description: 'Live ops panes — git, interventions, health.',
  },
  {
    value: 'never-halt',
    section: 'Agent',
    label: 'Never-Halt',
    description: 'Resilience: fallbacks, OAuth refresh, breakers.',
  },
  // ── Tools ───────────────────────────────────────────────────────────────
  {
    value: 'extensions',
    section: 'Tools',
    label: 'Extensions',
    description: 'Plugins, skills, MCP, Claude import.',
  },
  {
    value: 'mcp',
    section: 'Tools',
    label: 'MCP servers',
    description: 'Connected MCP servers and health.',
  },
  {
    value: 'skills',
    section: 'Tools',
    label: 'Skills',
    description: 'Skill catalog and SearchSkill tips.',
  },
  {
    value: 'hooks',
    section: 'Tools',
    label: 'Hooks',
    description: 'Pre/Post/Stop lifecycle hooks.',
  },
  {
    value: 'tools',
    section: 'Tools',
    label: 'Tools inventory',
    description: 'Active tool waist and profiles.',
  },
  {
    value: 'media',
    section: 'Tools',
    label: 'Media',
    description: 'Image/video fallback when the chat model is text-only.',
  },
  {
    value: 'search',
    section: 'Tools',
    label: 'Search',
    description: 'Deep research channels and free fallback.',
  },
  {
    value: 'index',
    section: 'Tools',
    label: 'Index',
    description: 'Repo index, codemap, FTS status.',
  },
  {
    value: 'cache',
    section: 'Tools',
    label: 'Cache',
    description: 'Prompt-cache hit rate and sacred tips.',
  },
  {
    value: 'eyes',
    section: 'Tools',
    label: 'Eyes readiness',
    description: 'Browser-use / computer-use status.',
  },
  // ── Account ─────────────────────────────────────────────────────────────
  {
    value: 'providers-api',
    section: 'Account',
    label: 'Providers & API',
    description: 'Login, API keys, provider connect tips.',
  },
  {
    value: 'accounts',
    section: 'Account',
    label: 'Accounts',
    description: 'OAuth pools — promote, label, remove.',
  },
  {
    value: 'usage',
    section: 'Account',
    label: 'Usage',
    description: 'Tokens, cost, quota, context window.',
  },
  {
    value: 'upgrade',
    section: 'Account',
    label: 'Updates',
    description: 'Automatic CLI updates on or off.',
  },
  // ── Advanced ────────────────────────────────────────────────────────────
  {
    value: 'host',
    section: 'Advanced',
    label: 'Host',
    description: 'Runtime transport and latency tips.',
  },
  {
    value: 'network',
    section: 'Advanced',
    label: 'Network / Proxy',
    description: 'HTTPS_PROXY / NO_PROXY posture.',
  },
  {
    value: 'storage',
    section: 'Advanced',
    label: 'Storage',
    description: 'Home layout, retention, logs.',
  },
  {
    value: 'telemetry',
    section: 'Advanced',
    label: 'Telemetry',
    description: 'Analytics on/off · local-only tips.',
  },
  {
    value: 'experiments',
    section: 'Advanced',
    label: 'Experiments',
    description: 'Feature flags (micro compaction, codegraph, …).',
  },
  {
    value: 'harness',
    section: 'Advanced',
    label: 'Harness',
    description: 'Tools waist, eyes, Visual Quality, experiments hub.',
  },
  {
    value: 'bench-diagnostics',
    section: 'Advanced',
    label: 'Bench / Diagnostics',
    description: '/bench, /ops, internal diagnostics tips.',
  },
];

function withSettingsKeywords(
  option: Omit<ChoiceOption, 'keywords'> & { readonly value: SettingsSelection },
): ChoiceOption {
  const keywords = SETTINGS_SEARCH_KEYWORDS[option.value];
  return {
    ...option,
    keywords: keywords !== undefined ? [...keywords] : [],
  };
}

export const SETTINGS_OPTIONS: readonly ChoiceOption[] =
  SETTINGS_OPTIONS_BASE.map(withSettingsKeywords);

const SETTINGS_SELECTION_SET = new Set<string>(
  SETTINGS_OPTIONS_BASE.map((option) => option.value),
);

export function isSettingsSelection(value: string): value is SettingsSelection {
  return SETTINGS_SELECTION_SET.has(value);
}

/** Settings always pinned in Command Hub (not search-only). */
export const HUB_PINNED_SETTINGS: readonly SettingsSelection[] = [
  'model',
  'permission',
  'theme',
  'appearance',
  'footer',
  'context',
  'extensions',
  'media',
  'accounts',
  'usage',
  'upgrade',
];

export interface SettingsSelectorOptions {
  readonly onSelect: (value: SettingsSelection) => void;
  readonly onCancel: () => void;
}

export class SettingsSelectorComponent extends ChoicePickerComponent {
  constructor(opts: SettingsSelectorOptions) {
    super({
      title: 'Settings',
      searchable: true,
      pageSize: 14,
      options: [...SETTINGS_OPTIONS],
      onSelect: (value) => {
        if (isSettingsSelection(value)) opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}
