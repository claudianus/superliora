/**
 * Path safety guards used by file tools, Script, and Bash path tokens.
 *
 * Canonicalization in `resolvePathAccess` is **lexical** (no symlink follow).
 * `assertSandboxResolvedPath` optionally refines once via Kaos `realpath`
 * (longest existing prefix) so workspace/read-only profiles cannot escape
 * through a symlink or Windows junction. Call that at execute time, not
 * on every I/O chunk.
 *
 * Mirrors `KaosPath.canonical()` and keeps the guard backend-aware:
 * callers should pass the active Kaos path class so SSH paths stay POSIX
 * even when the host Node process is running on Windows.
 *
 * Shared-prefix escapes (a path like `/workspace-evil` passing a naive
 * `startswith('/workspace')` check) are blocked by requiring a path
 * separator (or exact equality) after the base prefix in
 * `isWithinDirectory`.
 */

import * as pathe from 'pathe';

import type { Kaos } from '@superliora/kaos';

import type { WorkspaceConfig } from '../support/workspace';
import { isSensitiveFile } from './sensitive';

export type PathClass = 'posix' | 'win32';
export type PathSecurityCode =
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'PATH_SENSITIVE'
  | 'PATH_INVALID'
  | 'PATH_READ_ONLY'
  | 'PATH_SYMLINK_OUTSIDE';
export type PathAccessOperation = 'read' | 'write' | 'search';
/**
 * Path guard modes (sandbox profile, orthogonal to permission ask/auto/yolo):
 * - `absolute-outside-allowed` — legacy default: absolute outside paths OK; relative escape denied
 * - `disabled` — no workspace bound (still may check sensitive)
 * - `workspace` — deny read/write/search outside workspace roots (absolute or relative)
 * - `read-only` — deny all write/edit operations; reads follow workspace rules
 *
 * Product settings map: off → absolute-outside-allowed | disabled;
 * workspace → workspace; read-only → read-only.
 */
export type WorkspaceGuardMode =
  | 'absolute-outside-allowed'
  | 'disabled'
  | 'workspace'
  | 'read-only';

/** Product-facing sandbox profile (1st-party path policy; not OS Landlock). */
export type SandboxProfile = 'off' | 'workspace' | 'read-only';

export interface WorkspaceAccessPolicy {
  readonly guardMode: WorkspaceGuardMode;
  readonly checkSensitive: boolean;
}

export const DEFAULT_WORKSPACE_ACCESS_POLICY: WorkspaceAccessPolicy = {
  guardMode: 'absolute-outside-allowed',
  checkSensitive: true,
};

/** Map product sandbox profile → WorkspaceAccessPolicy guard mode. */
export function sandboxProfileToGuardMode(profile: SandboxProfile): WorkspaceGuardMode {
  switch (profile) {
    case 'off':
      return 'absolute-outside-allowed';
    case 'workspace':
      return 'workspace';
    case 'read-only':
      return 'read-only';
  }
}

export function policyForSandboxProfile(
  profile: SandboxProfile,
  checkSensitive = true,
): WorkspaceAccessPolicy {
  return {
    guardMode: sandboxProfileToGuardMode(profile),
    checkSensitive,
  };
}

/** Policy from `workspace.sandboxProfile`, or the legacy default when unset. */
export function policyFromWorkspace(
  workspace: WorkspaceConfig,
  checkSensitive = true,
): WorkspaceAccessPolicy {
  if (workspace.sandboxProfile === undefined) {
    return checkSensitive
      ? DEFAULT_WORKSPACE_ACCESS_POLICY
      : { guardMode: DEFAULT_WORKSPACE_ACCESS_POLICY.guardMode, checkSensitive: false };
  }
  return policyForSandboxProfile(workspace.sandboxProfile, checkSensitive);
}

export interface PathAccess {
  readonly path: string;
  readonly outsideWorkspace: boolean;
}

export class PathSecurityError extends Error {
  readonly code: PathSecurityCode;
  readonly rawPath: string;
  readonly canonicalPath: string;

