#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseToml } from 'smol-toml';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..');
const OUTPUT_FILE = join(
  PACKAGE_ROOT,
  'src/tui/theme/bundled-external-themes.generated.ts',
);

const REPOS = [
  {
    id: 'tinted',
    label: 'Tinted',
    repo: 'https://github.com/tinted-theming/schemes.git',
    web: 'https://github.com/tinted-theming/schemes',
    branch: 'spec-0.11',
    dir: 'tinted-schemes',
    license: 'MIT',
  },
  {
    id: 'iterm2',
    label: 'iTerm2',
    repo: 'https://github.com/mbadolato/iTerm2-Color-Schemes.git',
    web: 'https://github.com/mbadolato/iTerm2-Color-Schemes',
    branch: 'master',
    dir: 'iterm2-color-schemes',
    license: 'MIT collection; individual themes retain their original authorship',
  },
  {
    id: 'gogh',
    label: 'Gogh',
    repo: 'https://github.com/Gogh-Co/Gogh.git',
    web: 'https://github.com/Gogh-Co/Gogh',
    branch: 'master',
    dir: 'gogh',
    license: 'MIT',
  },
  {
    id: 'alacritty',
    label: 'Alacritty',
    repo: 'https://github.com/alacritty/alacritty-theme.git',
    web: 'https://github.com/alacritty/alacritty-theme',
    branch: 'master',
    dir: 'alacritty-theme',
    license: 'Apache-2.0',
  },
];

const BASE_KEYS = Array.from({ length: 24 }, (_, index) =>
  `base${index.toString(16).toUpperCase().padStart(2, '0')}`,
);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HEX_INPUT_RE = /^#?[0-9a-fA-F]{6}$/;
const COLOR_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

const DARK_FALLBACK = {
  background: '#0B0F14',
  text: '#E6EDF3',
  textStrong: '#FFFFFF',
  textDim: '#9AA7B2',
  textMuted: '#6F7A86',
  primary: '#7DD3FC',
  accent: '#2DD4BF',
  border: '#334155',
  borderFocus: '#7DD3FC',
  success: '#36D399',
  warning: '#F5C542',
  error: '#FF5C7A',
  diffAdded: '#36D399',
  diffRemoved: '#FF5C7A',
  diffAddedStrong: '#7AF0B4',
  diffRemovedStrong: '#FF91A6',
  diffGutter: '#738091',
  diffMeta: '#9AA7B2',
  roleUser: '#FFE082',
  shellMode: '#B784FF',
  glow: '#7DD3FC',
  particle: '#B784FF',
  gradientStart: '#7DD3FC',
  gradientEnd: '#2DD4BF',
  syntaxKeyword: '#C792EA',
  syntaxFunction: '#82AAFF',
  syntaxType: '#FFCB6B',
  syntaxString: '#C3E88D',
  syntaxNumber: '#F78C6C',
  syntaxComment: '#697098',
  syntaxOperator: '#89DDFF',
  syntaxTag: '#F07178',
  syntaxMeta: '#7FDBCA',
};

const LIGHT_FALLBACK = {
  background: '#FFFFFF',
  text: '#172033',
  textStrong: '#0B1020',
  textDim: '#46556A',
  textMuted: '#66758A',
  primary: '#075985',
  accent: '#0F766E',
  border: '#8A98AA',
  borderFocus: '#B45309',
  success: '#166534',
  warning: '#B45309',
  error: '#B42318',
  diffAdded: '#166534',
  diffRemoved: '#B42318',
  diffAddedStrong: '#14532D',
  diffRemovedStrong: '#991B1B',
  diffGutter: '#66758A',
  diffMeta: '#46556A',
  roleUser: '#92400E',
  shellMode: '#6D28D9',
  glow: '#075985',
  particle: '#6D28D9',
  gradientStart: '#075985',
  gradientEnd: '#0F766E',
  syntaxKeyword: '#6D28D9',
  syntaxFunction: '#075985',
  syntaxType: '#9A4A00',
  syntaxString: '#0E7A38',
  syntaxNumber: '#B45309',
  syntaxComment: '#6B7280',
  syntaxOperator: '#0F766E',
  syntaxTag: '#B91C1C',
  syntaxMeta: '#5F5F5F',
};

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    args.set(arg, process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i]);
  }
}

const sourceRoot = resolve(
  String(args.get('--source-dir') ?? join(tmpdir(), 'kimi-bundled-theme-sources')),
);
const clean = args.get('--clean') === true;

await mkdir(sourceRoot, { recursive: true });
if (clean) {
  for (const repo of REPOS) await rm(join(sourceRoot, repo.dir), { recursive: true, force: true });
}

for (const repo of REPOS) {
  await ensureRepo(repo);
}

