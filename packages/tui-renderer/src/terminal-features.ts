import type { RendererColorMode, RendererTerminalOutputOptions } from './terminal-output';
import type { RendererInlineImageProtocol } from './terminal-graphics';
import type {
  NativeTerminalKeyboardProtocol,
  NativeTerminalMouseTracking,
  NativeTerminalScreenMode,
} from './terminal-session';

export type NativeTerminalFeatureProfile = 'minimal' | 'inline-app' | 'fullscreen-app';

export interface NativeTerminalEnvironment {
  readonly [name: string]: string | undefined;
}

export interface NativeTerminalFeatureOptions extends RendererTerminalOutputOptions {
  readonly screenMode?: NativeTerminalScreenMode;
  readonly keyboardProtocol?: NativeTerminalKeyboardProtocol;
  readonly mouseTracking?: NativeTerminalMouseTracking;
  readonly rawMode?: boolean;
  readonly bracketedPaste?: boolean;
  readonly focusEvents?: boolean;
  readonly clearOnStart?: boolean;
  readonly imageProtocol?: RendererInlineImageProtocol;
}

export type NativeTerminalFeatureInput =
  | NativeTerminalFeatureProfile
  | NativeTerminalFeatureOptions
  | undefined;

export interface NativeTerminalCapabilities {
  readonly interactive: boolean;
  readonly keyboardProtocol: boolean;
  readonly mouseTracking: boolean;
  readonly bracketedPaste: boolean;
  readonly focusEvents: boolean;
  readonly synchronized: boolean;
  readonly colorMode: RendererColorMode;
  readonly imageProtocol: RendererInlineImageProtocol;
}

export type NativeTerminalDecModeState =
  | 'not-recognized'
  | 'set'
  | 'reset'
  | 'permanently-set'
  | 'permanently-reset';

export type NativeTerminalSynchronizedOutputSupport =
  | 'supported'
  | 'unsupported'
  | 'unknown';

export interface NativeTerminalDecModeReport {
  readonly raw: string;
  readonly privateMode: boolean;
  readonly mode: number;
  readonly stateCode: 0 | 1 | 2 | 3 | 4;
  readonly state: NativeTerminalDecModeState;
  readonly supported: boolean | undefined;
}

export const NATIVE_TERMINAL_SYNCHRONIZED_OUTPUT_MODE = 2026;
export const ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT = '\u001B[?2026$p';

const MINIMAL_FEATURES: NativeTerminalFeatureOptions = {};

const INLINE_APP_FEATURES: NativeTerminalFeatureOptions = {
  rawMode: true,
  bracketedPaste: true,
  focusEvents: true,
  keyboardProtocol: 'kitty',
  mouseTracking: 'sgr',
  synchronized: true,
  hideCursor: true,
  showCursor: true,
};

const FULLSCREEN_APP_FEATURES: NativeTerminalFeatureOptions = {
  ...INLINE_APP_FEATURES,
  screenMode: 'alternate',
  clearOnStart: true,
};

export function nativeTerminalFeatureProfile(
  profile: NativeTerminalFeatureProfile,
): NativeTerminalFeatureOptions {
  switch (profile) {
    case 'minimal':
      return { ...MINIMAL_FEATURES };
    case 'inline-app':
      return { ...INLINE_APP_FEATURES };
    case 'fullscreen-app':
      return { ...FULLSCREEN_APP_FEATURES };
  }
}

