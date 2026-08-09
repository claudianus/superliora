// ── Qwen Token Plan harness tools ─────────────────────────────────────
// Official server-side built-in tools (Responses API) that qwen3.7/3.8
// models invoke automatically. The Chat Completions API cannot carry
// these tool entries; web search is enabled via `enable_search` instead.

const QWEN_TOKEN_PLAN_URL_MARKER = 'token-plan';
const QWEN_TOKEN_PLAN_DOMAIN = 'maas.aliyuncs.com';

export function isQwenTokenPlanEndpoint(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined) return false;
  return baseUrl.includes(QWEN_TOKEN_PLAN_URL_MARKER) && baseUrl.includes(QWEN_TOKEN_PLAN_DOMAIN);
}

const QWEN_HARNESS_TOOL_IDS = {
  webSearch: 'web_search',
  codeInterpreter: 'code_interpreter',
  webExtractor: 'web_extractor',
  reverseImageSearch: 'i2i_search',
  textToImageSearch: 't2i_search',
} as const;

const QWEN_ALL_HARNESS_TOOLS: readonly string[] = [
  QWEN_HARNESS_TOOL_IDS.webSearch,
  QWEN_HARNESS_TOOL_IDS.codeInterpreter,
  QWEN_HARNESS_TOOL_IDS.webExtractor,
  QWEN_HARNESS_TOOL_IDS.reverseImageSearch,
  QWEN_HARNESS_TOOL_IDS.textToImageSearch,
];

const QWEN_CORE_HARNESS_TOOLS: readonly string[] = [
  QWEN_HARNESS_TOOL_IDS.webSearch,
  QWEN_HARNESS_TOOL_IDS.codeInterpreter,
  QWEN_HARNESS_TOOL_IDS.webExtractor,
];

export function qwenHarnessToolsForModel(model: string): readonly string[] {
  const normalized = model.toLowerCase();
  // qwen3.8* and qwen3.7-plus support all harness tools.
  if (normalized.includes('qwen3.8') || normalized.includes('qwen3.7-plus')) {
    return QWEN_ALL_HARNESS_TOOLS;
  }
  // qwen3.7-max supports core tools only.
  if (normalized.includes('qwen3.7')) {
    return QWEN_CORE_HARNESS_TOOLS;
  }
  // Other models (e.g. deepseek-v4-pro) do not support harness tools.
  return [];
}
