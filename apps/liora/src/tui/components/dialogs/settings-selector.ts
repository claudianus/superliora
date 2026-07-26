import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

export type SettingsSelection =
  | 'model'
  | 'theme'
  | 'appearance'
  | 'persona'
  | 'editor'
  | 'permission'
  | 'accounts'
  | 'context'
  | 'harness'
  | 'tools'
  | 'eyes'
  | 'premium'
  | 'mcp'
  | 'experiments'
  | 'upgrade'
  | 'usage';

const SETTINGS_OPTIONS: readonly ChoiceOption[] = [
  {
    value: 'model',
    label: 'Model',
    description: 'Switch the active model and thinking mode.',
  },
  {
    value: 'permission',
    label: 'Permission',
    description: 'Choose how tool actions are approved.',
  },
  {
    value: 'accounts',
    label: 'Accounts',
    description: 'Manage OAuth account pools (promote, label, remove).',
  },
  {
    value: 'context',
    label: 'Context',
    description: 'Set when auto-compaction reclaims context on large windows.',
  },
  {
    value: 'harness',
    label: 'Harness',
    description: 'Eyes/hands surface: tools, eyes readiness, Premium, MCP, experiments.',
  },
  {
    value: 'tools',
    label: 'Tools',
    description: 'List active agent tools (SearchTools inventory).',
  },
  {
    value: 'eyes',
    label: 'Eyes readiness',
    description: 'Browser-use / computer-use runtime status.',
  },
  {
    value: 'premium',
    label: 'Premium Quality',
    description: 'Toggle visual-first premium harness mode.',
  },
  {
    value: 'mcp',
    label: 'MCP servers',
    description: 'Show Model Context Protocol server status.',
  },
  {
    value: 'theme',
    label: 'Theme',
    description: 'Change the terminal UI theme.',
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
    description: 'Show session tokens, context window, and plan quotas.',
  },
];

function isSettingsSelection(value: string): value is SettingsSelection {
  return (
    value === 'model' ||
    value === 'theme' ||
    value === 'appearance' ||
    value === 'persona' ||
    value === 'editor' ||
    value === 'permission' ||
    value === 'accounts' ||
    value === 'context' ||
    value === 'harness' ||
    value === 'tools' ||
    value === 'eyes' ||
    value === 'premium' ||
    value === 'mcp' ||
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
      options: [...SETTINGS_OPTIONS],
      onSelect: (value) => {
        if (isSettingsSelection(value)) opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}
