/**
 * Search-only aliases for One-search Settings (SSOT §9.4).
 * Matched by Settings picker and Command Hub One-search.
 */
export const SETTINGS_SEARCH_KEYWORDS = {
  model: ['llm', 'thinking', 'provider'],
  'model-routing': ['loop', 'routing', 'role'],
  'model-fallback': ['failover', 'fallback', 'chain'],
  permission: ['yolo', 'auto', 'manual', 'approve', 'approval'],
  'providers-api': ['api', 'apikey', 'baseurl', 'connect', 'login'],
  security: ['redaction', 'redact', 'sandbox', 'allowlist', 'secrets', 'egress'],
  accounts: ['oauth', 'pool', 'account'],
  keybindings: ['keyboard', 'shortcuts', 'keymap', 'keys'],
  context: ['working-set', 'workingset', 'memory', 'instruction', 'learning'],
  compaction: ['compact', 'threshold', 'keep-tokens', 'template'],
  mission: ['goals', 'ultrawork', 'evidence', 'artifact', 'objective', 'autostart', 'auto-start'],
  fleet: ['parallel', 'workers', 'swarm', 'budget', 'worktree'],
  ops: ['ops-theatre', 'theatre', 'git-diff', 'intervention', 'tray', 'dopamine'],
  media: ['text-only', 'vision', 'image', 'fallback'],
  harness: ['hands', 'control-plane'],
  tools: ['inventory', 'profile', 'core', 'waist', 'toolset'],
  eyes: ['browser', 'computer-use', 'browser-use', 'gui-use'],
  premium: ['visual-quality', 'pq', 'motion', 'density', 'anti-slop'],
  mcp: ['mcp', 'servers', 'stdio'],
  extensions: ['plugins', 'skills', 'claude'],
  hooks: ['pre', 'post', 'stop', 'lifecycle'],
  skills: ['catalog', 'searchskill', 'risk'],
  search: [
    'ddg',
    'duckduckgo',
    'brave',
    'tavily',
    'exa',
    'deep-research',
    'fallback',
    'channels',
    'strategy',
    'parallel',
    'browser',
    'ch4',
    'ch5',
    'preferxai',
    'xai',
    'grok',
    'searxng',
    'ch2',
  ],
  index: ['fts', 'fts5', 'codemap', 'repoquery', 'zoekt', 'rebuild', 'symbol'],
  host: ['in-process', 'server', 'transport', 'acp', 'remote'],
  cache: ['freeze', 'sacred', 'hit-rate', 'prompt-cache', 'streak', 'invalidate', 'cold'],
  'never-halt': ['resilience', 'circuit-breaker', 'oauth-refresh', 'degraded'],
  telemetry: ['analytics', 'local-only', 'tracking'],
  'bench-diagnostics': ['bench', 'ops', 'diagnostics', 'trace', 'branding'],
  network: ['proxy', 'https_proxy', 'no_proxy'],
  storage: ['home', 'retention', 'logs', 'superliora-home'],
  theme: ['dark', 'light', 'palette', 'skin'],
  appearance: ['motion', 'density', 'background', 'ambient'],
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
  persona: ['personality', 'tone', 'character'],
  editor: ['vim', 'external-editor', 'nano'],
  experiments: ['flags', 'feature-flags', 'codegraph', 'micro-compaction'],
  upgrade: ['updates', 'auto-update', 'version'],
  usage: ['tokens', 'quota', 'context-window', 'plan'],
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
