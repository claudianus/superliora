/**
 * File-based OAuth token storage.
 *
 * Tokens are persisted under a directory (default
 * `~/.superliora/credentials/`) as `<name>.json` with mode 0600 (parent
 * dir 0700). Wire format uses snake_case to match the server contract.
 *
 * Write semantics: write to `<name>.tmp.<pid>.<rand>` → fsync → rename.
 * Atomic on POSIX; Windows best-effort.
 *
 * Load semantics: missing file → undefined. Corrupt JSON / wrong shape →
 * undefined (never throws). Callers treat undefined as "no token stored".
 */

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import type { TokenInfo, TokenInfoWire } from './types';
import { tokenFromWire, tokenToWire } from './types';
import { isRecord } from './utils';

/**
 * On Windows, POSIX mode bits are ignored by Node — `chmodSync(0o600)` is a
 * no-op and credential files inherit the profile's default ACL, so any process
 * running as the user can read them. After writing a credential, restrict the
 * ACL to the current user via `icacls` (best-effort, once per process; a
 * failure never blocks the save).
 */
let windowsAclRestrictionFailed = false;

function restrictWindowsAclBestEffort(file: string): void {
  if (process.platform !== 'win32' || windowsAclRestrictionFailed) return;
  const result = spawnSync(
    'icacls',
    [file, '/inheritance:r', '/grant:r', `${process.env['USERNAME'] ?? 'CURRENT_USER'}:F`],
    { stdio: 'ignore', windowsHide: true },
  );
  if (result.error !== undefined || result.status !== 0) {
    windowsAclRestrictionFailed = true;
  }
}

export interface TokenStorage {
  load(name: string): Promise<TokenInfo | undefined>;
  save(name: string, token: TokenInfo): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

/** Default `~/.superliora/credentials` (honors `SUPERLIORA_HOME`). */
export function defaultOAuthCredentialsDir(): string {
  const override = process.env['SUPERLIORA_HOME'];
  const home =
    override !== undefined && override.trim().length > 0
      ? override.trim()
      : join(homedir(), '.superliora');
  return join(home, 'credentials');
}

/**
 * Sync peek: whether a usable access token is on disk for `storageName`.
 * Invalid names / missing / corrupt / empty access token → false (never throws).
 */
export function hasCachedOAuthTokenSync(
  storageName: string,
  options?: { readonly credentialsDir?: string },
): boolean {
  const dir = options?.credentialsDir ?? defaultOAuthCredentialsDir();
  return new FileTokenStorage(dir).hasTokenSync(storageName);
}

export class FileTokenStorage implements TokenStorage {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    // recursive=true with mode only applies on initial create; tighten after
    // the fact in case an existing dir had looser permissions.
    try {
      chmodSync(this.dir, 0o700);
    } catch {
      // best-effort; Windows / read-only FS may refuse
    }
  }

  private pathFor(name: string): string {
    // Guard against path traversal: caller-provided names (from config.toml
    // or slash commands) must not escape the credentials dir. `basename`
    // strips any `..` or `/` segments; if the sanitized value differs from
    // the input we refuse the request entirely rather than silently
    // writing to a different file than the caller asked for.
    const safe = basename(name);
    if (safe.length === 0 || safe !== name || safe.startsWith('.')) {
      throw new Error(`Invalid token name: "${name}"`);
    }
    return join(this.dir, `${safe}.json`);
  }

  /** Sync presence check used by smart-router availability gates (no refresh). */
  hasTokenSync(name: string): boolean {
    let file: string;
    try {
      file = this.pathFor(name);
    } catch {
      return false;
    }
    const token = this.readTokenFile(file);
    return typeof token?.accessToken === 'string' && token.accessToken.trim().length > 0;
  }

  async load(name: string): Promise<TokenInfo | undefined> {
    return this.readTokenFile(this.pathFor(name));
  }

  private readTokenFile(file: string): TokenInfo | undefined {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf-8');
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!isRecord(parsed)) return undefined;
    return tokenFromWire(parsed as Partial<TokenInfoWire>);
  }

  async save(name: string, token: TokenInfo): Promise<void> {
    this.ensureDir();
    const target = this.pathFor(name);
    const tmp = `${target}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
    const data = Buffer.from(`${JSON.stringify(tokenToWire(token), null, 2)}\n`, 'utf-8');
    const fd = openSync(tmp, 'w', 0o600);
    try {
      let written = 0;
      while (written < data.length) {
        written += writeSync(fd, data, written, data.length - written);
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      // chmod again in case umask stripped bits during open
      chmodSync(tmp, 0o600);
      renameSync(tmp, target);
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw error;
    }
    restrictWindowsAclBestEffort(target);
  }

  async remove(name: string): Promise<void> {
    try {
      unlinkSync(this.pathFor(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async list(): Promise<string[]> {
    let entries: string[];
    try {
      entries = readdirSync(this.dir);
    } catch {
      return [];
    }
    // Mirror `pathFor`: dotfiles are never valid token names, so exclude them
    // (and anything else `pathFor` would reject) instead of advertising keys
    // that can never be loaded.
    return entries
      .filter((e) => e.endsWith('.json') && !e.startsWith('.'))
      .map((e) => e.slice(0, -'.json'.length));
  }
}
