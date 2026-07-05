/**
 * Build the clickable/copyable access URLs for the running server.
 *
 * Shared by the `server run` ready banner and `server rotate-token` so both
 * show the same Local/Network API origins.
 */

import { formatHostForUrl, listNetworkAddresses, type NetworkAddress } from './networks';
import { t } from '#/cli/i18n';

export function buildServerOriginUrl(bareOrigin: string): string {
  const base = bareOrigin.endsWith('/') ? bareOrigin.slice(0, -1) : bareOrigin;
  return `${base}/`;
}

export interface AccessUrlLine {
  /** Fixed-width label including trailing padding, e.g. `"Local:    "`. */
  label: string;
  url: string;
}

function isWildcard(host: string): boolean {
  return host === '' || host === '0.0.0.0' || host === '::';
}

/** True when `host` is a loopback address (this host only). */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function hostOrigin(host: string, port: number): string {
  const family = host.includes(':') ? 'IPv6' : 'IPv4';
  return `http://${formatHostForUrl(host, family)}:${port}`;
}

/**
 * Compute the access-URL lines for a bind host/port.
 *
 * - wildcard (`0.0.0.0` / `::` / empty): a `Local:` line (localhost) plus one
 *   `Network:` line per non-loopback interface.
 * - loopback: a single `Local:` line.
 * - specific host: a single `URL:` line.
 */
export function accessUrlLines(
  host: string,
  port: number,
  networkAddresses?: NetworkAddress[],
): AccessUrlLine[] {
  if (isWildcard(host)) {
    const lines: AccessUrlLine[] = [
      {
        label: t('cli.runtime.server.labelLocal'),
        url: buildServerOriginUrl(`http://localhost:${port}`),
      },
    ];
    const addrs = networkAddresses ?? listNetworkAddresses();
    for (const addr of addrs) {
      lines.push({
        label: t('cli.runtime.server.labelNetwork'),
        url: buildServerOriginUrl(`http://${formatHostForUrl(addr.address, addr.family)}:${port}`),
      });
    }
    return lines;
  }
  if (isLoopbackHost(host)) {
    return [
      {
        label: t('cli.runtime.server.labelLocal'),
        url: buildServerOriginUrl(hostOrigin(host, port)),
      },
    ];
  }
  return [
    {
      label: t('cli.runtime.server.labelUrl'),
      url: buildServerOriginUrl(hostOrigin(host, port)),
    },
  ];
}
