import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';
import { SETTINGS_SEARCH_KEYWORDS } from '../../../commands/config/settings-keywords';

export type SettingsSelection =
  | 'model'
  | 'model-routing'
  | 'model-fallback'
  | 'theme'
  | 'appearance'
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

/** Exported for Settings → Harness → Settings inventory (SSOT §9 audit). */
const SETTINGS_OPTIONS_BASE: readonly Omit<ChoiceOption, 'keywords'>[] = [
  {
    value: 'model',
    label: 'Model',
    description: 'Switch the active model and thinking mode.',
  },
  {
    value: 'model-routing',
    label: 'Model routing',
    description: 'Set future loop-role model overrides without changing this session.',
  },
  {
    value: 'model-fallback',
    label: 'Model fallback',
    description: 'Configure fallback models for automatic failover on errors.',
  },
  {
    value: 'permission',
    label: 'Permission',
    description: 'Choose how tool actions are approved.',
  },
  {
    value: 'providers-api',
    label: 'Providers & API',
    description: '/login, Accounts, API key env names — read-only tips (no key storage).',
  },
  {
    value: 'security',
    label: 'Security',
    description: 'Sandbox, secret redaction, MCP allowlist — read-only glance + tips.',
  },
  {
    value: 'accounts',
    label: 'Accounts',
    description: 'Manage OAuth account pools — proactive refresh, promote, label, remove.',
  },
  {
    value: 'keybindings',
    label: 'Keyboard / Keybindings',
    description: 'Read-only tips — keymap.ts SSOT, /help shortcut reference.',
  },
  {
    value: 'context',
    label: 'Context',
    description: 'Working-set glance + Instruction vs Learning memory tips; /context to change preset.',
  },
  {
    value: 'compaction',
    label: 'Compaction',
    description: 'Threshold/template tips — /compact, loopControl keys, keep-tokens.',
  },
  {
    value: 'mission',
    label: 'Mission / Goals',
    description: 'Auto-start opt-in, /mission, evidence checks, artifact paths.',
  },
  {
    value: 'fleet',
    label: 'Fleet / Parallel',
    description: 'Max workers, /fleet, budget tip, worktree isolation.',
  },
  {
    value: 'ops',
    label: 'Ops Theatre',
    description: '/ops 4-pane theatre — git diff, intervention tray, Visual Quality link.',
  },
  {
    value: 'media',
    label: 'Media fallback',
    description: 'Live policy when the chat model is text-only; picker via panel tips.',
  },
  {
    value: 'harness',
    label: 'Harness',
    description: 'Eyes/hands surface: tools, eyes readiness, Premium, MCP, experiments.',
  },
  {
    value: 'tools',
    label: 'Tools',
    description: 'Active tools inventory · Core≤12 product waist; TaskGraph via agent/full · /profile core',
  },
  {
    value: 'eyes',
    label: 'Eyes readiness',
    description: 'Live browser-use / computer-use runtime status.',
  },
  {
    value: 'premium',
    label: 'Visual Quality',
    description: 'Toggle Visual Quality mode (motion, density, anti-slop).',
  },
  {
    value: 'mcp',
    label: 'MCP servers',
    description: 'Live server count + manage (install, toggle, remove, reload).',
  },
  {
    value: 'extensions',
    label: 'Extensions',
    description: 'Live installed counts + manage hub (plugins, skills, MCP).',
  },
  {
    value: 'hooks',
    label: 'Hooks',
    description: 'Pre/Post/Stop tips — user hooks via config.toml + plugin hooks.',
  },
  {
    value: 'skills',
    label: 'Skills',
    description: 'Catalog sources, SearchSkill workflow, risk filter tips.',
  },
  {
    value: 'search',
    label: 'Search',
    description: 'Deep research channels, API keys, free fallback status.',
  },
  {
    value: 'index',
    label: 'Index',
    description: 'Read-only RepoQuery, symbol codemap sqlite, and FTS status.',
  },
  {
    value: 'host',
    label: 'Host',
    description: 'Runtime status · live TTFT · sovereign umbrella and latency tips (W8).',
  },
  {
    value: 'cache',
    label: 'Cache',
    description: 'Prompt-cache hit rate, tool-block stability, Cache Sacred tips.',
  },
  {
    value: 'never-halt',
    label: 'Never-Halt',
    description: 'Resilience: search fallback, OAuth refresh, permission queue, circuit breaker.',
  },
  {
    value: 'telemetry',
    label: 'Telemetry',
    description: 'Read-only on/off posture · local-only · config.toml tips.',
  },
  {
    value: 'bench-diagnostics',
    label: 'Bench / Diagnostics',
    description: '/bench, /ops, internal bench, branding debt tips.',
  },
  {
    value: 'network',
    label: 'Network / Proxy',
    description: 'HTTPS_PROXY / NO_PROXY posture when env vars are set.',
  },
  {
    value: 'storage',
    label: 'Storage',
    description: '~/.superliora home layout · session retention · log level tips.',
  },
  {
    value: 'theme',
    label: 'Theme',
    description: 'Live palette + catalog glance; picker via /theme or panel tips.',
  },
  {
    value: 'appearance',
    label: 'Appearance',
    description: 'Tune motion, density, and background.',
  },
  {
    value: 'persona',
    label: 'Persona',
    description: 'Customize agent personality, tone, and response style.',
  },
  {
    value: 'editor',
    label: 'Editor',
    description: 'Set the external editor command.',
  },
  {
    value: 'experiments',
    label: 'Experiments',
    description: 'Turn experimental features on or off.',
  },
  {
    value: 'upgrade',
    label: 'Automatic updates',
    description: 'Turn automatic CLI updates on or off.',
  },
  {
    value: 'usage',
    label: 'Usage',
    description: 'Live token/$ status · context window · quota and report tips.',
  },
];

