import type { RendererCell, RendererCellStyle } from './cell-buffer';

export const RENDERER_THEME_COLOR_TOKENS = [
  'surface',
  'surfaceRaised',
  'surfaceMuted',
  'surfaceInverse',
  'text',
  'textMuted',
  'textSubtle',
  'textInverse',
  'accent',
  'accentMuted',
  'success',
  'warning',
  'danger',
  'info',
  'border',
  'borderFocus',
  'selection',
  'shadow',
] as const;

export const RENDERER_THEME_STYLE_TOKENS = [
  'body',
  'muted',
  'subtle',
  'inverse',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
  'border',
  'focus',
  'panel',
  'panelRaised',
  'selection',
] as const;

export type RendererThemeColorToken = (typeof RENDERER_THEME_COLOR_TOKENS)[number];
export type RendererThemeStyleToken = (typeof RENDERER_THEME_STYLE_TOKENS)[number];
export type RendererThemeMode = 'dark' | 'light';
export type RendererThemeColorReference = RendererThemeColorToken | `#${string}`;

export type RendererThemePalette = {
  readonly [Token in RendererThemeColorToken]: string;
};

export interface RendererThemeStyle {
  readonly fg?: RendererThemeColorReference;
  readonly bg?: RendererThemeColorReference;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly inverse?: boolean;
}

export type RendererThemeStyleMap = {
  readonly [Token in RendererThemeStyleToken]: RendererThemeStyle;
} & Readonly<Record<string, RendererThemeStyle>>;

export interface RendererTheme {
  readonly name: string;
  readonly mode: RendererThemeMode;
  readonly palette: RendererThemePalette;
  readonly styles: RendererThemeStyleMap;
}

export type RendererThemeContrastRole = 'text' | 'ui';

export interface RendererThemeContrastCheckInput {
  readonly id: string;
  readonly foreground: RendererThemeColorReference;
  readonly background: RendererThemeColorReference;
  readonly role?: RendererThemeContrastRole;
  readonly minRatio?: number;
}

export interface RendererThemeContrastCheck {
  readonly id: string;
  readonly foreground: string;
  readonly background: string;
  readonly role: RendererThemeContrastRole;
  readonly ratio: number;
  readonly minRatio: number;
  readonly passed: boolean;
}

export interface RendererThemeAuditOptions {
  readonly checks?: readonly RendererThemeContrastCheckInput[];
  readonly textRatio?: number;
  readonly uiRatio?: number;
}

export interface RendererThemeAudit {
  readonly theme: string;
  readonly passed: boolean;
  readonly checks: readonly RendererThemeContrastCheck[];
  readonly failures: readonly RendererThemeContrastCheck[];
}

export interface CreateRendererThemeOptions {
  readonly name: string;
  readonly mode?: RendererThemeMode;
  readonly base?: RendererTheme;
  readonly palette?: Partial<RendererThemePalette>;
  readonly styles?: Readonly<Record<string, RendererThemeStyle>>;
}

const DEFAULT_DARK_PALETTE: RendererThemePalette = {
  surface: '#101214',
  surfaceRaised: '#191d21',
  surfaceMuted: '#242a30',
  surfaceInverse: '#f4f7fb',
  text: '#e6edf3',
  textMuted: '#9aa7b4',
  textSubtle: '#687582',
  textInverse: '#111418',
  accent: '#62a8ff',
  accentMuted: '#28435f',
  success: '#6bdc8b',
  warning: '#ffd166',
  danger: '#ff6b7a',
  info: '#7dd3fc',
  border: '#56697a',
  borderFocus: '#8fc7ff',
  selection: '#214d77',
  shadow: '#060708',
};

const DEFAULT_LIGHT_PALETTE: RendererThemePalette = {
  surface: '#f8fafc',
  surfaceRaised: '#ffffff',
  surfaceMuted: '#e5ebf1',
  surfaceInverse: '#15181c',
  text: '#17202a',
  textMuted: '#52606d',
  textSubtle: '#75818e',
  textInverse: '#f8fafc',
  accent: '#0f6fd6',
  accentMuted: '#d7e9ff',
  success: '#147d3f',
  warning: '#9a6400',
  danger: '#bd2538',
  info: '#0369a1',
  border: '#83909f',
  borderFocus: '#0f6fd6',
  selection: '#cfe4ff',
  shadow: '#c9d3dd',
};