const themes = [];
themes.push(...await collectTinted());
themes.push(...await collectIterm2());
themes.push(...await collectGogh());
themes.push(...await collectAlacritty());

const sorted = dedupeThemes(themes).sort((a, b) => a.name.localeCompare(b.name));
await writeGeneratedFile(sorted);

console.log(`Wrote ${sorted.length} bundled external TUI themes to ${relative(process.cwd(), OUTPUT_FILE)}`);

async function ensureRepo(repo) {
  const dir = join(sourceRoot, repo.dir);
  if (!existsSync(join(dir, '.git'))) {
    execFileSync('git', ['clone', '--depth=1', repo.repo, dir], { stdio: 'inherit' });
    return;
  }
  execFileSync('git', ['-C', dir, 'fetch', '--depth=1', 'origin', repo.branch], {
    stdio: 'inherit',
  });
  execFileSync('git', ['-C', dir, 'checkout', 'FETCH_HEAD'], { stdio: 'inherit' });
}

async function collectTinted() {
  const repo = REPOS.find((candidate) => candidate.id === 'tinted');
  const root = join(sourceRoot, repo.dir);
  const files = await listFiles(root, (file) => /\.(ya?ml)$/i.test(file));
  return collectFiles(repo, files, (file, text) => {
    const rel = relative(root, file);
    const family = rel.startsWith('base24/') ? 'base24' : 'base16';
    return parseBaseSchemeYaml(text, sourceName(file), {
      packId: `tinted-${family}`,
      packLabel: `Tinted ${family.toUpperCase()}`,
      sourceUrl: fileUrl(repo, rel),
      license: repo.license,
    });
  });
}

async function collectIterm2() {
  const repo = REPOS.find((candidate) => candidate.id === 'iterm2');
  const root = join(sourceRoot, repo.dir);
  const schemeFiles = await listFiles(join(root, 'schemes'), (file) =>
    file.endsWith('.itermcolors'),
  );
  const windowsFiles = await listFiles(join(root, 'windowsterminal'), (file) =>
    file.endsWith('.json'),
  );
  return [
    ...await collectFiles(repo, schemeFiles, (file, text) =>
      parseItermColors(text, sourceName(file), {
        packId: 'iterm2',
        packLabel: 'iTerm2',
        sourceUrl: fileUrl(repo, relative(root, file)),
        license: repo.license,
      }),
    ),
    ...await collectFiles(repo, windowsFiles, (file, text) =>
      parseJsonTheme(text, sourceName(file), {
        packId: 'windows-terminal',
        packLabel: 'Windows Terminal',
        sourceUrl: fileUrl(repo, relative(root, file)),
        license: repo.license,
      }),
    ),
  ];
}

async function collectGogh() {
  const repo = REPOS.find((candidate) => candidate.id === 'gogh');
  const root = join(sourceRoot, repo.dir);
  const files = await listFiles(join(root, 'installs'), (file) => file.endsWith('.sh'));
  return collectFiles(repo, files, (file, text) =>
    parseGoghShell(text, sourceName(file), {
      packId: 'gogh',
      packLabel: 'Gogh',
      sourceUrl: fileUrl(repo, relative(root, file)),
      license: repo.license,
    }),
  );
}

async function collectAlacritty() {
  const repo = REPOS.find((candidate) => candidate.id === 'alacritty');
  const root = join(sourceRoot, repo.dir);
  const files = await listFiles(join(root, 'themes'), (file) => file.endsWith('.toml'));
  return collectFiles(repo, files, (file, text) =>
    parseAlacrittyToml(text, sourceName(file), {
      packId: 'alacritty',
      packLabel: 'Alacritty',
      sourceUrl: fileUrl(repo, relative(root, file)),
      license: repo.license,
    }),
  );
}

async function collectFiles(repo, files, parse) {
  const out = [];
  for (const file of files.toSorted()) {
    try {
      const text = await readFile(file, 'utf-8');
      const palette = parse(file, text);
      if (palette !== undefined) out.push(terminalPaletteToTheme(palette));
    } catch (error) {
      console.warn(`Skipping ${repo.id}:${relative(join(sourceRoot, repo.dir), file)}: ${error.message}`);
    }
  }
  return out;
}

async function listFiles(root, predicate) {
  const out = [];
  if (!existsSync(root)) return out;
  async function walk(dir) {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const file = join(dir, entry);
      const info = await stat(file);
      if (info.isDirectory()) {
        await walk(file);
      } else if (info.isFile() && predicate(file)) {
        out.push(file);
      }
    }
  }
  await walk(root);
  return out;
}

