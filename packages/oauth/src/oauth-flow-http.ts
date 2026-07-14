/**
 * Shared HTTP + PKCE helpers for the non-Kimi OAuth flows (OpenAI Codex,
 * xAI Grok). The Kimi flow reuses the device-code wrappers in `oauth.ts`;
 * these helpers cover the pieces those flows need that the Kimi path does
 * not: JSON POSTs, PKCE verifier/challenge generation, OIDC discovery, and a
 * loopback callback server for browser-based authorization-code exchange.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { OAuthConnectionError, OAuthError } from './errors';
import { isRecord } from './utils';

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

export interface PostJsonOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

/** POSTs a JSON body and returns `{ status, data }`. Throws on transport errors. */
export async function postJson(
  url: string,
  body: unknown,
  options: PostJsonOptions = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (options.signal !== undefined) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw new OAuthConnectionError(
      `OAuth request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { status: response.status, data: await parseJsonObject(response, url) };
}

export interface PostFormOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

/** POSTs a form-encoded body and returns `{ status, data }`. */
export async function postForm(
  url: string,
  params: Record<string, string>,
  options: PostFormOptions = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (options.signal !== undefined) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...options.headers,
      },
      body: new URLSearchParams(params).toString(),
      signal,
    });
  } catch (error) {
    throw new OAuthConnectionError(
      `OAuth request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { status: response.status, data: await parseJsonObject(response, url) };
}

async function parseJsonObject(
  response: Response,
  url: string,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    if (isRecord(parsed)) return parsed;
  } catch {
    // Non-JSON body — return empty object; caller interprets by status.
  }
  if (response.status >= 400) {
    throw new OAuthError(`OAuth request to ${url} failed (HTTP ${response.status}).`);
  }
  return {};
}