const DEFAULT_STYLE_MAP = {
  body: { fg: 'text', bg: 'surface' },
  muted: { fg: 'textMuted' },
  subtle: { fg: 'textSubtle' },
  inverse: { fg: 'textInverse', bg: 'surfaceInverse' },
  accent: { fg: 'accent', bold: true },
  success: { fg: 'success', bold: true },
  warning: { fg: 'warning', bold: true },
  danger: { fg: 'danger', bold: true },
  info: { fg: 'info' },
  border: { fg: 'border' },
  focus: { fg: 'borderFocus', bold: true },
  panel: { fg: 'text', bg: 'surface' },
  panelRaised: { fg: 'text', bg: 'surfaceRaised' },
  selection: { fg: 'text', bg: 'selection' },
} satisfies Record<RendererThemeStyleToken, RendererThemeStyle>;

export const rendererDarkTheme: RendererTheme = createRendererTheme({
  name: 'renderer-dark',
  mode: 'dark',
  palette: DEFAULT_DARK_PALETTE,
  styles: DEFAULT_STYLE_MAP,
});

export const rendererLightTheme: RendererTheme = createRendererTheme({
  name: 'renderer-light',
  mode: 'light',
  palette: DEFAULT_LIGHT_PALETTE,
  styles: DEFAULT_STYLE_MAP,
});

export function createRendererTheme(options: CreateRendererThemeOptions): RendererTheme {
  const base = options.base;
  const mode = options.mode ?? base?.mode ?? 'dark';
  const paletteBase = base?.palette ?? (mode === 'light' ? DEFAULT_LIGHT_PALETTE : DEFAULT_DARK_PALETTE);
  const styleBase = base?.styles ?? DEFAULT_STYLE_MAP;
  return {
    name: options.name,
    mode,
    palette: normalizePalette({ ...paletteBase, ...options.palette }),
    styles: { ...styleBase, ...options.styles } as RendererThemeStyleMap,
  };
}

export function resolveRendererThemeColor(
  theme: RendererTheme,
  color: RendererThemeColorReference | undefined,
): string | undefined {
  if (color === undefined) return undefined;
  if (isRendererThemeColorToken(color)) return theme.palette[color];
  return normalizeHexColor(color);
}

export function isRendererThemeColorToken(value: string): value is RendererThemeColorToken {
  return (RENDERER_THEME_COLOR_TOKENS as readonly string[]).includes(value);
}

export function resolveRendererThemeStyle(
  theme: RendererTheme,
  style: RendererThemeStyle | undefined,
): RendererCellStyle | undefined {
  if (style === undefined) return undefined;
  const resolved: RendererCellStyle = {
    fg: resolveRendererThemeColor(theme, style.fg),
    bg: resolveRendererThemeColor(theme, style.bg),
    bold: style.bold,
    dim: style.dim,
    italic: style.italic,
    underline: style.underline,
    inverse: style.inverse,
  };
  return normalizeCellStyle(resolved);
}

export function rendererThemeStyle(
  theme: RendererTheme,
  token: string,
  overrides?: RendererThemeStyle,
): RendererCellStyle | undefined {
  const style = mergeRendererThemeStyles(theme.styles[token], overrides);
  return resolveRendererThemeStyle(theme, style);
}

export function themedCell(
  theme: RendererTheme,
  char: string,
  token: string = 'body',
  overrides?: RendererThemeStyle,
): RendererCell {
  const style = rendererThemeStyle(theme, token, overrides);
  return style === undefined ? { char } : { char, style };
}

export function mergeRendererThemeStyles(
  base: RendererThemeStyle | undefined,
  overrides: RendererThemeStyle | undefined,
): RendererThemeStyle | undefined {
  if (base === undefined) return overrides;
  if (overrides === undefined) return base;
  return {
    fg: overrides.fg ?? base.fg,
    bg: overrides.bg ?? base.bg,
    bold: overrides.bold ?? base.bold,
    dim: overrides.dim ?? base.dim,
    italic: overrides.italic ?? base.italic,
    underline: overrides.underline ?? base.underline,
    inverse: overrides.inverse ?? base.inverse,
  };
}

