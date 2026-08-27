/**
 * Identity headers shared by Cursor Connect RPCs (Run, GetServerConfig, models).
 *
 * Protocol headers always win over caller `customHeaders` so an OAuth profile
 * cannot silently flip `x-ghost-mode` or pin a stale client version on Run.
 */

import { cursorChecksumHeader } from './identity';
import { resolveCursorClientVersion } from './version';

const PROTOCOL_HEADER_KEYS = new Set([
  ':method',
  ':path',
  ':authority',
  ':scheme',
  'authorization',
  'content-type',
  'connect-protocol-version',
  'connect-accept-encoding',
  'te',
  'x-cursor-client-type',
  'x-cursor-client-version',
  'x-cursor-checksum',
  'x-ghost-mode',
  'x-cursor-streaming',
]);

export function buildCursorIdentityHeaders(
  clientVersion?: string,
  extra?: Readonly<Record<string, string>>,
): Record<string, string> {
  const version = resolveCursorClientVersion(clientVersion);
  const headers: Record<string, string> = {
    'connect-protocol-version': '1',
    'x-cursor-client-type': 'cli',
    'x-cursor-client-version': version,
    'x-cursor-checksum': cursorChecksumHeader(),
    'x-ghost-mode': 'true',
  };
  if (extra !== undefined) {
    for (const [key, value] of Object.entries(extra)) {
      if (PROTOCOL_HEADER_KEYS.has(key.toLowerCase())) continue;
      headers[key] = value;
    }
  }
  return headers;
}

/** Merge caller headers under protocol identity (protocol keys win). */
export function mergeCursorProtocolHeaders(
  protocol: Readonly<Record<string, string>>,
  extra?: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (extra !== undefined) {
    for (const [key, value] of Object.entries(extra)) {
      if (PROTOCOL_HEADER_KEYS.has(key.toLowerCase())) continue;
      out[key] = value;
    }
  }
  for (const [key, value] of Object.entries(protocol)) {
    out[key] = value;
  }
  return out;
}