export function detectNativeTerminalCapabilities(
  environment: NativeTerminalEnvironment = {},
): NativeTerminalCapabilities {
  const term = lowerEnv(environment, 'TERM');
  const termProgram = lowerEnv(environment, 'TERM_PROGRAM');
  const synchronizedOverride = firstEnvBoolean(environment, [
    'HARNESS_TUI_SYNCHRONIZED_OUTPUT',
    'TUI_RENDERER_SYNCHRONIZED_OUTPUT',
  ]);
  const colorMode = detectNativeTerminalColorMode(environment);
  const imageProtocol = detectNativeTerminalImageProtocol(environment);
  const interactive =
    term !== 'dumb' &&
    !truthyEnv(environment, 'CI');
  const knownModernTerminal =
    term.includes('kitty') ||
    term.includes('wezterm') ||
    term.includes('ghostty') ||
    term.includes('rio') ||
    term.includes('foot') ||
    termProgram.includes('kitty') ||
    termProgram.includes('wezterm') ||
    termProgram.includes('ghostty') ||
    termProgram.includes('rio') ||
    termProgram.includes('iterm') ||
    hasEnv(environment, 'KITTY_WINDOW_ID') ||
    hasEnv(environment, 'WEZTERM_PANE') ||
    hasEnv(environment, 'GHOSTTY_RESOURCES_DIR') ||
    hasEnv(environment, 'ALACRITTY_WINDOW_ID');
  const inMultiplexer = hasEnv(environment, 'TMUX') || term.startsWith('screen');
  const xtermLike =
    term.includes('xterm') ||
    term.includes('vt') ||
    term.includes('screen') ||
    term.includes('tmux') ||
    term.includes('rxvt');
  const knownBrokenSynchronizedOutput =
    termProgram === 'waveterm' ||
    truthyEnv(environment, 'WAVETERM');

  return {
    interactive,
    keyboardProtocol: interactive && knownModernTerminal && !inMultiplexer,
    mouseTracking: interactive && (knownModernTerminal || xtermLike),
    bracketedPaste: interactive && (knownModernTerminal || xtermLike),
    focusEvents: interactive && (knownModernTerminal || xtermLike),
    synchronized:
      synchronizedOverride ??
      (interactive && !knownBrokenSynchronizedOutput && (knownModernTerminal || xtermLike)),
    colorMode,
    imageProtocol,
  };
}

export function detectNativeTerminalImageProtocol(
  environment: NativeTerminalEnvironment = {},
): RendererInlineImageProtocol {
  const term = lowerEnv(environment, 'TERM');
  const termProgram = lowerEnv(environment, 'TERM_PROGRAM');
  if (term === 'dumb' || truthyEnv(environment, 'CI')) return 'none';

  const inMultiplexer = hasEnv(environment, 'TMUX') || hasEnv(environment, 'ZELLIJ');
  if (hasEnv(environment, 'KITTY_WINDOW_ID') || term.includes('kitty')) {
    return inMultiplexer ? 'none' : 'kitty';
  }
  if (
    term.includes('ghostty') ||
    term.includes('rio') ||
    termProgram.includes('ghostty') ||
    termProgram.includes('rio') ||
    hasEnv(environment, 'GHOSTTY_RESOURCES_DIR')
  ) {
    return inMultiplexer ? 'none' : 'kitty';
  }
  if (
    termProgram.includes('iterm') ||
    termProgram.includes('wezterm') ||
    hasEnv(environment, 'WEZTERM_PANE')
  ) {
    return inMultiplexer ? 'none' : 'iterm2';
  }
  return 'none';
}

