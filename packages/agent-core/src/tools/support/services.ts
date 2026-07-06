import type { BrowserUseRuntime, ComputerUseRuntime } from '@superliora/gui-use';
import type { UrlFetcher, WebSearchProvider } from '../builtin';
import type { Context7Provider } from '../providers/context7';

export interface ToolServices {
  readonly urlFetcher?: UrlFetcher;
  readonly webSearcher?: WebSearchProvider;
  readonly context7?: Context7Provider;
  readonly browserUse?: BrowserUseRuntime;
  readonly computerUse?: ComputerUseRuntime;
}
