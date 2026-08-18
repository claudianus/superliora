#!/usr/bin/env node
// Interactive debug env — sibling of test-local.mjs, inverted for TUI/harness.
// test-local kills motion and strips keys so CI assertions hold.
// debug-local keeps the real terminal, turns analysis on, and never launches
// the installed SEA (`liora.exe`).
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEBUG_HOME_DIR_NAME = '.superliora-debug';
export const DEBUG_LOG_FILE_NAME = 'debug-local.ndjson';
export const FALLBACK_TERM = 'xterm-256color';

/** Shell leftovers that force TUI motion/color off. */
export const UNSET_ENV = ['CI', 'GITHUB_ACTIONS', 'NO_COLOR', 'FORCE_COLOR'];

export const SET_ENV = {
  SUPERLIORA_DEBUG: '1',
  SUPERLIORA_NO_AUTO_UPDATE: '1',
  SUPERLIORA_LOG_LEVEL: 'info',
  TZ: 'UTC',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
};

const KEY_PREFIXES = [
  'KIMI_',
  'SUPERLIORA_',
  'MOONSHOT_',
  'ANTHROPIC_',
  'OPENAI_',
  'XAI_',
  'GEMINI_',
  'CURSOR_',
];
const KEY_MATCH = /API_KEY|_TOKEN|SECRET/;
const KEEP_WHEN_STRIPPING = new Set([
  'SUPERLIORA_HOME',
  'SUPERLIORA_DEBUG',
  'SUPERLIORA_DEBUG_LOG',
  'SUPERLIORA_NO_AUTO_UPDATE',
  'SUPERLIORA_LOG_LEVEL',
  'SUPERLIORA_DEV_CWD',
  'SUPERLIORA_DEV_MARKETPLACE_URL',
  'SUPERLIORA_DEV_VERBOSE',
  'SUPERLIORA_PLUGIN_MARKETPLACE_URL',
  'SUPERLIORA_TUI_SCROLL_TRACE',
  'SUPERLIORA_TUI_STARTUP_TRACE',
  'SUPERLIORA_TUI_OUTPUT_TAP',
  'SUPERLIORA_NATIVE_RENDERER_DIAGNOSTICS',
]);

/**
 * @param {NodeJS.ProcessEnv} parentEnv
 * @param {{
 *   repoRoot: string
 *   homeMode?: 'isolated' | 'ephemeral' | 'real'
 *   stripKeys?: boolean
 *   isolatedHomeDir?: string
 *   ephemeralHomeDir?: string
 * }} options
 */
export function buildDebugEnv(parentEnv, options) {
  const homeMode = options.homeMode ?? 'isolated';
  const env = { ...parentEnv };

  for (const key of UNSET_ENV) delete env[key];

  if (options.stripKeys === true) {
    for (const key of Object.keys(env)) {
      if (KEEP_WHEN_STRIPPING.has(key)) continue;
      if (KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) || KEY_MATCH.test(key)) {
        delete env[key];
      }
    }
  }

  const parentTerm = parentEnv.TERM?.trim();
  const termUpgraded = parentTerm === undefined || parentTerm.length === 0 || parentTerm === 'dumb';
  env.TERM = termUpgraded ? FALLBACK_TERM : parentTerm;

  Object.assign(env, SET_ENV);

  const home = resolveDebugHome(parentEnv, { ...options, homeMode });
  env.SUPERLIORA_HOME = home;
  env.SUPERLIORA_DEBUG_LOG = join(home, 'logs', DEBUG_LOG_FILE_NAME);
  env.SUPERLIORA_TUI_STARTUP_TRACE = join(home, 'logs', 'startup-trace.log');

  return {
    env,
    home,
    debugLog: env.SUPERLIORA_DEBUG_LOG,
    termUpgraded,
    homeMode,
  };
}

