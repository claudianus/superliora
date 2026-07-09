import type { Environment } from './environment';
import type { KaosProcess } from './process';
import type { StatResult } from './types';

/**
 * Kimi Agent Operating System (KAOS) interface.
 *
 * This is the core abstraction that allows the agent to interact with
 * different execution environments (local, SSH, containers, etc.)
 * through a unified API.
 */
export interface Kaos {
  /** Human-readable name for this environment (e.g. `"local"`, `"ssh:host"`). */
  readonly name: string;

  /**
   * OS / shell probe describing the target environment. Populated by the
   * concrete Kaos implementation (e.g. `detectEnvironmentFromNode()` for
   * `LocalKaos`, a remote probe for `SSHKaos`).
   */
  readonly osEnv: Environment;

  // ── Path operations (sync) ──────────────────────────────────────────

  /** Return the path style used by this environment. */
  pathClass(): 'posix' | 'win32';
  /** Normalize the given path string (resolve `.` / `..` segments). */
  normpath(path: string): string;
  /** Return the home directory of the current user. */
  gethome(): string;
  /** Return the current working directory. */
  getcwd(): string;

  // ── Directory operations (async) ────────────────────────────────────

  /** Change the working directory to `path`. */
  chdir(path: string): Promise<void>;
  /** Return a new Kaos with the given `cwd`. */
  withCwd(cwd: string): Kaos;
  /**
   * Return a new Kaos that overlays `env` onto every spawned process.
   *
   * The provided record is read when a process is spawned, so callers may
   * mutate a stable record to update future executions.
   */
  withEnv(env: Record<string, string>): Kaos;
  /** Return stat metadata for `path`. */
  stat(path: string, options?: { followSymlinks?: boolean }): Promise<StatResult>;
  /** Yield entry names in the directory at `path`. */
  iterdir(path: string): AsyncGenerator<string>;
  /** Yield paths matching `pattern` under `path`. */
  glob(
    path: string,
    pattern: string,
    options?: { caseSensitive?: boolean },
  ): AsyncGenerator<string>;

  // ── File operations (async) ─────────────────────────────────────────

  /** Read up to `n` bytes from `path` (all bytes if `n` is omitted). */
  readBytes(path: string, n?: number): Promise<Buffer>;
  /**
   * Read the file at `path` as a string.
   *
   * `errors` controls how decode errors are handled — mirrors Python's
   * `open(..., errors=)` parameter:
   * - `'strict'` (default): throw on any invalid byte for the encoding
   * - `'replace'`: substitute each invalid byte with U+FFFD (REPLACEMENT CHARACTER)
   * - `'ignore'`: drop invalid bytes silently
   */
  readText(
    path: string,
    options?: { encoding?: BufferEncoding; errors?: 'strict' | 'replace' | 'ignore' },
  ): Promise<string>;
  /** Yield lines from the file at `path` one by one. */
  readLines(
    path: string,
    options?: { encoding?: BufferEncoding; errors?: 'strict' | 'replace' | 'ignore' },
  ): AsyncGenerator<string>;
  /** Write raw bytes to `path`, returning the number of bytes written. */
  writeBytes(path: string, data: Buffer): Promise<number>;
  /** Write text to `path`, returning the number of characters written. */
  writeText(
    path: string,
    data: string,
    options?: { mode?: 'w' | 'a'; encoding?: BufferEncoding },
  ): Promise<number>;
  /** Create a directory at `path`. */
  mkdir(path: string, options?: { parents?: boolean; existOk?: boolean }): Promise<void>;
  /** Delete the file at `path`. */
  unlink(path: string): Promise<void>;
  /**
   * Rename / move `source` to `destination`, atomically replacing `destination`
   * if it already exists (POSIX `rename(2)` semantics). Used for crash-safe
   * writes that stage a temp file then swap it into place.
   */
  rename(source: string, destination: string): Promise<void>;
  /**
   * Write `data` to `path` atomically and (by default) durably:
   *   1. Write `data` to a uniquely-named temp file in the same directory.
   *   2. fsync the temp file so the bytes survive a power loss.
   *   3. rename(temp, path) — atomic on POSIX, so readers never observe a
   *      half-written / truncated file.
   *   4. fsync the parent directory so the rename is durable (unless
   *      `fsyncDir: false` is passed for a cache/derived file).
   *
   * This is the crash-safe replacement for `writeText`/`writeBytes` at any path
   * where a torn write would corrupt durable state (user source files, session
   * state, ultrawork mirrors). It does NOT support append mode — append paths
   * use `writeText(path, data, { mode: 'a' })` plus their own durability
   * strategy (e.g. the wire-log append+fsync).
   */
  writeAtomic(
    path: string,
    data: string | Buffer,
    options?: { fsyncDir?: boolean },
  ): Promise<void>;

  // ── Process execution ───────────────────────────────────────────────

  /** Spawn a process with the given arguments. */
  exec(...args: string[]): Promise<KaosProcess>;
  /** Spawn a process with explicit environment variables. */
  execWithEnv(args: string[], env?: Record<string, string>): Promise<KaosProcess>;
}
