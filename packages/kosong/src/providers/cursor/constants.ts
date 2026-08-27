/** Provider identifier advertised on Cursor MCP tool defs (`mcp_superliora_*`). */
export const CURSOR_PROVIDER_ID = 'superliora';

/** Auth / AvailableModels / GetServerConfig host. Not valid for AgentService/Run. */
export const CURSOR_API_BASE_URL = 'https://api2.cursor.sh';

/**
 * Last-resort Run host when GetServerConfig does not return a region URL.
 * Cursor CLI resolves a region-specific `agentn.*` origin; this global is only
 * a fallback, never the first choice, and never `api2.cursor.sh`.
 */
export const CURSOR_AGENT_FALLBACK_URL = 'https://agentn.global.api5.cursor.sh';

/** Pinned `x-cursor-client-version` when no local cursor-agent install is found. */
export const CURSOR_CLIENT_VERSION_DEFAULT = 'cli-2026.08.25-3e8eec8';

export const CURSOR_RUN_PATH = '/agent.v1.AgentService/Run';
export const CURSOR_USABLE_MODELS_PATH = '/agent.v1.AgentService/GetUsableModels';
export const CURSOR_SERVER_CONFIG_PATH = '/aiserver.v1.ServerConfigService/GetServerConfig';
export const CURSOR_AVAILABLE_MODELS_PATH = '/aiserver.v1.AiService/AvailableModels';