export function detectNativeTerminalColorMode(
  environment: NativeTerminalEnvironment = {},
): RendererColorMode {
  const term = lowerEnv(environment, 'TERM');
  const termProgram = lowerEnv(environment, 'TERM_PROGRAM');
  const colorTerm = lowerEnv(environment, 'COLORTERM');
  const forceColor = lowerEnv(environment, 'FORCE_COLOR');
  const colorForced =
    (forceColor.length > 0 && forceColor !== '0') ||
    truthyEnv(environment, 'CLICOLOR_FORCE');
  if (!colorForced && (hasEnv(environment, 'NO_COLOR') || lowerEnv(environment, 'CLICOLOR') === '0')) {
    return 'none';
  }
  if (!colorForced && truthyEnv(environment, 'CI')) return 'none';
  if (forceColor === '3') return 'truecolor';
  if (forceColor === '2') return 'ansi256';
  if (forceColor === '1') return 'ansi16';
  if (colorTerm === 'truecolor' || colorTerm === '24bit') return 'truecolor';
  if (term === 'dumb') return colorForced ? 'ansi16' : 'none';

  const knownTrueColorTerminal =
    term.includes('alacritty') ||
    term.includes('kitty') ||
    term.includes('wezterm') ||
    term.includes('ghostty') ||
    term.includes('rio') ||
    termProgram.includes('alacritty') ||
    termProgram.includes('kitty') ||
    termProgram.includes('wezterm') ||
    termProgram.includes('ghostty') ||
    termProgram.includes('rio') ||
    termProgram.includes('iterm') ||
    termProgram.includes('vscode') ||
    hasEnv(environment, 'KITTY_WINDOW_ID') ||
    hasEnv(environment, 'WEZTERM_PANE') ||
    hasEnv(environment, 'GHOSTTY_RESOURCES_DIR') ||
    hasEnv(environment, 'ALACRITTY_WINDOW_ID');
  if (knownTrueColorTerminal) return 'truecolor';
  if (term.includes('256color') || term.includes('-256')) return 'ansi256';
  return colorForced ? 'ansi16' : 'ansi16';
}

export function parseNativeTerminalDecModeReport(
  input: string | Buffer,
): NativeTerminalDecModeReport | undefined {
  return parseNativeTerminalDecModeReports(input)[0];
}

