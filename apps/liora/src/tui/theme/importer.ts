import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { getDataDir } from '#/utils/paths';

import type { CustomThemeDefinition } from './custom-theme-loader';
import type { ColorPalette, ResolvedTheme } from './colors';
import { darkColors, lightColors } from './colors';

export interface ThemeImportResult {
  readonly themeName: string;
  readonly sourceKind: 'file' | 'url' | 'github';
  readonly themePath: string;
  readonly packPath: string;
}

interface TerminalPalette {
  readonly name: string;
  readonly variant?: ResolvedTheme;
  readonly foreground?: string;
  readonly background?: string;
  readonly cursor?: string;
  readonly selection?: string;
  readonly normal?: readonly string[];
  readonly bright?: readonly string[];
  readonly sourceKind: ThemeImportResult['sourceKind'];
  readonly source: string;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HEX_INPUT_RE = /^#?[0-9a-fA-F]{6}$/;
const BASE_KEYS = Array.from({ length: 16 }, (_, index) =>
  `base${index.toString(16).toUpperCase().padStart(2, '0')}`,
);

export async function importThemeSource(source: string): Promise<ThemeImportResult> {
  const resolved = await readThemeSource(source);
  const palette = parseThemeSource(resolved.text, resolved.name, resolved.kind, source);
  const definition = terminalPaletteToTheme(palette);
  const themeName = definition.name;
  const packDir = join(getDataDir(), 'theme-packs', themeName);
  const themeDir = join(getDataDir(), 'themes');
  const json = JSON.stringify(definition, null, 2) + '\n';
  await mkdir(packDir, { recursive: true });
  await mkdir(themeDir, { recursive: true });
  const packPath = join(packDir, `${themeName}.json`);
  const themePath = join(themeDir, `${themeName}.json`);
  await writeFile(packPath, json, 'utf-8');
  await writeFile(themePath, json, 'utf-8');
  return { themeName, sourceKind: resolved.kind, themePath, packPath };
}

async function readThemeSource(source: string): Promise<{
  readonly text: string;
  readonly name: string;
  readonly kind: ThemeImportResult['sourceKind'];
}> {
  if (source.startsWith('github:')) {
    const spec = source.slice('github:'.length);
    const parts = spec.split('/').filter((part) => part.length > 0);
    if (parts.length < 3) {
      throw new Error('GitHub imports must be github:owner/repo/path/to/theme');
    }
    const owner = parts[0]!;
    const repo = parts[1]!;
    const pathParts = parts.slice(2);
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${pathParts.join('/')}`;
    const text = await fetchText(url);
    return { text, name: basename(pathParts.at(-1) ?? repo), kind: 'github' };
  }
  if (/^https?:\/\//i.test(source)) {
    const text = await fetchText(source);
    return { text, name: basename(new URL(source).pathname), kind: 'url' };
  }
  return { text: await readFile(source, 'utf-8'), name: basename(source), kind: 'file' };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${url}`);
  return response.text();
}

function parseThemeSource(
  text: string,
  sourceName: string,
  sourceKind: ThemeImportResult['sourceKind'],
  source: string,
): TerminalPalette {
  const extension = extname(sourceName).toLowerCase();
  if (extension === '.toml') return parseAlacrittyToml(text, sourceName, sourceKind, source);
  if (extension === '.json') return parseJsonTheme(text, sourceName, sourceKind, source);
  if (extension === '.itermcolors' || text.includes('Ansi 0 Color')) {
    return parseItermColors(text, sourceName, sourceKind, source);
  }
  if (extension === '.yaml' || extension === '.yml' || /\bbase00\s*:/i.test(text)) {
    return parseBaseSchemeYaml(text, sourceName, sourceKind, source);
  }
  if (/BACKGROUND_COLOR|FOREGROUND_COLOR|COLOR_0?1/i.test(text)) {
    return parseGoghShell(text, sourceName, sourceKind, source);
  }
  throw new Error(`Unsupported theme format: ${sourceName}`);
}

function parseBaseSchemeYaml(
  text: string,
  sourceName: string,
  sourceKind: ThemeImportResult['sourceKind'],
  source: string,
): TerminalPalette {
  const palette = new Map<string, string>();
  for (const key of BASE_KEYS) {
    const match = new RegExp(`${key}\\s*:\\s*["']?(#?[0-9a-fA-F]{6})`, 'i').exec(text);
    if (match?.[1] !== undefined) palette.set(key.toLowerCase(), normalizeHex(match[1]));
  }
  const name =
    stringField(text, 'name') ?? stringField(text, 'scheme') ?? sourceNameWithoutExt(sourceName);
  const variantRaw = stringField(text, 'variant')?.toLowerCase();
  const variant: ResolvedTheme | undefined =
    variantRaw === 'light' || variantRaw === 'dark' ? variantRaw : undefined;
  return {
    name,
    variant,
    foreground: palette.get('base05'),
    background: palette.get('base00'),
    cursor: palette.get('base05'),
    selection: palette.get('base02'),
    normal: [
      palette.get('base00'),
      palette.get('base08'),
      palette.get('base0b'),
      palette.get('base0a'),
      palette.get('base0d'),
      palette.get('base0e'),
      palette.get('base0c'),
      palette.get('base05'),
    ].filter(isHex),
    bright: [
      palette.get('base03'),
      palette.get('base08'),
      palette.get('base0b'),
      palette.get('base0a'),
      palette.get('base0d'),
      palette.get('base0e'),
      palette.get('base0c'),
      palette.get('base07'),
    ].filter(isHex),
    sourceKind,
    source,
  };
}

function parseAlacrittyToml(
  text: string,
  sourceName: string,
  sourceKind: ThemeImportResult['sourceKind'],
  source: string,
): TerminalPalette {
  const parsed = parseToml(text) as Record<string, unknown>;
  const colors = objectField(parsed, 'colors');
  const primary = objectField(colors, 'primary');
  const cursor = objectField(colors, 'cursor');
  const selection = objectField(colors, 'selection');
  const normal = colorGroup(colors, 'normal');
  const bright = colorGroup(colors, 'bright');
  return {
    name: sourceNameWithoutExt(sourceName),
    foreground: stringValue(primary?.['foreground']),
    background: stringValue(primary?.['background']),
    cursor: stringValue(cursor?.['cursor']),
    selection: stringValue(selection?.['background']),
    normal,
    bright,
    sourceKind,
    source,
  };
}

function parseJsonTheme(
  text: string,
  sourceName: string,
  sourceKind: ThemeImportResult['sourceKind'],
  source: string,
): TerminalPalette {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const colors = Array.isArray(parsed['colors']) ? parsed['colors'].map(String) : undefined;
  const normal = colors?.slice(0, 8).filter(isHex);
  const bright = colors?.slice(8, 16).filter(isHex);
  return {
    name: plainString(parsed['name']) ?? sourceNameWithoutExt(sourceName),
    foreground: firstHex(parsed['foreground'], parsed['foregroundColor']),
    background: firstHex(parsed['background'], parsed['backgroundColor']),
    cursor: firstHex(parsed['cursorColor'], parsed['cursor']),
    selection: firstHex(parsed['selectionBackground'], parsed['selection']),
    normal: normal?.length === 8 ? normal.map(normalizeHex) : windowsNormal(parsed),
    bright: bright?.length === 8 ? bright.map(normalizeHex) : windowsBright(parsed),
    sourceKind,
    source,
  };
}

function parseItermColors(
  text: string,
  sourceName: string,
  sourceKind: ThemeImportResult['sourceKind'],
  source: string,
): TerminalPalette {
  const getNamed = (name: string): string | undefined => componentColor(text, name);
  const ansi = Array.from({ length: 16 }, (_, index) => getNamed(`Ansi ${String(index)} Color`));
  return {
    name: sourceNameWithoutExt(sourceName),
    foreground: getNamed('Foreground Color'),
    background: getNamed('Background Color'),
    cursor: getNamed('Cursor Color'),
    selection: getNamed('Selection Color'),
    normal: ansi.slice(0, 8).filter(isHex),
    bright: ansi.slice(8, 16).filter(isHex),
    sourceKind,
    source,
  };
}

function parseGoghShell(
  text: string,
  sourceName: string,
  sourceKind: ThemeImportResult['sourceKind'],
  source: string,
): TerminalPalette {
  const get = (name: string): string | undefined => {
    const match = new RegExp(`${name}\\s*=\\s*["']?(#[0-9a-fA-F]{6})`, 'i').exec(text);
    return match?.[1] === undefined ? undefined : normalizeHex(match[1]);
  };
  const normal = Array.from({ length: 8 }, (_, index) =>
    get(`COLOR_${String(index + 1).padStart(2, '0')}`),
  ).filter(isHex);
  const bright = Array.from({ length: 8 }, (_, index) =>
    get(`COLOR_${String(index + 9).padStart(2, '0')}`),
  ).filter(isHex);
  return {
    name: sourceNameWithoutExt(sourceName),
    foreground: get('FOREGROUND_COLOR'),
    background: get('BACKGROUND_COLOR'),
    cursor: get('CURSOR_COLOR'),
    selection: get('SELECTION_BACKGROUND_COLOR'),
    normal,
    bright,
    sourceKind,
    source,
  };
}

function terminalPaletteToTheme(palette: TerminalPalette): CustomThemeDefinition {
  const base = palette.variant ?? inferBase(palette.background);
  const fallback = base === 'light' ? lightColors : darkColors;
  const normal = palette.normal ?? [];
  const bright = palette.bright ?? [];
  const foreground = palette.foreground ?? fallback.text;
  const background = palette.background ?? fallback.background;
  const colors: Partial<ColorPalette> = {
    background,
    surface: mixHex(background, foreground, base === 'light' ? 0.06 : 0.08),
    surfaceRaised: mixHex(background, foreground, base === 'light' ? 0.1 : 0.14),
    surfaceSunken: mixHex(background, '#000000', base === 'light' ? 0.03 : 0.18),
    text: foreground,
    textStrong: base === 'light' ? '#0B1020' : '#FFFFFF',
    textDim: normal[7] ?? fallback.textDim,
    textMuted: normal[8 - 1] ?? fallback.textMuted,
    primary: normal[4] ?? fallback.primary,
    accent: normal[6] ?? fallback.accent,
    border: mixHex(background, foreground, 0.28),
    borderFocus: normal[3] ?? fallback.borderFocus,
    selectionBg: palette.selection ?? mixHex(background, normal[4] ?? fallback.primary, 0.35),
    selectionText: foreground,
    cursor: palette.cursor ?? foreground,
    success: normal[2] ?? fallback.success,
    warning: normal[3] ?? fallback.warning,
    error: normal[1] ?? fallback.error,
    diffAdded: normal[2] ?? fallback.diffAdded,
    diffRemoved: normal[1] ?? fallback.diffRemoved,
    diffAddedStrong: bright[2] ?? normal[2] ?? fallback.diffAddedStrong,
    diffRemovedStrong: bright[1] ?? normal[1] ?? fallback.diffRemovedStrong,
    diffGutter: normal[7] ?? fallback.diffGutter,
    diffMeta: normal[7] ?? fallback.diffMeta,
    roleUser: normal[3] ?? fallback.roleUser,
    shellMode: normal[5] ?? fallback.shellMode,
    glow: bright[4] ?? normal[4] ?? fallback.glow,
    particle: bright[5] ?? normal[5] ?? fallback.particle,
    gradientStart: normal[4] ?? fallback.gradientStart,
    gradientEnd: normal[6] ?? fallback.gradientEnd,
    auroraA: base === 'light'
      ? mixHex(background, bright[4] ?? normal[4] ?? fallback.auroraA, 0.14)
      : mixHex(background, bright[4] ?? normal[4] ?? fallback.auroraA, 0.22),
    auroraB: base === 'light'
      ? mixHex(background, bright[5] ?? normal[5] ?? fallback.auroraB, 0.14)
      : mixHex(background, bright[5] ?? normal[5] ?? fallback.auroraB, 0.22),
    auroraC: base === 'light'
      ? mixHex(background, bright[1] ?? normal[5] ?? fallback.auroraC, 0.12)
      : mixHex(background, bright[1] ?? normal[5] ?? fallback.auroraC, 0.2),
    syntaxText: foreground,
    syntaxKeyword: bright[5] ?? normal[5] ?? fallback.syntaxKeyword,
    syntaxFunction: bright[4] ?? normal[4] ?? fallback.syntaxFunction,
    syntaxType: bright[3] ?? normal[3] ?? fallback.syntaxType,
    syntaxString: bright[2] ?? normal[2] ?? fallback.syntaxString,
    syntaxNumber: bright[1] ?? normal[1] ?? fallback.syntaxNumber,
    syntaxComment: bright[0] ?? normal[7] ?? fallback.syntaxComment,
    syntaxOperator: bright[6] ?? normal[6] ?? fallback.syntaxOperator,
    syntaxTag: normal[1] ?? fallback.syntaxTag,
    syntaxMeta: normal[7] ?? fallback.syntaxMeta,
  };
  return {
    schemaVersion: 2,
    name: slugify(palette.name),
    displayName: palette.name,
    base,
    colors,
    ansi: {
      normal: [...normal],
      bright: [...bright],
      foreground: palette.foreground,
      background: palette.background,
      cursor: palette.cursor,
      selection: palette.selection,
    },
    source: {
      kind: palette.sourceKind,
      url: palette.source,
      importedAt: new Date().toISOString(),
    },
  };
}

function objectField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const child = (value as Record<string, unknown>)[key];
  return typeof child === 'object' && child !== null
    ? (child as Record<string, unknown>)
    : undefined;
}