  constructor(code: PathSecurityCode, rawPath: string, canonicalPath: string, message: string) {
    super(message);
    this.name = 'PathSecurityError';
    this.code = code;
    this.rawPath = rawPath;
    this.canonicalPath = canonicalPath;
  }
}

/**
 * Loop45a — tool-result surface for PathSecurityError. Appends a stable
 * `code=PATH_*` marker so TUI can show a named notice (message body alone is
 * prose-only and was silent green/red cards).
 */
export function formatPathSecurityErrorOutput(error: PathSecurityError): string {
  const base = error.message;
  if (base.includes(`code=${error.code}`)) return base;
  return `${base} code=${error.code}`;
}

const DEFAULT_PATH_CLASS: PathClass = process.platform === 'win32' ? 'win32' : 'posix';

function isWin32DriveRelative(path: string): boolean {
  return /^[A-Za-z]:(?:$|[^\\/])/.test(path);
}

export function normalizeUserPath(path: string, pathClass: PathClass = DEFAULT_PATH_CLASS): string {
  if (pathClass !== 'win32') return path;

  // A bare root slash stays forward so downstream pathe operations
  // treat it consistently. Matches the py helper's behavior.
  if (path === '/') return '/';

  if (path.startsWith('//')) {
    return path;
  }

  const cygdriveMatch = /^\/cygdrive\/([A-Za-z])(?:\/|$)/.exec(path);
  if (cygdriveMatch !== null) {
    const drive = cygdriveMatch[1]!.toUpperCase();
    const rest = path.slice(`/cygdrive/${cygdriveMatch[1]!}`.length);
    return `${drive}:${rest === '' ? '/' : rest}`;
  }

  const driveMatch = /^\/([A-Za-z])(?:\/|$)/.exec(path);
  if (driveMatch !== null) {
    const drive = driveMatch[1]!.toUpperCase();
    const rest = path.slice(2);
    return `${drive}:${rest === '' ? '/' : rest}`;
  }

  return path;
}

function expandUserPath(path: string, homeDir: string | undefined, pathClass: PathClass): string {
  if (homeDir === undefined) return path;
  if (path === '~') return homeDir;
  if (path.startsWith('~/') || (pathClass === 'win32' && path.startsWith('~\\'))) {
    return pathe.join(homeDir, path.slice(2));
  }
  return path;
}

/**
 * Lexical canonicalization: resolve relative → absolute against `cwd`,
 * then normalize `..` / `.` segments. No filesystem I/O.
 */
export function canonicalizePath(
  path: string,
  cwd: string,
  pathClass: PathClass = DEFAULT_PATH_CLASS,
): string {
  if (path === '') {
    throw new PathSecurityError('PATH_INVALID', path, path, 'Path cannot be empty');
  }
  const normalizedPath = normalizeUserPath(path, pathClass);
  if (pathClass === 'win32' && isWin32DriveRelative(normalizedPath)) {
    throw new PathSecurityError(
      'PATH_INVALID',
      path,
      normalizedPath,
      `"${path}" is a drive-relative Windows path. Use an absolute path like C:\\path or a path relative to the working directory.`,
    );
  }
  if (!pathe.isAbsolute(normalizedPath) && !pathe.isAbsolute(cwd)) {
    throw new PathSecurityError(
      'PATH_INVALID',
      path,
      normalizedPath,
      `Cannot resolve "${path}" against non-absolute cwd "${cwd}".`,
    );
  }
  const abs = pathe.isAbsolute(normalizedPath) ? normalizedPath : pathe.resolve(cwd, normalizedPath);
  return pathe.normalize(abs);
}

/**
 * True iff `candidate` is `base` itself or a descendant of it, compared
 * on path-component boundaries. Both arguments must already be canonical.
 */