function resolveDebugHome(parentEnv, options) {
  if (options.homeMode === 'real') {
    const existing = parentEnv.SUPERLIORA_HOME?.trim();
    if (existing !== undefined && existing.length > 0) return existing;
    return join(homedir(), '.superliora');
  }
  if (options.homeMode === 'ephemeral') {
    if (options.ephemeralHomeDir !== undefined) return options.ephemeralHomeDir;
    return join(tmpdir(), `superliora-debug-home-${String(Date.now())}`);
  }
  if (options.isolatedHomeDir !== undefined) return options.isolatedHomeDir;
  return join(options.repoRoot, DEBUG_HOME_DIR_NAME);
}

/** Lines for `--env` / self-check, same shape as test-local. */
export function formatDebugEnvReport(built) {
  const lines = [];
  for (const key of UNSET_ENV) {
    if (built.env[key] === undefined) lines.push(`${key} (unset)`);
  }
  for (const [key, value] of Object.entries(SET_ENV)) {
    lines.push(`${key}=${value}`);
  }
  lines.push(`TERM=${built.env.TERM}`);
  lines.push(`SUPERLIORA_HOME=${built.home}`);
  lines.push(`SUPERLIORA_DEBUG_LOG=${built.debugLog}`);
  lines.push(`SUPERLIORA_TUI_STARTUP_TRACE=${built.env.SUPERLIORA_TUI_STARTUP_TRACE}`);
  return lines;
}

/**
 * @param {(name: string, ok: boolean, detail?: string) => void} assert
 */
export function selfCheckDebugEnv(assert) {
  const repoRoot = '/tmp/superliora-repo';
  const isolated = buildDebugEnv(
    {
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      TERM: 'dumb',
      COLORTERM: 'truecolor',
      SSH_TTY: '/dev/pts/0',
      OPENAI_API_KEY: 'sk-test',
      SUPERLIORA_HOME: '/tmp/real-home',
    },
    { repoRoot },
  );
  assert('strips CI', isolated.env.CI === undefined);
  assert('strips GITHUB_ACTIONS', isolated.env.GITHUB_ACTIONS === undefined);
  assert('strips NO_COLOR', isolated.env.NO_COLOR === undefined);
  assert('strips FORCE_COLOR', isolated.env.FORCE_COLOR === undefined);
  assert('upgrades TERM=dumb', isolated.env.TERM === FALLBACK_TERM && isolated.termUpgraded);
  assert('keeps COLORTERM', isolated.env.COLORTERM === 'truecolor');
  assert('keeps SSH_TTY', isolated.env.SSH_TTY === '/dev/pts/0');
  assert('sets SUPERLIORA_DEBUG', isolated.env.SUPERLIORA_DEBUG === '1');
  assert('sets log level info', isolated.env.SUPERLIORA_LOG_LEVEL === 'info');
  assert(
    'isolates SUPERLIORA_HOME',
    isolated.home === join(repoRoot, DEBUG_HOME_DIR_NAME),
  );
  assert('keeps provider keys by default', isolated.env.OPENAI_API_KEY === 'sk-test');

  const keptTerm = buildDebugEnv({ TERM: 'wezterm' }, { repoRoot });
  assert('keeps a real TERM', keptTerm.env.TERM === 'wezterm' && keptTerm.termUpgraded === false);

  const stripped = buildDebugEnv(
    { OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'sk-ant' },
    { repoRoot, stripKeys: true },
  );
  assert('stripKeys drops OPENAI_API_KEY', stripped.env.OPENAI_API_KEY === undefined);
  assert('stripKeys drops ANTHROPIC_API_KEY', stripped.env.ANTHROPIC_API_KEY === undefined);

  const real = buildDebugEnv(
    { SUPERLIORA_HOME: '/tmp/operator-home' },
    { repoRoot, homeMode: 'real' },
  );
  assert('real home keeps SUPERLIORA_HOME', real.home === '/tmp/operator-home');

  const ephemeral = buildDebugEnv(
    {},
    { repoRoot, homeMode: 'ephemeral', ephemeralHomeDir: '/tmp/ephemeral-debug' },
  );
  assert('ephemeral home uses the provided dir', ephemeral.home === '/tmp/ephemeral-debug');
}
