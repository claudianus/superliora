import { readFileSync, readdirSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { getDataDir } from '#/utils/paths';
import { BUNDLED_EXTERNAL_THEMES } from './bundled-external-themes.generated';
import { BUNDLED_THEMES } from './bundled-themes';
import type { ColorPalette, ResolvedTheme } from './colors';
import { getBuiltInPalette } from './colors';

export const CustomThemeSchema = z.object({
  schemaVersion: z.number().int().positive().optional(),
  name: z.string().min(1),
  displayName: z.string().optional(),
  /** Built-in palette that unspecified tokens fall back to. Defaults to `dark`. */
  base: z.enum(['dark', 'light']).optional(),
  colors: z.record(z.string(), z.string()).optional(),
  ansi: z
    .object({
      normal: z.array(z.string()).optional(),
      bright: z.array(z.string()).optional(),
      foreground: z.string().optional(),
      background: z.string().optional(),
      cursor: z.string().optional(),
      selection: z.string().optional(),
    })
    .optional(),
  effects: z.record(z.string(), z.unknown()).optional(),
  layout: z.record(z.string(), z.unknown()).optional(),
  source: z
    .object({
      kind: z.string().optional(),
      url: z.string().optional(),
      license: z.string().optional(),
      importedAt: z.string().optional(),
    })
    .optional(),
});

export type CustomThemeDefinition = z.infer<typeof CustomThemeSchema>;
export type ThemeSource = 'bundled' | 'bundled-external' | 'custom';

export interface ThemeListEntry {
  readonly name: string;
  readonly displayName?: string;
  readonly source: ThemeSource;
  readonly base?: ResolvedTheme;
  readonly pack?: string;
  readonly overridesBundled?: boolean;
}

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Names reserved for built-in themes. A `dark.json` / `light.json` /
 * `auto.json` file would collide with the built-in value, so it can never be
 * selected as a custom theme — hide it from listings.
 */
const RESERVED_THEME_NAMES: ReadonlySet<string> = new Set(['dark', 'light', 'auto']);
const ALL_BUNDLED_THEMES = [...BUNDLED_THEMES, ...BUNDLED_EXTERNAL_THEMES] as const;
const THEME_BASE_ORDER: Record<ResolvedTheme, number> = { dark: 0, light: 1 };

export function getCustomThemesDir(): string {
  return join(getDataDir(), 'themes');
}

interface ParsedCustomTheme {
  readonly base: ResolvedTheme;
  readonly colors: Partial<ColorPalette>;
  readonly displayName?: string;
}

function parseThemeDefinition(input: unknown): ParsedCustomTheme | null {
  try {
    const parsed = CustomThemeSchema.parse(input);

    const colors = Object.fromEntries(
      Object.entries(parsed.colors ?? {}).filter(([, v]) => HEX_COLOR_REGEX.test(v)),
    ) as Partial<ColorPalette>;

    return {
      base: parsed.base ?? 'dark',
      colors,
      displayName: parsed.displayName,
    };
  } catch {
    return null;
  }
}

async function readCustomTheme(name: string): Promise<ParsedCustomTheme | null> {
  try {
    const content = await readFile(join(getCustomThemesDir(), `${name}.json`), 'utf-8');
    return parseThemeDefinition(JSON.parse(content));
  } catch {
    return null;
  }
}

function readCustomThemeSync(name: string): ParsedCustomTheme | null {
  try {
    const content = readFileSync(join(getCustomThemesDir(), `${name}.json`), 'utf-8');
    return parseThemeDefinition(JSON.parse(content));
  } catch {
    return null;
  }
}

function readBundledTheme(name: string): ParsedCustomTheme | null {
  const theme = ALL_BUNDLED_THEMES.find((candidate) => candidate.name === name);
  if (theme === undefined) return null;
  return parseThemeDefinition(theme);
}

export async function loadCustomTheme(name: string): Promise<Partial<ColorPalette> | null> {
  return (await readCustomTheme(name))?.colors ?? null;
}

export async function loadCustomThemeMerged(name: string): Promise<ColorPalette | null> {
  const parsed = (await readCustomTheme(name)) ?? readBundledTheme(name);
  if (parsed === null) return null;
  return { ...getBuiltInPalette(parsed.base), ...parsed.colors };
}

export function loadCustomThemeMergedSync(name: string): ColorPalette | null {
  const parsed = readCustomThemeSync(name) ?? readBundledTheme(name);
  if (parsed === null) return null;
  return { ...getBuiltInPalette(parsed.base), ...parsed.colors };
}

function toThemeNames(files: readonly string[]): string[] {
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((name) => !RESERVED_THEME_NAMES.has(name))
    .toSorted();
}

function superKimiThemeEntries(): ThemeListEntry[] {
  return BUNDLED_THEMES
    .filter((theme) => !RESERVED_THEME_NAMES.has(theme.name))
    .map((theme) => ({
      name: theme.name,
      displayName: theme.displayName,
      source: 'bundled' as const,
      base: theme.base ?? 'dark',
    }));
}

function externalBundledThemeEntries(): ThemeListEntry[] {
  return dedupeBundledThemes(BUNDLED_EXTERNAL_THEMES)
    .toSorted(compareThemeDefinitions)
    .filter((theme) => !RESERVED_THEME_NAMES.has(theme.name))
    .map((theme) => ({
      name: theme.name,
      displayName: theme.displayName,
      source: 'bundled-external' as const,
      base: theme.base ?? 'dark',
      pack: theme.source?.url,
    }));
}

function customThemeEntries(names: readonly string[]): ThemeListEntry[] {
  const bundledNames = new Set(ALL_BUNDLED_THEMES.map((theme) => theme.name));
  return names.map((name) => ({
    name,
    source: 'custom' as const,
    overridesBundled: bundledNames.has(name) ? true : undefined,
  }));
}

function mergeThemeEntries(customNames: readonly string[]): ThemeListEntry[] {
  const customNameSet = new Set(customNames);
  return [
    ...superKimiThemeEntries().filter((theme) => !customNameSet.has(theme.name)),
    ...customThemeEntries(customNames),
    ...externalBundledThemeEntries().filter((theme) => !customNameSet.has(theme.name)),
  ];
}

function dedupeBundledThemes(
  themes: readonly CustomThemeDefinition[],
): CustomThemeDefinition[] {
  const seen = new Set<string>();
  const deduped: CustomThemeDefinition[] = [];
  for (const theme of themes) {
    const signature = themePaletteSignature(theme);
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(theme);
  }
  return deduped;
}

function themePaletteSignature(theme: CustomThemeDefinition): string {
  const parsed = parseThemeDefinition(theme);
  const base = parsed?.base ?? 'dark';
  const palette = { ...getBuiltInPalette(base), ...(parsed?.colors ?? {}) };
  const colors = Object.entries(palette)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([token, color]) => [token, color.toUpperCase()]);
  return JSON.stringify([base, colors]);
}

function compareThemeDefinitions(
  a: CustomThemeDefinition,
  b: CustomThemeDefinition,
): number {
  const baseDiff = THEME_BASE_ORDER[a.base ?? 'dark'] - THEME_BASE_ORDER[b.base ?? 'dark'];
  if (baseDiff !== 0) return baseDiff;
  return (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name);
}

export async function listCustomThemes(): Promise<string[]> {
  try {
    const entries = await readdir(getCustomThemesDir(), { withFileTypes: true });
    return toThemeNames(entries.filter((e) => e.isFile()).map((e) => e.name));
  } catch {
    return [];
  }
}

/** Synchronous variant for UI paths (e.g. the `/theme` picker) that cannot await. */
export function listCustomThemesSync(): string[] {
  try {
    const entries = readdirSync(getCustomThemesDir(), { withFileTypes: true });
    return toThemeNames(entries.filter((e) => e.isFile()).map((e) => e.name));
  } catch {
    return [];
  }
}

export async function listAvailableThemeEntries(): Promise<ThemeListEntry[]> {
  return mergeThemeEntries(await listCustomThemes());
}

export function listAvailableThemeEntriesSync(): ThemeListEntry[] {
  return mergeThemeEntries(listCustomThemesSync());
}
