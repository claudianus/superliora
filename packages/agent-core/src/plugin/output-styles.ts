import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseFrontmatter } from '../skill/parser';
import { isDir } from './paths';

export interface PluginOutputStyle {
  readonly pluginId: string;
  readonly name: string;
  readonly description?: string;
  readonly body: string;
  /** Claude `force-for-plugin`: apply whenever the plugin is enabled. */
  readonly forceForPlugin: boolean;
  /** Claude `keep-coding-instructions`. */
  readonly keepCodingInstructions: boolean;
}

/** Load markdown (+ optional frontmatter) from a plugin outputStyles directory. */
export async function loadPluginOutputStyles(input: {
  readonly pluginId: string;
  readonly outputStylesDir: string;
}): Promise<readonly PluginOutputStyle[]> {
  if (!(await isDir(input.outputStylesDir))) return [];
  let entries;
  try {
    entries = await readdir(input.outputStylesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: PluginOutputStyle[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md') && !entry.name.endsWith('.txt')) continue;
    const full = path.join(input.outputStylesDir, entry.name);
    let text: string;
    try {
      text = await readFile(full, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseFrontmatter(text);
    const data = isRecord(parsed.data) ? parsed.data : {};
    const name =
      (typeof data['name'] === 'string' && data['name'].trim() !== ''
        ? data['name'].trim()
        : entry.name.replace(/\.(md|txt)$/i, '')) || entry.name;
    const body = parsed.body.trim();
    if (body.length === 0) continue;
    out.push({
      pluginId: input.pluginId,
      name,
      description: typeof data['description'] === 'string' ? data['description'] : undefined,
      body,
      forceForPlugin:
        data['force-for-plugin'] === true || data['forceForPlugin'] === true,
      keepCodingInstructions:
        data['keep-coding-instructions'] === true || data['keepCodingInstructions'] === true,
    });
  }
  return out.toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * Prefer forced styles; if none, include all (legacy behavior for plugins
 * without frontmatter).
 */
export function selectOutputStylesForSession(
  styles: readonly PluginOutputStyle[],
): readonly PluginOutputStyle[] {
  const forced = styles.filter((style) => style.forceForPlugin);
  if (forced.length > 0) {
    // Claude: first loaded wins when multiple force-for-plugin.
    return [forced[0]!];
  }
  return styles;
}

/** Concatenate selected plugin styles into a system-reminder block. */
export function renderOutputStylesReminder(styles: readonly PluginOutputStyle[]): string | undefined {
  const selected = selectOutputStylesForSession(styles);
  if (selected.length === 0) return undefined;
  const blocks = selected.map(
    (style) =>
      `<!-- plugin-output-style:${style.pluginId}:${style.name} -->\n${style.body}`,
  );
  return [
    'The following output style instructions come from enabled plugins:',
    '',
    ...blocks,
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
