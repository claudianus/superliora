import type { WebSearchResult } from '../builtin/web/web-search';

export interface BrowserSearchChannel {
  search(query: string, limit: number): Promise<WebSearchResult[]>;
  available(): boolean;
}

export class UnavailableBrowserSearchChannel implements BrowserSearchChannel {
  available(): boolean {
    return false;
  }

  async search(_query: string, _limit: number): Promise<WebSearchResult[]> {
    return [];
  }
}

export class HintBrowserSearchChannel implements BrowserSearchChannel {
  private escalateAttemptedFlag = false;

  constructor(private readonly ready = true) {}

  available(): boolean {
    return this.ready;
  }

  async search(_query: string, _limit: number): Promise<WebSearchResult[]> {
    this.escalateAttemptedFlag = true;
    return [];
  }

  get escalateAttempted(): boolean {
    return this.escalateAttemptedFlag;
  }
}