export function isWithinDirectory(
  candidate: string,
  base: string,
  pathClass: PathClass = DEFAULT_PATH_CLASS,
): boolean {
  const nc = pathe.normalize(candidate);
  const nb = pathe.normalize(base);
  const comparableCandidate = pathClass === 'win32' ? nc.toLowerCase() : nc;
  const comparableBase = pathClass === 'win32' ? nb.toLowerCase() : nb;
  if (comparableCandidate === comparableBase) return true;
  const prefix = comparableBase.endsWith('/') ? comparableBase : comparableBase + '/';
  return comparableCandidate.startsWith(prefix);
}

/**
 * True iff `candidate` (already canonical) sits inside any of the workspace
 * roots listed in `config` (primary `workspaceDir` or any `additionalDirs`).
 */
export function isWithinWorkspace(
  candidate: string,
  config: WorkspaceConfig,
  pathClass: PathClass = DEFAULT_PATH_CLASS,
): boolean {
  if (isWithinDirectory(candidate, config.workspaceDir, pathClass)) return true;
  for (const dir of config.additionalDirs) {
    if (isWithinDirectory(candidate, dir, pathClass)) return true;
  }
  return false;
}

export interface AssertPathOptions {
  readonly mode: PathAccessOperation;
  /** When true (default), also reject paths matching a sensitive-file pattern. */
  readonly checkSensitive?: boolean | undefined;
  readonly pathClass?: PathClass | undefined;
}

export interface ResolvePathAccessOptions {
  readonly operation: PathAccessOperation;
  readonly policy?: WorkspaceAccessPolicy | undefined;
  readonly pathClass?: PathClass | undefined;
  readonly homeDir?: string;
}

export interface ResolvePathAccessPathOptions {
  readonly kaos: Pick<Kaos, 'pathClass' | 'gethome'> & Partial<Pick<Kaos, 'realpath'>>;
  readonly workspace: WorkspaceConfig;
  readonly operation: PathAccessOperation;
  readonly policy?: WorkspaceAccessPolicy;
  readonly expandHome?: boolean;
}

function relativeOutsideMessage(path: string, operation: PathAccessOperation): string {
  const verb =
    operation === 'write'
      ? 'write or edit a file'
      : operation === 'search'
        ? 'search'
        : 'read a file';
  return (
    `"${path}" is not an absolute path. ` +
    `You must provide an absolute path to ${verb} outside the working directory.`
  );
}

export function resolvePathAccess(
  path: string,
  cwd: string,
  config: WorkspaceConfig,
  options: ResolvePathAccessOptions,
): PathAccess {
  const pathClass = options.pathClass ?? DEFAULT_PATH_CLASS;
  const normalizedPath = normalizeUserPath(path, pathClass);
  const expandedPath = expandUserPath(normalizedPath, options.homeDir, pathClass);
  const rawIsAbsolute = pathe.isAbsolute(expandedPath);
  const canonical = canonicalizePath(expandedPath, cwd, pathClass);
  const outsideWorkspace = !isWithinWorkspace(canonical, config, pathClass);
  const policy = options.policy ?? DEFAULT_WORKSPACE_ACCESS_POLICY;

  if (policy.checkSensitive && isSensitiveFile(canonical)) {
    throw new PathSecurityError(
      'PATH_SENSITIVE',
      path,
      canonical,
      `"${path}" matches a sensitive-file pattern (env / credential / SSH key). ` +
        `Access is blocked to protect secrets.`,
    );
  }

  // read-only profile: block all write/edit operations regardless of location.
  if (policy.guardMode === 'read-only' && options.operation === 'write') {
    throw new PathSecurityError(
      'PATH_READ_ONLY',
      path,
      canonical,
      `Sandbox is read-only: write/edit is blocked for "${path}".`,
    );
  }

  if (outsideWorkspace) {
    switch (policy.guardMode) {
      case 'absolute-outside-allowed':
        if (!rawIsAbsolute) {
          throw new PathSecurityError(
            'PATH_OUTSIDE_WORKSPACE',
            path,
            canonical,
            relativeOutsideMessage(path, options.operation),
          );
        }
        break;
      case 'disabled':
        break;
      case 'workspace':
      case 'read-only': {
        // workspace mode: deny any path outside roots (absolute or relative).
        // read-only uses the same outside bound for non-write ops.
        const verb =
          options.operation === 'write'
            ? 'write or edit'
            : options.operation === 'search'
              ? 'search'
              : 'read';
        throw new PathSecurityError(
          'PATH_OUTSIDE_WORKSPACE',
          path,
          canonical,
          `"${path}" is outside the workspace. Sandbox profile denies ${verb} outside workspace roots.`,
        );
      }
    }
  }

  return { path: canonical, outsideWorkspace };
}