export function parseNativeTerminalDecModeReports(
  input: string | Buffer,
): readonly NativeTerminalDecModeReport[] {
  const text = typeof input === 'string' ? input : input.toString('utf8');
  return Array.from(text.matchAll(/(?:\u001B\[|\u009B)(\??)(\d+);([0-4])\$y/g))
    .map((match) => {
      const stateCode = Number(match[3]) as 0 | 1 | 2 | 3 | 4;
      return {
        raw: match[0],
        privateMode: match[1] === '?',
        mode: Number(match[2]),
        stateCode,
        state: nativeTerminalDecModeState(stateCode),
        supported: nativeTerminalDecModeStateSupported(stateCode),
      };
    });
}

export function resolveNativeSynchronizedOutputSupport(
  report: NativeTerminalDecModeReport | undefined,
): NativeTerminalSynchronizedOutputSupport {
  if (
    report === undefined ||
    !report.privateMode ||
    report.mode !== NATIVE_TERMINAL_SYNCHRONIZED_OUTPUT_MODE
  ) {
    return 'unknown';
  }
  if (report.state === 'set' || report.state === 'reset') return 'supported';
  if (report.state === 'not-recognized' || report.state === 'permanently-reset') {
    return 'unsupported';
  }
  return 'unknown';
}

export function parseNativeSynchronizedOutputSupport(
  input: string | Buffer,
): NativeTerminalSynchronizedOutputSupport {
  const reports = parseNativeTerminalDecModeReports(input);
  const report = reports.find((candidate) =>
    candidate.privateMode &&
    candidate.mode === NATIVE_TERMINAL_SYNCHRONIZED_OUTPUT_MODE
  );
  return resolveNativeSynchronizedOutputSupport(report);
}

export function nativeTerminalAdaptiveFeatureProfile(
  profile: 'inline-app' | 'fullscreen-app',
  environment: NativeTerminalEnvironment = {},
): NativeTerminalFeatureOptions {
  const base = nativeTerminalFeatureProfile(profile);
  const capabilities = detectNativeTerminalCapabilities(environment);
  const features: NativeTerminalFeatureOptions = {
    ...base,
    screenMode: capabilities.interactive ? base.screenMode : undefined,
    rawMode: capabilities.interactive ? base.rawMode : undefined,
    bracketedPaste: capabilities.bracketedPaste ? base.bracketedPaste : undefined,
    focusEvents: capabilities.focusEvents ? base.focusEvents : undefined,
    clearOnStart: capabilities.interactive ? base.clearOnStart : undefined,
    keyboardProtocol: capabilities.keyboardProtocol ? base.keyboardProtocol : undefined,
    mouseTracking: capabilities.mouseTracking ? base.mouseTracking : undefined,
    synchronized: capabilities.synchronized ? base.synchronized : undefined,
    hideCursor: capabilities.interactive ? base.hideCursor : undefined,
    showCursor: capabilities.interactive ? base.showCursor : undefined,
    colorMode: capabilities.colorMode,
    imageProtocol: capabilities.imageProtocol,
  };
  return features;
}

export function resolveNativeTerminalFeatures(
  features: NativeTerminalFeatureInput,
): NativeTerminalFeatureOptions {
  if (features === undefined) return {};
  if (typeof features === 'string') return nativeTerminalFeatureProfile(features);
  return { ...features };
}

export function mergeNativeTerminalFeatureOptions<T extends NativeTerminalFeatureOptions>(
  features: NativeTerminalFeatureInput,
  options: T,
): T & NativeTerminalFeatureOptions {
  const resolved = resolveNativeTerminalFeatures(features);
  return {
    ...options,
    screenMode: options.screenMode ?? resolved.screenMode,
    keyboardProtocol: options.keyboardProtocol ?? resolved.keyboardProtocol,
    mouseTracking: options.mouseTracking ?? resolved.mouseTracking,
    rawMode: options.rawMode ?? resolved.rawMode,
    bracketedPaste: options.bracketedPaste ?? resolved.bracketedPaste,
    focusEvents: options.focusEvents ?? resolved.focusEvents,
    clearOnStart: options.clearOnStart ?? resolved.clearOnStart,
    synchronized: options.synchronized ?? resolved.synchronized,
    hideCursor: options.hideCursor ?? resolved.hideCursor,
    showCursor: options.showCursor ?? resolved.showCursor,
    resetStyle: options.resetStyle ?? resolved.resetStyle,
    originX: options.originX ?? resolved.originX,
    originY: options.originY ?? resolved.originY,
    eraseLine: options.eraseLine ?? resolved.eraseLine,
    frameWidth: options.frameWidth ?? resolved.frameWidth,
    colorMode: options.colorMode ?? resolved.colorMode,
    imageProtocol: options.imageProtocol ?? resolved.imageProtocol,
  };
}

function hasEnv(environment: NativeTerminalEnvironment, name: string): boolean {
  const value = environment[name];
  return value !== undefined && value.length > 0;
}

function lowerEnv(environment: NativeTerminalEnvironment, name: string): string {
  return environment[name]?.toLowerCase() ?? '';
}

function truthyEnv(environment: NativeTerminalEnvironment, name: string): boolean {
  const value = lowerEnv(environment, name);
  return value === '1' || value === 'true' || value === 'yes';
}

function nativeTerminalDecModeState(code: 0 | 1 | 2 | 3 | 4): NativeTerminalDecModeState {
  switch (code) {
    case 0:
      return 'not-recognized';
    case 1:
      return 'set';
    case 2:
      return 'reset';
    case 3:
      return 'permanently-set';
    case 4:
      return 'permanently-reset';
  }
}

function nativeTerminalDecModeStateSupported(
  code: 0 | 1 | 2 | 3 | 4,
): boolean | undefined {
  if (code === 1 || code === 2) return true;
  if (code === 0 || code === 4) return false;
  return undefined;
}

function firstEnvBoolean(
  environment: NativeTerminalEnvironment,
  names: readonly string[],
): boolean | undefined {
  for (const name of names) {
    const parsed = envBoolean(environment, name);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function envBoolean(
  environment: NativeTerminalEnvironment,
  name: string,
): boolean | undefined {
  const value = lowerEnv(environment, name);
  if (value.length === 0) return undefined;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return undefined;
}