export const DEFAULT_RENDERER_THEME_CONTRAST_CHECKS: readonly RendererThemeContrastCheckInput[] = [
  { id: 'body', foreground: 'text', background: 'surface', role: 'text' },
  { id: 'muted', foreground: 'textMuted', background: 'surface', role: 'text' },
  { id: 'inverse', foreground: 'textInverse', background: 'surfaceInverse', role: 'text' },
  { id: 'accent', foreground: 'accent', background: 'surface', role: 'text' },
  { id: 'success', foreground: 'success', background: 'surface', role: 'text' },
  { id: 'warning', foreground: 'warning', background: 'surface', role: 'text' },
  { id: 'danger', foreground: 'danger', background: 'surface', role: 'text' },
  { id: 'info', foreground: 'info', background: 'surface', role: 'text' },
  { id: 'selection-text', foreground: 'text', background: 'selection', role: 'text' },
  { id: 'panel', foreground: 'text', background: 'surfaceRaised', role: 'text' },
  { id: 'border', foreground: 'border', background: 'surface', role: 'ui' },
  { id: 'focus-border', foreground: 'borderFocus', background: 'surface', role: 'ui' },
];

export function auditRendererTheme(
  theme: RendererTheme,
  options: RendererThemeAuditOptions = {},
): RendererThemeAudit {
  const checks = (options.checks ?? DEFAULT_RENDERER_THEME_CONTRAST_CHECKS).map((check) =>
    runRendererThemeContrastCheck(theme, check, options),
  );
  const failures = checks.filter((check) => !check.passed);
  return {
    theme: theme.name,
    passed: failures.length === 0,
    checks,
    failures,
  };
}

export function rendererContrastRatio(foreground: string, background: string): number {
  const fg = parseRendererThemeRgb(foreground);
  const bg = parseRendererThemeRgb(background);
  if (fg === undefined || bg === undefined) return 0;
  const fgLuminance = relativeLuminance(fg);
  const bgLuminance = relativeLuminance(bg);
  return (Math.max(fgLuminance, bgLuminance) + 0.05) /
    (Math.min(fgLuminance, bgLuminance) + 0.05);
}

function normalizePalette(palette: RendererThemePalette): RendererThemePalette {
  const normalized = {} as Record<RendererThemeColorToken, string>;
  for (const token of RENDERER_THEME_COLOR_TOKENS) {
    normalized[token] = normalizeHexColor(palette[token]) ?? DEFAULT_DARK_PALETTE[token];
  }
  return normalized;
}

function runRendererThemeContrastCheck(
  theme: RendererTheme,
  check: RendererThemeContrastCheckInput,
  options: RendererThemeAuditOptions,
): RendererThemeContrastCheck {
  const role = check.role ?? 'text';
  const foreground = resolveRendererThemeColor(theme, check.foreground) ?? '';
  const background = resolveRendererThemeColor(theme, check.background) ?? '';
  const ratio = rendererContrastRatio(foreground, background);
  const minRatio = check.minRatio ??
    (role === 'text' ? options.textRatio ?? 4.5 : options.uiRatio ?? 3);
  return {
    id: check.id,
    foreground,
    background,
    role,
    ratio,
    minRatio,
    passed: ratio >= minRatio,
  };
}

function parseRendererThemeRgb(
  color: string,
): { readonly r: number; readonly g: number; readonly b: number } | undefined {
  const normalized = normalizeHexColor(color);
  if (normalized === undefined) return undefined;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16) / 255,
    g: Number.parseInt(normalized.slice(3, 5), 16) / 255,
    b: Number.parseInt(normalized.slice(5, 7), 16) / 255,
  };
}

function relativeLuminance(color: {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}): number {
  return 0.2126 * linearizeSrgb(color.r) +
    0.7152 * linearizeSrgb(color.g) +
    0.0722 * linearizeSrgb(color.b);
}

function linearizeSrgb(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function normalizeHexColor(value: string): string | undefined {
  const hex = value.startsWith('#') ? value.slice(1) : value;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex
      .split('')
      .map((char) => char + char)
      .join('')
      .toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  return undefined;
}

function normalizeCellStyle(style: RendererCellStyle): RendererCellStyle | undefined {
  const normalized: RendererCellStyle = {
    fg: style.fg,
    bg: style.bg,
    bold: style.bold === true ? true : undefined,
    dim: style.dim === true ? true : undefined,
    italic: style.italic === true ? true : undefined,
    underline: style.underline === true ? true : undefined,
    inverse: style.inverse === true ? true : undefined,
  };
  if (
    normalized.fg === undefined &&
    normalized.bg === undefined &&
    normalized.bold === undefined &&
    normalized.dim === undefined &&
    normalized.italic === undefined &&
    normalized.underline === undefined &&
    normalized.inverse === undefined
  ) {
    return undefined;
  }
  return normalized;
}
