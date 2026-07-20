/**
 * `/term` diagnostics — explain what the TUI detected about the host terminal.
 *
 * Collection and formatting are pure functions over an env snapshot. The
 * detectors live in `@harness-kit/tui-renderer`; the signal lists re-read the
 * same env vars to approximate each detector's decision path so users can see
 * *why* a capability is on or off. Detection itself is never modified.
 */

import {
  detectNativeTerminalCapabilities,
  detectNativeTerminalColorMode,
  detectNativeTerminalImageProtocol,
  type RendererColorMode,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';

export interface TerminalDiagnosticsReport {
  readonly terminal: {
    readonly term: string;
    readonly program: string;
    readonly multiplexer: 'tmux' | 'zellij' | 'screen' | null;
  };
  readonly colorMode: RendererColorMode;
  /** Human-readable reasons behind `colorMode`, e.g. `COLORTERM=truecolor`. */
  readonly colorSignals: readonly string[];
  readonly imageProtocol: 'kitty' | 'iterm2' | 'none';
  /** Human-readable reasons behind `imageProtocol`, e.g. `KITTY_WINDOW_ID set`. */
  readonly imageSignals: readonly string[];
  readonly features: readonly { readonly name: string; readonly enabled: boolean }[];
}

/** Label column sized for the longest feature label (`synchronized output`). */
const LABEL_WIDTH = 19;

const KNOWN_TRUECOLOR_TERMS = ['alacritty', 'kitty', 'wezterm', 'ghostty', 'rio'] as const;
const KNOWN_TRUECOLOR_PROGRAMS = [
  'alacritty',
  'kitty',
  'wezterm',
  'ghostty',
  'rio',
  'iterm',
  'vscode',
] as const;

export function collectTerminalDiagnostics(
  env: NodeJS.ProcessEnv,
): TerminalDiagnosticsReport {
  const capabilities = detectNativeTerminalCapabilities(env);
  const colorMode = detectNativeTerminalColorMode(env);
  const imageProtocol = detectNativeTerminalImageProtocol(env);
  const multiplexer = detectMultiplexer(env);

  return {
    terminal: {
      term: env['TERM'] ?? '',
      program: env['TERM_PROGRAM'] ?? '',
      multiplexer,
    },
    colorMode,
    colorSignals: collectColorSignals(env, colorMode),
    imageProtocol,
    imageSignals: collectImageSignals(env, multiplexer),
    features: [
      { name: 'keyboard protocol', enabled: capabilities.keyboardProtocol },
      { name: 'mouse tracking', enabled: capabilities.mouseTracking },
      { name: 'bracketed paste', enabled: capabilities.bracketedPaste },
      { name: 'focus events', enabled: capabilities.focusEvents },
      { name: 'synchronized output', enabled: capabilities.synchronized },
      { name: 'interactive', enabled: capabilities.interactive },
    ],
  };
}

export function formatTerminalDiagnosticsLines(report: TerminalDiagnosticsReport): string[] {
  const t = currentTheme;
  const row = (label: string, value: string): string =>
    `${t.dimFg('textMuted', label.padEnd(LABEL_WIDTH))} ${value}`;
  const mutedNote = (text: string): string =>
    text.length > 0 ? ` ${t.dimFg('textMuted', text)}` : '';
  const valueToken = (value: string, isNone: boolean): string =>
    isNone ? t.dimFg('textMuted', value) : t.boldFg('primary', value);

  const lines: string[] = [];

  const { term, program, multiplexer } = report.terminal;
  const details: string[] = [];
  if (term.length > 0) details.push(`TERM=${term}`);
  if (program.length > 0) details.push(`TERM_PROGRAM=${program}`);
  const terminalValue =
    term.length > 0 ? t.boldFg('primary', term) : t.dimFg('textMuted', '—');
  lines.push(row('terminal', terminalValue + mutedNote(details.length > 0 ? `(${details.join(' · ')})` : '')));

  let muxValue: string;
  if (multiplexer === null) {
    muxValue = t.dimFg('textMuted', '—');
  } else {
    const muxNote =
      multiplexer === 'tmux'
        ? '— image passthrough requires allow-passthrough'
        : multiplexer === 'zellij'
          ? '— image passthrough unavailable'
          : '';
    muxValue = t.boldFg('warning', multiplexer) + mutedNote(muxNote);
  }
  lines.push(row('multiplexer', muxValue));

  const colorNote =
    report.colorSignals.length > 0 ? `(${report.colorSignals.join(', ')})` : '';
  lines.push(
    row('colors', valueToken(report.colorMode, report.colorMode === 'none') + mutedNote(colorNote)),
  );

  const imageNote =
    report.imageSignals.length > 0 ? `(${report.imageSignals.join(', ')})` : '';
  lines.push(
    row(
      'images',
      valueToken(report.imageProtocol, report.imageProtocol === 'none') + mutedNote(imageNote),
    ),
  );

  for (const feature of report.features) {
    const state = feature.enabled
      ? t.fg('success', 'on')
      : t.dimFg('textMuted', 'off');
    lines.push(row(feature.name, state));
  }

  return lines;
}

function detectMultiplexer(env: NodeJS.ProcessEnv): 'tmux' | 'zellij' | 'screen' | null {
  if (hasEnv(env, 'TMUX')) return 'tmux';
  if (hasEnv(env, 'ZELLIJ')) return 'zellij';
  if (lowerEnv(env, 'TERM').startsWith('screen')) return 'screen';
  return null;
}

/** Approximate the decision path of `detectNativeTerminalColorMode`. */
function collectColorSignals(env: NodeJS.ProcessEnv, colorMode: RendererColorMode): string[] {
  const signals: string[] = [];
  const forceColor = lowerEnv(env, 'FORCE_COLOR');
  const colorForced =
    (forceColor.length > 0 && forceColor !== '0') || truthyEnv(env, 'CLICOLOR_FORCE');

  if (colorForced) {
    signals.push(
      forceColor.length > 0 && forceColor !== '0'
        ? `FORCE_COLOR=${env['FORCE_COLOR']}`
        : `CLICOLOR_FORCE=${env['CLICOLOR_FORCE']}`,
    );
    if (hasEnv(env, 'NO_COLOR')) signals.push('NO_COLOR set (ignored — color forced)');
    return signals;
  }

  if (hasEnv(env, 'NO_COLOR')) signals.push('NO_COLOR set');
  if (lowerEnv(env, 'CLICOLOR') === '0') signals.push('CLICOLOR=0');
  if (truthyEnv(env, 'CI')) signals.push('CI set');
  if (colorMode === 'none') {
    if (lowerEnv(env, 'TERM') === 'dumb') signals.push('TERM=dumb');
    return signals;
  }

  const colorTerm = lowerEnv(env, 'COLORTERM');
  if (colorTerm === 'truecolor' || colorTerm === '24bit') {
    signals.push(`COLORTERM=${env['COLORTERM']}`);
    return signals;
  }

  const term = lowerEnv(env, 'TERM');
  const program = lowerEnv(env, 'TERM_PROGRAM');
  if (colorMode === 'truecolor') {
    const termMatch = KNOWN_TRUECOLOR_TERMS.find((token) => term.includes(token));
    const programMatch = KNOWN_TRUECOLOR_PROGRAMS.find((token) => program.includes(token));
    if (termMatch !== undefined) signals.push(`TERM contains '${termMatch}'`);
    else if (programMatch !== undefined) signals.push(`TERM_PROGRAM contains '${programMatch}'`);
    else if (hasEnv(env, 'KITTY_WINDOW_ID')) signals.push('KITTY_WINDOW_ID set');
    else if (hasEnv(env, 'WEZTERM_PANE')) signals.push('WEZTERM_PANE set');
    else if (hasEnv(env, 'GHOSTTY_RESOURCES_DIR')) signals.push('GHOSTTY_RESOURCES_DIR set');
    else if (hasEnv(env, 'ALACRITTY_WINDOW_ID')) signals.push('ALACRITTY_WINDOW_ID set');
    return signals;
  }

  if (term.includes('256color')) signals.push("TERM contains '256color'");
  else if (term.includes('-256')) signals.push("TERM contains '-256'");
  return signals;
}

/** Approximate the decision path of `detectNativeTerminalImageProtocol`. */
function collectImageSignals(
  env: NodeJS.ProcessEnv,
  multiplexer: 'tmux' | 'zellij' | 'screen' | null,
): string[] {
  const signals: string[] = [];
  const term = lowerEnv(env, 'TERM');
  const program = lowerEnv(env, 'TERM_PROGRAM');

  if (term === 'dumb') signals.push('TERM=dumb');
  if (truthyEnv(env, 'CI')) signals.push('CI set');
  if (term === 'dumb' || truthyEnv(env, 'CI')) return signals;

  let matched: string | null = null;
  if (hasEnv(env, 'KITTY_WINDOW_ID')) matched = 'KITTY_WINDOW_ID set';
  else if (term.includes('kitty')) matched = "TERM contains 'kitty'";
  else if (term.includes('ghostty')) matched = "TERM contains 'ghostty'";
  else if (term.includes('rio')) matched = "TERM contains 'rio'";
  else if (program.includes('ghostty')) matched = "TERM_PROGRAM contains 'ghostty'";
  else if (program.includes('rio')) matched = "TERM_PROGRAM contains 'rio'";
  else if (hasEnv(env, 'GHOSTTY_RESOURCES_DIR')) matched = 'GHOSTTY_RESOURCES_DIR set';
  else if (program.includes('iterm')) matched = "TERM_PROGRAM contains 'iterm'";
  else if (program.includes('wezterm')) matched = "TERM_PROGRAM contains 'wezterm'";
  else if (hasEnv(env, 'WEZTERM_PANE')) matched = 'WEZTERM_PANE set';

  if (matched !== null) {
    signals.push(matched);
    if (multiplexer === 'tmux' || multiplexer === 'zellij') {
      signals.push(`${multiplexer} passthrough off`);
    }
  }
  return signals;
}

function hasEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name];
  return value !== undefined && value.length > 0;
}

function lowerEnv(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.toLowerCase() ?? '';
}

function truthyEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = lowerEnv(env, name);
  return value === '1' || value === 'true' || value === 'yes';
}