function parseBaseSchemeYaml(text, sourceName, source) {
  const palette = new Map();
  for (const key of BASE_KEYS) {
    const match = new RegExp(`${key}\\s*:\\s*["']?(#?[0-9a-fA-F]{6})`, 'i').exec(text);
    if (match?.[1] !== undefined) palette.set(key.toLowerCase(), normalizeHex(match[1]));
  }
  if (palette.size < 8) return undefined;
  const name = stringField(text, 'name') ?? stringField(text, 'scheme') ?? sourceNameWithoutExt(sourceName);
  const variantRaw = stringField(text, 'variant')?.toLowerCase();
  return {
    name,
    variant: variantRaw === 'light' || variantRaw === 'dark' ? variantRaw : undefined,
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
      palette.get('base12') ?? palette.get('base08'),
      palette.get('base14') ?? palette.get('base0b'),
      palette.get('base13') ?? palette.get('base0a'),
      palette.get('base16') ?? palette.get('base0d'),
      palette.get('base17') ?? palette.get('base0e'),
      palette.get('base15') ?? palette.get('base0c'),
      palette.get('base07'),
    ].filter(isHex),
    source,
  };
}

function parseAlacrittyToml(text, sourceName, source) {
  const parsed = parseToml(text);
  const colors = objectField(parsed, 'colors');
  const primary = objectField(colors, 'primary');
  const cursor = objectField(colors, 'cursor');
  const selection = objectField(colors, 'selection');
  const normal = colorGroup(colors, 'normal');
  const bright = colorGroup(colors, 'bright');
  return {
    name: sourceNameWithoutExt(sourceName),
    foreground: stringValue(primary?.foreground),
    background: stringValue(primary?.background),
    cursor: stringValue(cursor?.cursor),
    selection: stringValue(selection?.background),
    normal,
    bright,
    source,
  };
}

function parseJsonTheme(text, sourceName, source) {
  const parsed = JSON.parse(text);
  const colors = Array.isArray(parsed.colors)
    ? parsed.colors.map((value) => stringValue(value)).filter(isHex)
    : undefined;
  return {
    name: plainString(parsed.name) ?? sourceNameWithoutExt(sourceName),
    foreground: firstHex(parsed.foreground, parsed.foregroundColor),
    background: firstHex(parsed.background, parsed.backgroundColor),
    cursor: firstHex(parsed.cursorColor, parsed.cursor),
    selection: firstHex(parsed.selectionBackground, parsed.selection),
    normal: colors?.length >= 8 ? colors.slice(0, 8) : windowsNormal(parsed),
    bright: colors?.length >= 16 ? colors.slice(8, 16) : windowsBright(parsed),
    source,
  };
}

function parseItermColors(text, sourceName, source) {
  const getNamed = (name) => componentColor(text, name);
  const ansi = Array.from({ length: 16 }, (_, index) => getNamed(`Ansi ${String(index)} Color`));
  return {
    name: sourceNameWithoutExt(sourceName),
    foreground: getNamed('Foreground Color'),
    background: getNamed('Background Color'),
    cursor: getNamed('Cursor Color'),
    selection: getNamed('Selection Color'),
    normal: ansi.slice(0, 8).filter(isHex),
    bright: ansi.slice(8, 16).filter(isHex),
    source,
  };
}

function parseGoghShell(text, sourceName, source) {
  const get = (name) => {
    const match = new RegExp(`${name}\\s*=\\s*["']?(#[0-9a-fA-F]{6})`, 'i').exec(text);
    return match?.[1] === undefined ? undefined : normalizeHex(match[1]);
  };
  return {
    name: getProfileName(text) ?? sourceNameWithoutExt(sourceName),
    foreground: get('FOREGROUND_COLOR'),
    background: get('BACKGROUND_COLOR'),
    cursor: get('CURSOR_COLOR'),
    selection: get('SELECTION_BACKGROUND_COLOR'),
    normal: Array.from({ length: 8 }, (_, index) =>
      get(`COLOR_${String(index + 1).padStart(2, '0')}`),
    ).filter(isHex),
    bright: Array.from({ length: 8 }, (_, index) =>
      get(`COLOR_${String(index + 9).padStart(2, '0')}`),
    ).filter(isHex),
    source,
  };
}

function terminalPaletteToTheme(palette) {
  const base = palette.variant ?? inferBase(palette.background);
  const fallback = base === 'light' ? LIGHT_FALLBACK : DARK_FALLBACK;
  const normal = palette.normal ?? [];
  const bright = palette.bright ?? [];
  const foreground = palette.foreground ?? fallback.text;
  const background = palette.background ?? fallback.background;
  const displayName = `${palette.name} (${palette.source.packLabel})`;
  const name = `${palette.source.packId}-${slugify(palette.name)}`;
  return {
    schemaVersion: 2,
    name,
    displayName,
    base,
    colors: {
      background,
      surface: mixHex(background, foreground, base === 'light' ? 0.06 : 0.08),
      surfaceRaised: mixHex(background, foreground, base === 'light' ? 0.1 : 0.14),
      surfaceSunken: mixHex(background, '#000000', base === 'light' ? 0.03 : 0.18),
      text: foreground,
      textStrong: base === 'light' ? '#0B1020' : '#FFFFFF',
      textDim: normal[7] ?? fallback.textDim,
      textMuted: bright[0] ?? normal[7] ?? fallback.textMuted,
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
    },
    source: {
      kind: 'bundled',
      url: palette.source.sourceUrl,
      license: palette.source.license,
    },
  };
}

