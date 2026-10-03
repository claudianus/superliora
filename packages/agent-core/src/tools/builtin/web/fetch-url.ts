export type UrlFetchKind = 'passthrough' | 'extracted';

export interface UrlFetchResult {
  content: string;
  kind: UrlFetchKind;
}

export interface UrlFetchOptions {
  readonly toolCallId?: string;
  readonly signal?: AbortSignal;
}

export interface UrlFetcher {
  fetch(url: string, options?: UrlFetchOptions): Promise<UrlFetchResult>;
}

export class HttpFetchError extends Error {
  override readonly name = 'HttpFetchError';
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