export function resolvePathAccessPath(
  path: string,
  options: ResolvePathAccessPathOptions,
): string {
  const { kaos, workspace, operation, expandHome = true } = options;
  const policy = options.policy ?? policyFromWorkspace(workspace);
  return resolvePathAccess(path, workspace.workspaceDir, workspace, {
    operation,
    policy,
    pathClass: kaos.pathClass(),
    homeDir: expandHome ? kaos.gethome() : undefined,
  }).path;
}

export interface AssertSandboxResolvedPathOptions {
  readonly kaos: Pick<Kaos, 'pathClass'> & Partial<Pick<Kaos, 'realpath'>>;
  readonly workspace: WorkspaceConfig;
  readonly rawPath?: string;
}

/**
 * Follow symlinks/junctions once via Kaos `realpath`. Workspace and
 * read-only profiles deny a target that leaves allowed roots
 * (`PATH_SYMLINK_OUTSIDE`). `off` / missing realpath / resolve failure
 * keep the lexical path (SSH and some Windows junctions fail closed to
 * lexical rather than blocking the CLI).
 */
export async function assertSandboxResolvedPath(
  lexicalPath: string,
  options: AssertSandboxResolvedPathOptions,
): Promise<string> {
  const profile = options.workspace.sandboxProfile;
  if (profile === undefined || profile === 'off') return lexicalPath;
  const realpath = options.kaos.realpath;
  if (realpath === undefined) return lexicalPath;

  let resolved: string;
  try {
    resolved = await realpath(lexicalPath);
  } catch {
    return lexicalPath;
  }

  const pathClass = options.kaos.pathClass();
  const canonical = canonicalizePath(resolved, options.workspace.workspaceDir, pathClass);
  if (isWithinWorkspace(canonical, options.workspace, pathClass)) {
    return canonical;
  }

  const raw = options.rawPath ?? lexicalPath;
  throw new PathSecurityError(
    'PATH_SYMLINK_OUTSIDE',
    raw,
    canonical,
    `"${raw}" resolves outside the workspace via a symlink or junction.`,
  );
}

export async function refineSandboxPathForExecute(
  lexicalPath: string,
  options: AssertSandboxResolvedPathOptions,
): Promise<{ ok: true; path: string } | { ok: false; output: string }> {
  try {
    return { ok: true, path: await assertSandboxResolvedPath(lexicalPath, options) };
  } catch (error) {
    if (error instanceof PathSecurityError) {
      return { ok: false, output: formatPathSecurityErrorOutput(error) };
    }
    throw error;
  }
}

/**
 * Throw `PathSecurityError` if `path` escapes the workspace through a relative
 * path, matches a known sensitive file, or is empty. Returns the canonical
 * absolute path when the check passes.
 *
 * Lexical only. Use {@link assertSandboxResolvedPath} at execute time to
 * block symlink / junction escapes under workspace/read-only profiles.
 */
export function assertPathAllowed(
  path: string,
  cwd: string,
  config: WorkspaceConfig,
  options: AssertPathOptions,
): string {
  return resolvePathAccess(path, cwd, config, {
    operation: options.mode,
    pathClass: options.pathClass,
    policy: {
      guardMode: 'absolute-outside-allowed',
      checkSensitive: options.checkSensitive ?? DEFAULT_WORKSPACE_ACCESS_POLICY.checkSensitive,
    },
  }).path;
}
