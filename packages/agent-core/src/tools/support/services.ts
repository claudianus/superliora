import type { BrowserUseRuntime, ComputerUseRuntime } from '@superliora/gui-use';
import type { UrlFetcher, WebSearchProvider } from '../builtin';

export interface ToolServices {
  readonly urlFetcher?: UrlFetcher;
  readonly webSearcher?: WebSearchProvider;
  readonly browserUse?: BrowserUseRuntime;
  readonly computerUse?: ComputerUseRuntime;
}
