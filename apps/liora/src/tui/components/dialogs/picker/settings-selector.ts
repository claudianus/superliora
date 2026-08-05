import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';
import { SETTINGS_SEARCH_KEYWORDS } from '../../../commands/config/settings-keywords';

export type SettingsSelection =
  | 'model'
  | 'model-routing'
  | 'model-fallback'
  | 'model-reset'
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
  | 'provider-extras'
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
  | 'usage'
  | 'memory';

/** Practical group order — everyday settings first, power tools later. */
type SettingsSection =
  | 'Models'
  | 'Safety'
  | 'Look & feel'
  | 'Agent'
  | 'Integrations'
  | 'Account'
  | 'System';

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
  {
    value: 'model-reset',
    section: 'Models',
    label: 'Reset model settings',
    description: 'Restore model defaults, role routing, thinking, and fallback chains.',
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
    description: 'Preset tone packs + skill bundles · Advanced overrides.',
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
    value: 'never-halt',
    section: 'Agent',
    label: 'Never-Halt',
    description: 'Resilience: fallbacks, OAuth refresh, breakers.',
  },
  // ── Integrations (extensions + tools + research surfaces) ───────────────
  {
    value: 'extensions',
    section: 'Integrations',
    label: 'Extensions',
    description: 'Plugins, skills, MCP, Claude import.',
  },
  {
    value: 'mcp',
    section: 'Integrations',
    label: 'MCP servers',
    description: 'Connected MCP servers and health.',
  },
  {
    value: 'skills',
    section: 'Integrations',
    label: 'Skills',
    description: 'Skill catalog and SearchSkill.',
  },
  {
    value: 'hooks',
    section: 'Integrations',
    label: 'Hooks',
    description: 'Pre/Post/Stop lifecycle hooks.',
  },
  {
    value: 'tools',
    section: 'Integrations',
    label: 'Tools inventory',
    description: 'Active tool waist and profiles.',
  },
  {
    value: 'media',
    section: 'Integrations',
    label: 'Media',
    description: 'Image/video fallback when the chat model is text-only.',
  },
  {
    value: 'search',
    section: 'Integrations',
    label: 'Search',
    description: 'Deep research channels and free fallback.',
  },
  {
    value: 'provider-extras',
    section: 'Integrations',
    label: 'Provider extras',
    description: 'Auto-detected plan extras (search, image/video, MCP) — per-service off.',
  },
  {
    value: 'index',
    section: 'Integrations',
    label: 'Index',
    description: 'Repo index, codemap, FTS status.',
  },
  {
    value: 'cache',
    section: 'Integrations',
    label: 'Cache',
    description: 'Prompt-cache hit rate and sacred freeze.',
  },
  {
    value: 'eyes',
    section: 'Integrations',
    label: 'Eyes readiness',
    description: 'Browser-use / computer-use status.',
  },
  {
    value: 'memory',
    section: 'Integrations',
    label: 'Memory',
    description: 'Liora Memory — inspect, recall, remember, reflect.',
  },
  // ── Account ─────────────────────────────────────────────────────────────
  {
    value: 'providers-api',
    section: 'Account',
    label: 'Providers & API',
    description: 'Login, API keys, provider connect.',
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
  // ── System ──────────────────────────────────────────────────────────────
  {
    value: 'host',
    section: 'System',
    label: 'Host',
    description: 'Runtime transport and latency.',
  },
  {
    value: 'network',
    section: 'System',
    label: 'Network / Proxy',
    description: 'HTTPS_PROXY / NO_PROXY posture.',
  },
  {
    value: 'storage',
    section: 'System',
    label: 'Storage',
    description: 'Home layout, retention, logs.',
  },
  {
    value: 'telemetry',
    section: 'System',
    label: 'Telemetry',
    description: 'Analytics on/off · local-only.',
  },
  {
    value: 'experiments',
    section: 'System',
    label: 'Experiments',
    description: 'Feature flags (micro compaction, codegraph, …).',
  },
  {
    value: 'harness',
    section: 'System',
    label: 'Harness',
    description: 'Tools waist, eyes, Visual Quality, experiments hub.',
  },
  {
    value: 'bench-diagnostics',
    section: 'System',
    label: 'Bench / Diagnostics',
    description: '/bench, internal diagnostics.',
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

/** Settings always pinned in Command Hub (not search-only). Everyday + search path. */
export const HUB_PINNED_SETTINGS: readonly SettingsSelection[] = [
  'model',
  'permission',
  'theme',
  'appearance',
  'footer',
  'persona',
  'context',
  'extensions',
  'search',
  'media',
  'accounts',
  'usage',
  'upgrade',
  'security',
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
      // Grid packs 2–3 columns; higher page size fills the modal with cells.
      pageSize: 30,
      layout: 'grid',
      options: [...SETTINGS_OPTIONS],
      onSelect: (value) => {
        if (isSettingsSelection(value)) opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}
