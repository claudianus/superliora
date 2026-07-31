/**
 * Network / Proxy settings glance — HTTPS_PROXY tips (SSOT §9.2).
 */

export interface NetworkGlanceInput {
  readonly httpProxy?: string;
  readonly httpsProxy?: string;
  readonly allProxy?: string;
  readonly noProxy?: string;
  readonly socksConfigured: boolean;
  readonly proxyActive: boolean;
}

function firstNonBlank(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

const SOCKS_SCHEMES = new Set(['socks', 'socks4', 'socks4a', 'socks5', 'socks5h']);

function schemeOf(value: string): string | undefined {
  return /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
}

function isSocksUrl(value: string | undefined): boolean {
  return value !== undefined && SOCKS_SCHEMES.has(schemeOf(value) ?? '');
}

export function loadNetworkGlance(env: NodeJS.ProcessEnv = process.env): NetworkGlanceInput {
  const httpProxy = firstNonBlank(env, ['http_proxy', 'HTTP_PROXY']);
  const httpsProxy = firstNonBlank(env, ['https_proxy', 'HTTPS_PROXY']);
  const allProxy = firstNonBlank(env, ['all_proxy', 'ALL_PROXY']);
  const noProxy = firstNonBlank(env, ['no_proxy', 'NO_PROXY']);
  const socksConfigured = isSocksUrl(allProxy) || isSocksUrl(httpProxy) || isSocksUrl(httpsProxy);
  const proxyActive =
    (httpProxy !== undefined && !isSocksUrl(httpProxy)) ||
    (httpsProxy !== undefined && !isSocksUrl(httpsProxy)) ||
    (allProxy !== undefined && !isSocksUrl(allProxy)) ||
    socksConfigured;

  return { httpProxy, httpsProxy, allProxy, noProxy, socksConfigured, proxyActive };
}

function formatEnvLine(name: string, value: string | undefined, unsetHint?: string): string {
  if (value !== undefined) return `${name}=${value}`;
  return unsetHint !== undefined ? `${name}: unset — ${unsetHint}` : `${name}: unset`;
}

export function buildNetworkSettingsLines(input: NetworkGlanceInput): readonly string[] {
  const statusLine = input.proxyActive
    ? 'Outbound proxy: ACTIVE (installed at CLI startup via global dispatcher).'
    : 'Outbound proxy: not configured — direct connections.';

  const httpLine = formatEnvLine('HTTP_PROXY', input.httpProxy);
  const httpsLine = formatEnvLine(
    'HTTPS_PROXY',
    input.httpsProxy,
    input.httpProxy !== undefined ? 'falls back to HTTP_PROXY for TLS egress' : 'set before launching liora for TLS egress',
  );
  const noLine = formatEnvLine(
    'NO_PROXY',
    input.noProxy,
    'localhost/127.0.0.1/::1 bypass added automatically',
  );
  const allLine = formatEnvLine('ALL_PROXY', input.allProxy);

  const socksLine = input.socksConfigured
    ? 'SOCKS proxy detected — MCP stdio + local loopback stay direct.'
    : 'SOCKS: none detected.';

  return [
    '── Network / Proxy (read-only) ───────────────',
    'Egress posture — Sovereign Reform §9.2.',
    '',
    '── Status ───────────────────────────────────',
    statusLine,
    socksLine,
    '',
    '── Process env (live) ───────────────────────',
    httpLine,
    httpsLine,
    noLine,
    allLine,
    '',
    '── Tips ─────────────────────────────────────',
    '· Set HTTP_PROXY / HTTPS_PROXY / ALL_PROXY before `liora` starts',
    '· NO_PROXY=* disables proxy for all hosts (advanced)',
    '· Invalid proxy URLs are reported and ignored (startup continues)',
    '· Security → sandbox egress complements proxy (kaos profiles)',
    '',
    '── Related ──────────────────────────────────',
    '· MCP servers on localhost should bypass proxy automatically',
    '· Server mode: `liora server run --log-level` for daemon egress logs',
    '',
    'No proxy editor here — export env vars in shell profile or launchd.',
  ];
}