/** GETs a JSON document (used for OIDC discovery). */
export async function getJson<T = Record<string, unknown>>(
  url: string,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (options.signal !== undefined) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  } catch (error) {
    throw new OAuthConnectionError(
      `GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new OAuthError(`GET ${url} failed (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

// ── PKCE ──────────────────────────────────────────────────────────────

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: 'S256';
}

/** Generates a PKCE verifier (43+ chars) and its S256 challenge. */
export function generatePkcePair(): PkcePair {
  // 48 base64url chars → 64 bytes of entropy, well above the 43-char minimum.
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

export function base64url(input: Buffer | Uint8Array): string {
  const buffer = input instanceof Buffer ? input : Buffer.from(input);
  const base64 = buffer.toString('base64');
  // base64url: swap URL-unsafe chars and strip trailing padding.
  let result = base64.replaceAll('+', '-').replaceAll('/', '_');
  while (result.endsWith('=')) {
    result = result.slice(0, -1);
  }
  return result;
}

export function generateState(): string {
  return base64url(randomBytes(32));
}

export function generateNonce(): string {
  return randomUUID().replaceAll('-', '');
}

// ── Loopback callback server ──────────────────────────────────────────

export interface CallbackResult {
  readonly code: string;
  readonly state: string;
}

export interface CallbackServer {
  readonly redirectUri: string;
  /** Resolves with the authorization code, or rejects on error/timeout. */
  readonly waitForCallback: (signal?: AbortSignal) => Promise<CallbackResult>;
  /**
   * Resolves a pending {@link waitForCallback} with a manually provided
   * authorization code / callback URL. Used when the browser cannot reach the
   * loopback server (remote SSH, blocked port, etc.) and the user pastes the
   * callback into the CLI instead.
   */
  readonly submitManualCallback: (result: CallbackResult) => void;
  /** Stops the HTTP server. */
  readonly close: () => Promise<void>;
}

/**
 * Starts a loopback HTTP server that receives the OAuth authorization-code
 * callback. The server responds to the browser with a simple success page and
 * resolves {@link CallbackServer.waitForCallback} with `code` + `state`.
 *
 * The server always binds to `127.0.0.1`, but the `redirectHost` controls the
 * host that appears in the `redirect_uri` sent to the provider. Providers
 * match redirect URIs by exact string, so `localhost` and `127.0.0.1` are not
 * interchangeable — xAI registers `127.0.0.1`, while others register
 * `localhost`.
 */
export async function startCallbackServer(
  preferredPort: number,
  redirectHost: string = 'localhost',
): Promise<CallbackServer> {
  const server: Server = createServer((req, res) => {
    if (req.url === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    const url = new URL(req.url, `http://localhost`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (code !== null && state !== null) {
      pendingResolve?.({ code, state });
      pendingResolve = undefined;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SUCCESS_PAGE);
    } else if (error !== null) {
      pendingReject?.(new OAuthError(`Authorization error: ${error}`));
      pendingResolve = undefined;
      pendingReject = undefined;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ERROR_PAGE);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const port = await listenOnPort(server, preferredPort);
  let pendingResolve: ((result: CallbackResult) => void) | undefined;
  let pendingReject: ((error: Error) => void) | undefined;

  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
  });

  return {
    redirectUri: `http://${redirectHost}:${String(port)}/callback`,
    submitManualCallback: (result) => {
      if (pendingResolve === undefined) return;
      const resolve = pendingResolve;
      pendingResolve = undefined;
      pendingReject = undefined;
      resolve(result);
    },
    waitForCallback: (signal) => {
      if (signal?.aborted === true) {
        return Promise.reject(new OAuthError('Authorization aborted'));
      }
      signal?.addEventListener('abort', () => {
        pendingReject?.(new OAuthError('Authorization aborted'));
        pendingResolve = undefined;
        pendingReject = undefined;
      });
      return callbackPromise;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function listenOnPort(server: Server, preferredPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(preferredPort, '127.0.0.1', () => {
      const address = server.address();
      server.removeListener('error', reject);
      if (typeof address === 'object' && address !== null) {
        resolve(address.port);
      } else {
        reject(new OAuthError('Failed to start callback server.'));
      }
    });
  });
}

/**
 * Parses a user-pasted OAuth callback value into `{ code, state }`.
 *
 * Accepts:
 * - a full callback URL (`http://127.0.0.1:56121/callback?code=...&state=...`)
 * - a query string (`code=...&state=...`)
 * - a bare authorization code (uses `expectedState` when provided)
 */
export function parseOAuthCallbackInput(
  raw: string,
  expectedState?: string,
): CallbackResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new OAuthError('Pasted OAuth callback is empty.');
  }

  const fromParams = (params: URLSearchParams): CallbackResult | undefined => {
    const code = params.get('code');
    if (code === null || code.length === 0) return undefined;
    const state = params.get('state') ?? expectedState;
    if (state === undefined || state.length === 0) {
      throw new OAuthError(
        'Pasted OAuth callback is missing state. Paste the full callback URL.',
      );
    }
    if (expectedState !== undefined && state !== expectedState) {
      throw new OAuthError('Pasted OAuth callback state does not match this login attempt.');
    }
    const error = params.get('error');
    if (error !== null && error.length > 0) {
      throw new OAuthError(`Authorization error: ${error}`);
    }
    return { code, state };
  };

  // Full URL (or anything URL-parseable that carries a query string).
  try {
    const asUrl = new URL(trimmed);
    const parsed = fromParams(asUrl.searchParams);
    if (parsed !== undefined) return parsed;
  } catch (error) {
    // Preserve structured OAuth errors from fromParams; only fall through when
    // the value simply is not a URL.
    if (error instanceof OAuthError) throw error;
  }

  // Query string / fragment style: "code=...&state=..." or leading "?".
  if (trimmed.includes('code=')) {
    const query = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed;
    const parsed = fromParams(new URLSearchParams(query));
    if (parsed !== undefined) return parsed;
  }

  // Bare authorization code. Requires the expected state from the local flow.
  // Keep this strict so free-form invalid pastes re-prompt instead of being
  // treated as a code: no whitespace / query markers, and a minimum length.
  if (
    expectedState !== undefined &&
    expectedState.length > 0 &&
    trimmed.length >= 12 &&
    !/\s/.test(trimmed) &&
    !/[?&=]/.test(trimmed)
  ) {
    return { code: trimmed, state: expectedState };
  }

  throw new OAuthError(
    'Could not parse pasted OAuth callback. Paste the full callback URL or the authorization code.',
  );
}

export interface ManualCallbackPromptContext {
  readonly signal: AbortSignal;
  /** Previous paste error message, when re-prompting after invalid input. */
  readonly lastError?: string;
}

export interface WaitForCallbackOrManualOptions {
  readonly signal?: AbortSignal;
  /** State generated for this login attempt; used to accept bare code pastes. */
  readonly expectedState?: string;
  /**
   * Optional prompt that lets the user paste a callback URL/code when the
   * loopback redirect cannot reach this process. Return the pasted text, or
   * `undefined` to keep waiting on the loopback server only.
   *
   * When the loopback callback wins first, `context.signal` is aborted so the
   * prompt can dismiss itself.
   */
  readonly onManualCallbackPrompt?: (
    context: ManualCallbackPromptContext,
  ) => Promise<string | undefined>;
}

/**
 * Waits for either the loopback OAuth callback or a manually pasted callback
 * value. The first successful source wins; a cancelled/empty manual prompt
 * does not abort the loopback wait.
 */
export async function waitForCallbackOrManual(
  server: CallbackServer,
  options: WaitForCallbackOrManualOptions = {},
): Promise<CallbackResult> {
  if (options.onManualCallbackPrompt === undefined) {
    return server.waitForCallback(options.signal);
  }

  const local = new AbortController();
  const onOuterAbort = (): void => {
    local.abort();
  };
  options.signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    return await new Promise<CallbackResult>((resolve, reject) => {
      let settled = false;
      const settleResolve = (result: CallbackResult): void => {
        if (settled) return;
        settled = true;
        local.abort();
        resolve(result);
      };
      const settleReject = (error: unknown): void => {
        if (settled) return;
        settled = true;
        local.abort();
        reject(error instanceof Error ? error : new OAuthError(String(error)));
      };

      void server.waitForCallback(options.signal).then(settleResolve, settleReject);

      void (async () => {
        let lastError: string | undefined;
        while (!settled && !local.signal.aborted) {
          let pasted: string | undefined;
          try {
            pasted = await options.onManualCallbackPrompt?.({
              signal: local.signal,
              lastError,
            });
          } catch (error) {
            if (local.signal.aborted || options.signal?.aborted === true) {
              settleReject(
                options.signal?.aborted === true || local.signal.aborted
                  ? new OAuthError('Authorization aborted')
                  : error,
              );
              return;
            }
            lastError = error instanceof Error ? error.message : String(error);
            continue;
          }
          if (settled || local.signal.aborted) return;
          if (pasted === undefined) {
            // User skipped/cancelled the prompt — keep waiting on loopback only.
            return;
          }
          try {
            const parsed = parseOAuthCallbackInput(pasted, options.expectedState);
            server.submitManualCallback(parsed);
            settleResolve(parsed);
            return;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }
      })();
    });
  } finally {
    options.signal?.removeEventListener('abort', onOuterAbort);
    local.abort();
  }
}

const SUCCESS_PAGE =
  '<!DOCTYPE html><html><body><h2>Authorization complete.</h2><p>You can close this tab and return to the terminal.</p></body></html>';
const ERROR_PAGE =
  '<!DOCTYPE html><html><body><h2>Authorization failed.</h2><p>Close this tab and try again.</p></body></html>';

// ── Generic PKCE authorization-code flow ──────────────────────────────

export interface GenericPkceFlowConfig {
  readonly clientId: string;
  readonly scope?: string;
  readonly callbackPort?: number;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly redirectPath?: string;
}

export interface GenericPkceToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scope: string;
  readonly tokenType: string;
}

/**
 * Runs a standard OAuth 2.0 PKCE authorization-code flow with a loopback
 * callback. Used by providers (Anthropic, xAI) that follow the same shape but
 * may not expose OIDC discovery. The caller opens the returned authorize URL.
 */
export async function runPkceBrowserFlow(
  config: GenericPkceFlowConfig,
  options: {
    readonly onAuthorizeUrl?: (url: string) => Promise<void> | void;
    readonly onManualCallbackPrompt?: (
      context: ManualCallbackPromptContext,
    ) => Promise<string | undefined>;
    readonly signal?: AbortSignal;
  } = {},
): Promise<GenericPkceToken> {
  const pkce = generatePkcePair();
  const state = generateState();
  const nonce = generateNonce();
  const port = config.callbackPort ?? 0;
  const server = await startCallbackServer(port);
  try {
    const redirectUri = config.redirectPath
      ? `http://localhost:${getPort(server.redirectUri)}${config.redirectPath}`
      : server.redirectUri;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scope ?? 'openid profile email offline_access',
      code_challenge: pkce.challenge,
      code_challenge_method: pkce.method,
      state,
      nonce,
    });
    const authorizeUrl = `${config.authorizeUrl}?${params.toString()}`;
    await options.onAuthorizeUrl?.(authorizeUrl);
    const { code } = await waitForCallbackOrManual(server, {
      signal: options.signal,
      expectedState: state,
      onManualCallbackPrompt: options.onManualCallbackPrompt,
    });
    const { status, data } = await postForm(
      config.tokenUrl,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        code_verifier: pkce.verifier,
      },
      { signal: options.signal },
    );
    if (status !== 200 || typeof data['access_token'] !== 'string') {
      throw new OAuthError(`PKCE token exchange failed (HTTP ${status}).`);
    }
    return extractPkceToken(data);
  } finally {
    await server.close();
  }
}

/** Refreshes an access token via a standard OAuth 2.0 refresh_token grant. */
export async function refreshPkceToken(
  config: GenericPkceFlowConfig,
  refreshToken: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<GenericPkceToken> {
  const { status, data } = await postForm(
    config.tokenUrl,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
    },
    { signal: options.signal },
  );
  if (status !== 200 || typeof data['access_token'] !== 'string') {
    throw new OAuthError(`PKCE token refresh failed (HTTP ${status}).`);
  }
  return extractPkceToken(data);
}

function extractPkceToken(data: Record<string, unknown>): GenericPkceToken {
  const accessToken = data['access_token'];
  const refreshToken = data['refresh_token'];
  const expiresIn = Number(data['expires_in']);
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new OAuthError('PKCE token response missing access_token or refresh_token.');
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new OAuthError('PKCE token response has invalid expires_in.');
  }
  return {
    accessToken,
    refreshToken,
    expiresIn,
    scope: typeof data['scope'] === 'string' ? data['scope'] : '',
    tokenType: typeof data['token_type'] === 'string' ? data['token_type'] : 'Bearer',
  };
}

function getPort(redirectUri: string): number {
  const match = redirectUri.match(/:(\d+)\//);
  return match !== null ? Number(match[1]) : 0;
}