function withSettingsKeywords(
  option: Omit<ChoiceOption, 'keywords'>,
): ChoiceOption {
  const selection = option.value as SettingsSelection;
  const keywords = SETTINGS_SEARCH_KEYWORDS[selection as keyof typeof SETTINGS_SEARCH_KEYWORDS];
  return {
    ...option,
    keywords: keywords !== undefined ? [...keywords] : [],
  };
}

export const SETTINGS_OPTIONS: readonly ChoiceOption[] = SETTINGS_OPTIONS_BASE.map(withSettingsKeywords);

function isSettingsSelection(value: string): value is SettingsSelection {
  return (
    value === 'model' ||
    value === 'model-routing' ||
    value === 'model-fallback' ||
    value === 'theme' ||
    value === 'appearance' ||
    value === 'persona' ||
    value === 'editor' ||
    value === 'permission' ||
    value === 'providers-api' ||
    value === 'security' ||
    value === 'accounts' ||
    value === 'keybindings' ||
    value === 'context' ||
    value === 'compaction' ||
    value === 'mission' ||
    value === 'fleet' ||
    value === 'ops' ||
    value === 'media' ||
    value === 'harness' ||
    value === 'tools' ||
    value === 'eyes' ||
    value === 'premium' ||
    value === 'mcp' ||
    value === 'extensions' ||
    value === 'hooks' ||
    value === 'skills' ||
    value === 'search' ||
    value === 'index' ||
    value === 'host' ||
    value === 'cache' ||
    value === 'never-halt' ||
    value === 'telemetry' ||
    value === 'bench-diagnostics' ||
    value === 'network' ||
    value === 'storage' ||
    value === 'experiments' ||
    value === 'upgrade' ||
    value === 'usage'
  );
}

export interface SettingsSelectorOptions {
  readonly onSelect: (value: SettingsSelection) => void;
  readonly onCancel: () => void;
}

export class SettingsSelectorComponent extends ChoicePickerComponent {
  constructor(opts: SettingsSelectorOptions) {
    super({
      title: 'Settings',
      searchable: true,
      options: [...SETTINGS_OPTIONS],
      onSelect: (value) => {
        if (isSettingsSelection(value)) opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}
