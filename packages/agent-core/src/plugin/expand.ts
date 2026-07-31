/**
 * Expand Claude Code plugin path placeholders in config strings.
 *
 * Supported: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`,
 * and `${user_config.KEY}` when `userConfig` values are supplied.
 */
export function expandPluginPlaceholders(
  value: string,
  vars: {
    readonly pluginRoot: string;
    readonly pluginData: string;
    readonly projectDir: string;
    readonly userConfig?: Readonly<Record<string, string>>;
  },
): string {
  let out = value
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', vars.pluginRoot)
    .replaceAll('${CLAUDE_PLUGIN_DATA}', vars.pluginData)
    .replaceAll('${CLAUDE_PROJECT_DIR}', vars.projectDir);

  if (vars.userConfig !== undefined) {
    out = out.replaceAll(/\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key: string) => {
      const resolved = vars.userConfig?.[key];
      return resolved ?? match;
    });
  }
  return out;
}

export function expandRecordValues(
  record: Readonly<Record<string, string>> | undefined,
  vars: {
    readonly pluginRoot: string;
    readonly pluginData: string;
    readonly projectDir: string;
    readonly userConfig?: Readonly<Record<string, string>>;
  },
): Record<string, string> | undefined {
  if (record === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = expandPluginPlaceholders(value, vars);
  }
  return out;
}
