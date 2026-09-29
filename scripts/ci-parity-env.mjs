/**
 * CI-parity environment for test runners.
 *
 * A dev shell carries state a GitHub runner never has, and every variable
 * below has produced a "green locally, red in CI" failure. Colour and TERM
 * silently disable TUI motion; a local timezone hides UTC clock assertions;
 * `init.defaultBranch=main` hides bare-repo HEAD assumptions; provider keys
 * let network paths pass that CI cannot reach; and proxy variables leak into
 * egress assertions, which is how the settings-panel proxy tests turned red
 * for every developer behind a corporate proxy while CI stayed green.
 *
 * Kept in its own module because more than one script spawns vitest. A runner
 * that inlines its own list silently reintroduces whatever the shared list
 * already fixed.
 */

const DELETE_ENV = [
  'NO_COLOR',
  'FORCE_COLOR',
  'TERM',
  'COLORTERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'KITTY_WINDOW_ID',
  'WEZTERM_PANE',
  'GHOSTTY_RESOURCES_DIR',
  'ALACRITTY_WINDOW_ID',
  'WT_SESSION',
  'WT_PROFILE_ID',
  'TMUX',
  'ZELLIJ',
  'SSH_TTY',
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
];

/** Credentials and host agent state a runner never has. */
const DELETE_ENV_PREFIX = ['KIMI_', 'SUPERLIORA_', 'MOONSHOT_', 'ANTHROPIC_', 'OPENAI_', 'XAI_', 'GEMINI_', 'CURSOR_'];
const DELETE_ENV_MATCH = /API_KEY|_TOKEN|SECRET/;

const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';

export const CI_PARITY_SET_ENV = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  TZ: 'UTC',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  // Ubuntu git defaults; keeps `git init` HEAD and identity assumptions honest.
  GIT_CONFIG_GLOBAL: nullDevice,
  GIT_CONFIG_SYSTEM: nullDevice,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'init.defaultBranch',
  GIT_CONFIG_VALUE_0: 'master',
};

/** `process.env` with the shell state a CI runner does not have removed. */
export function ciParityEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (DELETE_ENV.includes(key)) delete env[key];
    else if (DELETE_ENV_PREFIX.some((p) => key.startsWith(p))) delete env[key];
    else if (DELETE_ENV_MATCH.test(key)) delete env[key];
  }
  return { ...env, ...CI_PARITY_SET_ENV };
}

/** Keys `ciParityEnv` removes — for `--env` reporting. */
export const ciParityUnsetKeys = DELETE_ENV;