function dedupeThemes(themes) {
  const seen = new Map();
  return themes.map((theme) => {
    const count = seen.get(theme.name) ?? 0;
    seen.set(theme.name, count + 1);
    return count === 0
      ? theme
      : { ...theme, name: `${theme.name}-${String(count + 1)}` };
  });
}

async function writeGeneratedFile(themes) {
  const json = JSON.stringify(themes, null, 2);
  const content = `import type { CustomThemeDefinition } from './custom-theme-loader';

// Generated by apps/liora/scripts/sync-bundled-themes.mjs. Do not edit manually.
export const BUNDLED_EXTERNAL_THEMES: readonly CustomThemeDefinition[] = ${json};
`;
  await writeFile(OUTPUT_FILE, content, 'utf-8');
}

function fileUrl(repo, rel) {
  return `${repo.web}/blob/${repo.branch}/${rel.split(/[/\\]/).map(encodeURIComponent).join('/')}`;
}

function sourceName(file) {
  return basename(file);
}

function sourceNameWithoutExt(sourceName) {
  return sourceName.slice(0, sourceName.length - extname(sourceName).length) || sourceName;
}

function stringField(text, key) {
  const match = new RegExp(`${key}\\s*:\\s*["']?([^"'\\n#]+)`, 'i').exec(text);
  return match?.[1]?.trim();
}

function getProfileName(text) {
  const match = /PROFILE_NAME\s*=\s*["']([^"']+)["']/i.exec(text);
  return match?.[1]?.trim();
}

function objectField(value, key) {
  if (typeof value !== 'object' || value === null) return undefined;
  const child = value[key];
  return typeof child === 'object' && child !== null ? child : undefined;
}

function colorGroup(value, key) {
  const group = objectField(value, key);
  if (group === undefined) return undefined;
  const values = COLOR_NAMES.map((name) => stringValue(group[name])).filter(isHex);
  return values.length === 8 ? values : undefined;
}

function windowsNormal(parsed) {
  const values = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white']
    .map((key) => stringValue(parsed[key]))
    .filter(isHex);
  return values.length === 8 ? values : undefined;
}

function windowsBright(parsed) {
  const values = [
    'brightBlack',
    'brightRed',
    'brightGreen',
    'brightYellow',
    'brightBlue',
    'brightPurple',
    'brightCyan',
    'brightWhite',
  ].map((key) => stringValue(parsed[key])).filter(isHex);
  return values.length === 8 ? values : undefined;
}

function componentColor(text, key) {
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

function realComponent(block, name) {
  const xml = new RegExp(`<key>${name}</key>\\s*<real>([0-9.]+)</real>`, 'i').exec(block);
  const flat = new RegExp(`${name}\\s+([0-9.]+)`, 'i').exec(block);
  const raw = xml?.[1] ?? flat?.[1];
  if (raw === undefined) return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function rgbToHex(red, green, blue) {
  const part = (value) => Math.round(value * 255).toString(16).padStart(2, '0');
  return `#${part(red)}${part(green)}${part(blue)}`.toUpperCase();
}

function firstHex(...values) {
  for (const value of values) {
    const hex = stringValue(value);
    if (hex !== undefined) return hex;
  }
  return undefined;
}

function stringValue(value) {
  return typeof value === 'string' && HEX_INPUT_RE.test(value) ? normalizeHex(value) : undefined;
}

function plainString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isHex(value) {
  return typeof value === 'string' && HEX_RE.test(value);
}

function normalizeHex(value) {
  return (value.startsWith('#') ? value : `#${value}`).toUpperCase();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugify(value) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'imported-theme';
}

function inferBase(background) {
  const rgb = parseHex(background);
  if (rgb === undefined) return 'dark';
  const luminance = (0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue) / 255;
  return luminance > 0.55 ? 'light' : 'dark';
}

function parseHex(hex) {
  if (hex === undefined || !HEX_RE.test(hex)) return undefined;
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function mixHex(fromHex, toHex, ratio) {
  const from = parseHex(fromHex);
  const to = parseHex(toHex);
  if (from === undefined || to === undefined) return fromHex;
  const mix = (a, b) =>
    Math.round(a + (b - a) * Math.max(0, Math.min(1, ratio)))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(from.red, to.red)}${mix(from.green, to.green)}${mix(from.blue, to.blue)}`.toUpperCase();
}