function colorGroup(value: unknown, key: string): string[] | undefined {
  const group = objectField(value, key);
  if (group === undefined) return undefined;
  const values = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
    .map((name) => stringValue(group[name]))
    .filter(isHex)
    .map(normalizeHex);
  return values.length === 8 ? values : undefined;
}

function windowsNormal(parsed: Record<string, unknown>): string[] | undefined {
  return ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white']
    .map((key) => stringValue(parsed[key]))
    .filter(isHex)
    .map(normalizeHex);
}

function windowsBright(parsed: Record<string, unknown>): string[] | undefined {
  return [
    'brightBlack',
    'brightRed',
    'brightGreen',
    'brightYellow',
    'brightBlue',
    'brightPurple',
    'brightCyan',
    'brightWhite',
  ].map((key) => stringValue(parsed[key])).filter(isHex).map(normalizeHex);
}

function componentColor(text: string, key: string): string | undefined {
  const escaped = escapeRegex(key);
  const xmlBlock = new RegExp(`<key>${escaped}</key>\\s*<dict>([\\s\\S]*?)</dict>`, 'i')
    .exec(text)?.[1];
  const flatBlock = new RegExp(
    `${escaped}([\\s\\S]*?)(?=(?:Ansi \\d+|Background|Bold|Cursor|Foreground|Selected Text|Selection) Color|$)`,
    'i',
  ).exec(text)?.[1];
  const block = xmlBlock ?? flatBlock;
  if (block === undefined) return undefined;
  const red = realComponent(block, 'Red Component');
  const green = realComponent(block, 'Green Component');
  const blue = realComponent(block, 'Blue Component');
  if (red === undefined || green === undefined || blue === undefined) return undefined;
  return rgbToHex(red, green, blue);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function realComponent(block: string, name: string): number | undefined {
  const xml = new RegExp(`<key>${name}</key>\\s*<real>([0-9.]+)</real>`, 'i').exec(block);
  const flat = new RegExp(`${name}\\s+([0-9.]+)`, 'i').exec(block);
  const raw = xml?.[1] ?? flat?.[1];
  if (raw === undefined) return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function rgbToHex(red: number, green: number, blue: number): string {
  const part = (value: number): string => Math.round(value * 255).toString(16).padStart(2, '0');
  return `#${part(red)}${part(green)}${part(blue)}`.toUpperCase();
}

function stringField(text: string, key: string): string | undefined {
  const match = new RegExp(`${key}\\s*:\\s*["']?([^"'\\n#]+)`, 'i').exec(text);
  return match?.[1]?.trim();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && HEX_INPUT_RE.test(value) ? normalizeHex(value) : undefined;
}

function plainString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function firstHex(...values: unknown[]): string | undefined {
  for (const value of values) {
    const hex = stringValue(value);
    if (hex !== undefined) return hex;
  }
  return undefined;
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

function normalizeHex(value: string): string {
  return (value.startsWith('#') ? value : `#${value}`).toUpperCase();
}

function sourceNameWithoutExt(sourceName: string): string {
  return sourceName.slice(0, sourceName.length - extname(sourceName).length) || sourceName;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'imported-theme';
}

function inferBase(background: string | undefined): ResolvedTheme {
  if (background === undefined) return 'dark';
  const rgb = parseHex(background);
  if (rgb === undefined) return 'dark';
  const luminance = (0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue) / 255;
  return luminance > 0.55 ? 'light' : 'dark';
}

function parseHex(
  hex: string,
): { readonly red: number; readonly green: number; readonly blue: number } | undefined {
  if (!HEX_RE.test(hex)) return undefined;
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function mixHex(fromHex: string, toHex: string, ratio: number): string {
  const from = parseHex(fromHex);
  const to = parseHex(toHex);
  if (from === undefined || to === undefined) return fromHex;
  const mix = (a: number, b: number): string =>
    Math.round(a + (b - a) * Math.max(0, Math.min(1, ratio)))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(from.red, to.red)}${mix(from.green, to.green)}${mix(from.blue, to.blue)}`.toUpperCase();
}
