import { ErrorCodes } from '@superliora/sdk';

export const PRODUCT_NAME = 'SuperLiora';
export const CLI_COMMAND_NAME = 'liora';
export const PROCESS_NAME = 'liora';

// Used in telemetry app names and HTTP User-Agent headers.
export const CLI_USER_AGENT_PRODUCT = 'liora-cli';
export const CLI_UI_MODE = 'shell';
// Telemetry ui_mode for the `liora server run` host. Same product
// as the CLI (CLI_USER_AGENT_PRODUCT); the surface is distinguished by ui_mode.
export const SERVER_UI_MODE = 'server';

// Give telemetry a short flush window without making CLI exit feel stuck.
export const CLI_SHUTDOWN_TIMEOUT_MS = 3000;
export const PROMPT_CLEANUP_TIMEOUT_MS = 8000;
export const HEADLESS_FORCE_EXIT_GRACE_MS = 2000;
export const HEADLESS_STDIO_DRAIN_TIMEOUT_MS = 10000;

// Published npm package name; this can differ from the executable command.
export const NPM_PACKAGE_NAME = '@superliora/liora';

// App-owned data paths. SDK/core runtime config is intentionally not routed here.
export const SUPERLIORA_HOME_ENV = 'SUPERLIORA_HOME';
export const SUPERLIORA_DATA_DIR_NAME = '.superliora';
export const SUPERLIORA_LOG_DIR_NAME = 'logs';
export const SUPERLIORA_CACHE_DIR_NAME = 'cache';
export const SUPERLIORA_UPDATE_DIR_NAME = 'updates';
export const SUPERLIORA_BIN_DIR_NAME = 'bin';
export const SUPERLIORA_UPDATE_STATE_FILE_NAME = 'latest.json';
export const SUPERLIORA_UPDATE_INSTALL_STATE_FILE_NAME = 'install.json';
export const SUPERLIORA_UPDATE_INSTALL_LOCK_FILE_NAME = 'install.lock';
export const SUPERLIORA_UPDATE_ROLLOUT_LOG_FILE_NAME = 'rollout.log';
export const SUPERLIORA_INPUT_HISTORY_DIR_NAME = 'user-history';
export const SUPERLIORA_BANNER_DIR_NAME = 'banner';
export const SUPERLIORA_BANNER_STATE_FILE_NAME = 'state.json';

// Managed Kimi auth provider key shared with OAuth/SDK config.
export const DEFAULT_OAUTH_PROVIDER_NAME = 'managed:kimi-api';

// SDK/core error code that tells the TUI to show a login-required startup
// notice. Derived from sdk's ErrorCodes so a future rename in core
// auto-propagates instead of silently breaking the startup recovery path.
export const OAUTH_LOGIN_REQUIRED_CODE = ErrorCodes.AUTH_LOGIN_REQUIRED;

// SuperLiora is installed from this repo's GitHub source; update/plugin/tips
// manifests are served from the same place, not a third-party CDN.
export const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/claudianus/superliora/main';
export const SUPERLIORA_CDN_LATEST_URL = `${GITHUB_RAW_BASE}/latest`;
// Rollout manifest consumed by update checks; the plain-text `/latest` above
// stays unchanged forever — already-shipped clients hard-fail on non-semver
// bodies, and the CDN install scripts read it for fresh installs.
export const SUPERLIORA_CDN_LATEST_JSON_URL = `${GITHUB_RAW_BASE}/latest.json`;
export const SUPERLIORA_TIPS_BANNER_URL = `${GITHUB_RAW_BASE}/liora-tips/tips.json`;
export const SUPERLIORA_PLUGIN_MARKETPLACE_URL = `${GITHUB_RAW_BASE}/plugins/marketplace.json`;
export const SUPERLIORA_PLUGIN_MARKETPLACE_URL_ENV = 'SUPERLIORA_PLUGIN_MARKETPLACE_URL';

export const SUPERLIORA_INSTALL_SH_URL = `${GITHUB_RAW_BASE}/install.sh`;
export const SUPERLIORA_INSTALL_PS1_URL = `${GITHUB_RAW_BASE}/install.ps1`;

// Native install commands, split by platform. Use these for prompt copy and spawn calls only; do not assemble the strings elsewhere.
export const NATIVE_INSTALL_COMMAND_UNIX = `curl -fsSL ${SUPERLIORA_INSTALL_SH_URL} | bash`;
export const NATIVE_INSTALL_COMMAND_WIN = `irm ${SUPERLIORA_INSTALL_PS1_URL} | iex`;
