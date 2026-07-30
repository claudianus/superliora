/**
 * Map Claude plugin MCP naming ↔ SuperLiora session names.
 *
 * Claude matchers / mcp_tool hooks often use:
 * - server: `plugin::<server>` or bare `<server>`
 * - tool matcher: `mcp__plugin_<pluginId>_<server>__<tool>`
 *
 * SuperLiora session MCP keys are `plugin:<id>:<server>`.
 */

export function superlioraPluginMcpName(pluginId: string, server: string): string {
  return `plugin:${pluginId}:${server}`;
}

/** Resolve a Claude-shaped server ref to a SuperLiora MCP server name. */
export function resolveMcpServerRef(
  server: string,
  pluginId?: string,
): readonly string[] {
  const trimmed = server.trim();
  if (trimmed.length === 0) return [];
  const aliases = new Set<string>([trimmed]);

  if (trimmed.startsWith('plugin::') && pluginId !== undefined) {
    aliases.add(superlioraPluginMcpName(pluginId, trimmed.slice('plugin::'.length)));
  }
  if (trimmed.startsWith('plugin:') && trimmed.includes(':', 7)) {
    // already SuperLiora form
  } else if (pluginId !== undefined && !trimmed.includes(':')) {
    aliases.add(superlioraPluginMcpName(pluginId, trimmed));
  }

  // Claude scoped: plugin_<id>_<server> → plugin:<id>:<server>
  const claudeScoped = /^plugin_([a-z0-9][a-z0-9_-]*)_(.+)$/i.exec(trimmed);
  if (claudeScoped !== null) {
    aliases.add(superlioraPluginMcpName(claudeScoped[1]!, claudeScoped[2]!));
  }

  return [...aliases];
}

/**
 * Expand a tool matcher so Claude `mcp__plugin_…` patterns also match
 * SuperLiora `mcp__plugin_…` qualified names built from `plugin:<id>:<server>`.
 */
export function expandMcpToolMatcher(matcher: string | undefined): string | undefined {
  if (matcher === undefined || matcher.trim() === '') return matcher;
  // Pass through; matching uses regex already. Provide alias rewrite for
  // Claude's `mcp__plugin_<id>_<server>__` → our sanitized `mcp__plugin_<id>_<server>__`
  // (colons become `_` in sanitize), which is already compatible.
  return matcher;
}

/** Prefer calling the first connected alias. */
export function pickMcpServerAlias(
  aliases: readonly string[],
  available: ReadonlySet<string>,
): string | undefined {
  for (const alias of aliases) {
    if (available.has(alias)) return alias;
  }
  return aliases[0];
}
