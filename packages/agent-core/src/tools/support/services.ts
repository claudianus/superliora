import type { BrowserUseRuntime, ComputerUseRuntime } from '@superliora/gui-use';
import type { UrlFetcher } from '../builtin/web/fetch-url';
import type { WebSearchProvider } from '../builtin/web/web-search';
import type { CodexExtrasOptions } from '../providers/codex-extras';
import type { Context7Provider } from '../providers/context7';
import type { ResearchSearchEngine } from '../providers/research-search';
import type { XaiGrokBuildClient } from '../providers/xai-grok-build';

export interface ToolServices {
  readonly urlFetcher?: UrlFetcher;
  readonly webSearcher?: WebSearchProvider;
  /** Multi-provider search engine when built; powers the /status Extras cascade. */
  readonly researchSearch?: ResearchSearchEngine;
  readonly context7?: Context7Provider;
  readonly browserUse?: BrowserUseRuntime;
  readonly computerUse?: ComputerUseRuntime;
  /** xAI Grok Build client (subscription OAuth or XAI_API_KEY). */
  readonly xaiGrokBuild?: XaiGrokBuildClient;
  /**
   * Alibaba Token Plan (Qwen Cloud) API key resolved from a configured
   * Token Plan provider or its dedicated env vars. Lets the image/video
   * generation tools work without a standalone environment variable.
   */
  readonly qwenTokenPlanApiKey?: string;
  /**
   * Token Plan chat base URL from the configured provider (or env override).
   * Media tools derive the regional multimodal / video host from this.
   */
  readonly qwenTokenPlanBaseUrl?: string;
  /**
   * OpenAI Codex (ChatGPT subscription) extras credentials: powers the
   * engine's codex search slot and the GenerateImage codex backend with
   * the OAuth session token — no extra API key required.
   */
  readonly codex?: CodexExtrasOptions;
}
