/**
 * Search-only aliases for One-search Settings (SSOT §9.4).
 * Matched by Settings picker and Command Hub One-search.
 */
export const SETTINGS_SEARCH_KEYWORDS = {
  model: ['llm', 'thinking', 'provider'],
  'model-fallback': ['failover', 'fallback', 'chain'],
  'model-reset': ['reset', 'default', 'restore', 'auto', 'factory'],
  permission: ['yolo', 'auto', 'manual', 'approve', 'approval'],
  'providers-api': ['api', 'apikey', 'baseurl', 'connect', 'login'],
  security: [
    'redaction',
    'redact',
    'sandbox',
    'path sandbox',
    'workspace guard',
    '경로',
    '워크스페이스 가드',
    'allowlist',
    'secrets',
    'egress',
    'read-only',
    'off',
    'enforcement',
    'process sandbox',
    'docker',
    'job object',
  ],
  accounts: ['oauth', 'pool', 'account'],
  keybindings: ['keyboard', 'shortcuts', 'keymap', 'keys'],
  host: ['in-process', 'server', 'transport', 'acp', 'remote', 'add-dir', 'workspace'],
  cache: ['freeze', 'sacred', 'hit-rate', 'prompt-cache', 'streak', 'invalidate', 'cold'],
  telemetry: ['analytics', 'local-only', 'tracking'],
  network: ['proxy', 'https_proxy', 'no_proxy'],
  storage: ['home', 'retention', 'logs', 'superliora-home', 'disk', 'gc', 'drive', 'move', '100gb'],
  theme: ['dark', 'light', 'palette', 'skin'],
  appearance: [
    'motion',
    'density',
    'background',
    'ambient',
    'mission-control',
    'jobs',
    'dock',
    'band',
    'performance',
    'perf',
    'low-spec',
  ],
  footer: [
    'status-bar',
    'statusbar',
    'footer',
    'badges',
    'tips',
    'context-bar',
    'pulses',
    'labels',
  ],
  editor: ['vim', 'external-editor', 'nano'],
  locale: ['locale', 'language', 'i18n', 'korean', 'english', '한국어', '언어'],
  upgrade: ['updates', 'auto-update', 'version'],
  usage: ['tokens', 'quota', 'context-window'],
  limits: ['steps', 'hard-limit', 'execution', 'maxsteps'],
} as const satisfies Record<string, readonly string[]>;

export type SettingsKeywordSelection = keyof typeof SETTINGS_SEARCH_KEYWORDS;

/** Flatten keywords for fuzzy matching in list pickers. */
export function settingsOptionSearchText(
  label: string,
  description: string | undefined,
  selection: SettingsKeywordSelection,
): string {
  const keywords = SETTINGS_SEARCH_KEYWORDS[selection];
  return `${label} ${description ?? ''} ${keywords.join(' ')}`;
}

export function isSettingsHubActionId(id: string): id is `settings.${SettingsKeywordSelection}` {
  if (!id.startsWith('settings.')) return false;
  const selection = id.slice('settings.'.length);
  return selection in SETTINGS_SEARCH_KEYWORDS;
}

export function settingsSelectionFromHubId(
  id: `settings.${SettingsKeywordSelection}`,
): SettingsKeywordSelection {
  return id.slice('settings.'.length) as SettingsKeywordSelection;
}
