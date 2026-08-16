/**
 * Closed-session wire.jsonl gzip helpers.
 *
 * Active agents append plain `wire.jsonl`. On close we compress to
 * `wire.jsonl.gz` and delete the plain file. Resume / vis open either form
 * without a wire-format break (same JSONL lines once decompressed).
 */
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { dirname, join } from 'pathe';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export const WIRE_JSONL = 'wire.jsonl';
export const WIRE_JSONL_GZ = 'wire.jsonl.gz';

export function wireJsonlPath(agentHomedir: string): string {
  return join(agentHomedir, WIRE_JSONL);
}

export function wireJsonlGzPath(agentHomedir: string): string {
  return join(agentHomedir, WIRE_JSONL_GZ);
}

/** Prefer plain wire; fall back to gzip companion. */
export async function resolveWirePath(agentHomedir: string): Promise<string | undefined> {
  const plain = wireJsonlPath(agentHomedir);
  if (existsSync(plain)) return plain;
  const gz = wireJsonlGzPath(agentHomedir);
  if (existsSync(gz)) return gz;
  return undefined;
}

export function isGzipWirePath(path: string): boolean {
  return path.endsWith('.gz');
}

/** Readable of UTF-8 JSONL lines (gunzip when needed). */
export function openWireReadStream(path: string): Readable {
  const raw = createReadStream(path);
  if (isGzipWirePath(path)) {
    return raw.pipe(createGunzip());
  }
  return raw;
}

/**
 * Compress plain wire.jsonl → wire.jsonl.gz and remove the plain file.
 * No-op when plain is missing. Safe if already gzipped.
 * Returns true when a new gzip file was written.
 */
export async function compressWireJsonl(agentHomedir: string): Promise<boolean> {
  const plain = wireJsonlPath(agentHomedir);
  const gz = wireJsonlGzPath(agentHomedir);
  if (!existsSync(plain)) return false;

  // Windows: refuse to gzip a file that looks exclusively locked (open FD).
  // open for write fails with EBUSY/EPERM when another process holds the file.
  let probe;
  try {
    probe = await open(plain, 'r+');
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      return false;
    }
    throw error;
  }
  await probe.close();

  const tmp = `${gz}.tmp`;
  try {
    await pipeline(createReadStream(plain), createGzip(), createWriteStream(tmp));
    await rename(tmp, gz);
    await rm(plain, { force: true });
    return true;
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function wireMtimeMs(agentHomedir: string): Promise<number | undefined> {
  const path = await resolveWirePath(agentHomedir);
  if (!path) return undefined;
  try {
    const info = await stat(path);
    return info.mtimeMs;
  } catch {
    return undefined;
  }
}

export function agentHomedirFromWirePath(wirePath: string): string {
  return dirname(wirePath);
}
