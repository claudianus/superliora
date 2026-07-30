import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { isDir, isObject } from './paths';
import { normalizePluginId } from './types';

export interface PluginThemeDef {
  /** Stable selector id: `plugin-<pluginId>-<slug>` (filesystem-safe). */
  readonly id: string;
  readonly pluginId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly path: string;
  readonly base: 'dark' | 'light';
  /** Claude `overrides` and/or SuperLiora `colors` hex map. */
  readonly colors: Readonly<Record<string, string>>;
}

/**
 * Load Claude-style theme JSON files from a plugin `themes/` directory.
 * Accepts `{ name, base, overrides }` and SuperLiora `{ colors }` shapes.
 */
export async function loadPluginThemes(input: {
  readonly pluginId: string;
  readonly themesDir: string;
}): Promise<readonly PluginThemeDef[]> {
  if (!(await isDir(input.themesDir))) return [];
  let entries;
  try {
    entries = await readdir(input.themesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const pluginId = normalizePluginId(input.pluginId);
  const out: PluginThemeDef[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const slug = entry.name.replace(/\.json$/i, '');
    if (slug.length === 0) continue;
    const full = path.join(input.themesDir, entry.name);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(full, 'utf8')) as unknown;
    } catch {
      continue;
    }
    if (!isObject(raw)) continue;
    const base = raw['base'] === 'light' ? 'light' : 'dark';
    const displayName =
      typeof raw['name'] === 'string' && raw['name'].trim() !== ''
        ? raw['name'].trim()
        : typeof raw['displayName'] === 'string' && raw['displayName'].trim() !== ''
          ? raw['displayName'].trim()
          : slug;
    const colors = collectHexColors(raw['overrides'] ?? raw['colors']);
    out.push({
      id: pluginThemeId(pluginId, slug),
      pluginId,
      slug,
      displayName,
      path: full,
      base,
      colors,
    });
  }
  return out.toSorted((a, b) => a.slug.localeCompare(b.slug));
}

export function pluginThemeId(pluginId: string, slug: string): string {
  return `plugin-${normalizePluginId(pluginId)}-${slug}`;
}

function collectHexColors(raw: unknown): Record<string, string> {
  if (!isObject(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
      out[key] = value;
    }
  }
  return out;
}
