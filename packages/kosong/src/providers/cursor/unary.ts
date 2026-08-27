/**
 * HTTP/2 Connect JSON / proto unary calls against Cursor API hosts.
 */

import http2 from 'node:http2';

import { unwrapConnectPayload } from './connect';

const DEFAULT_TIMEOUT_MS = 8_000;

export interface CursorUnaryOptions {
  readonly baseUrl: string;
  readonly path: string;
  readonly token: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly body?: Uint8Array;
  readonly contentType?: string;
}

export async function cursorHttp2Unary(options: CursorUnaryOptions): Promise<{
  readonly status: number | undefined;
  readonly body: Uint8Array;
}> {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const url = new URL(baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const payload = options.body ?? new Uint8Array(0);

  return new Promise((resolve, reject) => {
    const session = http2.connect(baseUrl);
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`Cursor unary ${options.path} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const finish = (error?: Error, value?: { status: number | undefined; body: Uint8Array }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      try {
        session.close();
      } catch {
        // ignore
      }
      if (error !== undefined) reject(error);
      else if (value !== undefined) resolve(value);
      else reject(new Error(`Cursor unary ${options.path} returned no body`));
    };

    const onAbort = (): void => {
      finish(new Error(`Cursor unary ${options.path} aborted`));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    session.once('error', (error) => finish(error));
    session.once('connect', () => {
      const req = session.request({
        ':method': 'POST',
        ':path': options.path,
        ':authority': url.host,
        ':scheme': 'https',
        authorization: `Bearer ${options.token}`,
        'content-type': options.contentType ?? 'application/json',
        'content-length': payload.length,
        ...options.headers,
      });
      const chunks: Buffer[] = [];
      let status: number | undefined;
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on('error', (error) => finish(error));
      req.on('response', (headers) => {
        const code = headers[':status'];
        status = typeof code === 'number' ? code : undefined;
      });
      req.on('end', () => {
        finish(undefined, { status, body: new Uint8Array(Buffer.concat(chunks)) });
      });
      if (payload.length > 0) req.end(Buffer.from(payload));
      else req.end();
    });
  });
}

export function decodeCursorJsonBody(body: Uint8Array): unknown {
  const unwrapped = unwrapConnectPayload(body);
  const text = Buffer.from(unwrapped).toString('utf8').trim();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const buf = Buffer.from(text, 'utf8');
    if (buf.length >= 5) {
      const inner = unwrapConnectPayload(new Uint8Array(buf));
      if (inner !== unwrapped) {
        const retry = Buffer.from(inner).toString('utf8').trim();
        if (retry.length > 0) return JSON.parse(retry) as unknown;
      }
    }
    throw new Error('Cursor unary response was not JSON');
  }
}
