/**
 * Lexical Bash/Script path ceiling for sandboxProfile workspace | read-only.
 *
 * Reuses extractPathCandidates — not a shell parser and not OS isolation.
 * Remaining holes until process enforcement: `python -c`, encoding tricks,
 * and LIORA_FORCE_BASH combinations.
 */

import type { Kaos } from '@superliora/kaos';

import type { PathClass, PathSecurityCode } from './path-access';
import { PathSecurityError, policyForSandboxProfile, resolvePathAccess } from './path-access';
import { extractPathCandidates } from './shell-sensitive-path';
import type { WorkspaceConfig } from '../support/workspace';

export type ShellSandboxPathHit = {
  readonly path: string;
  readonly code: Extract<PathSecurityCode, 'PATH_OUTSIDE_WORKSPACE' | 'PATH_READ_ONLY'>;
  readonly message: string;
};

const DEVICE_SINKS = new Set([
  '/dev/null',
  '/dev/stdout',
  '/dev/stderr',
  'nul',
  'NUL',
  'nul:',
  'NUL:',
]);

const WRITE_REDIRECT_RE = /(?:^|[\s;|&])(?:>>?)\s*[^\s|&;<>]/;
const MUTATING_CMD_RE =
  /(?:^|[\s;|&])(?:rm|rmdir|mv|cp|tee|truncate|touch|mkdir|chmod|chown|ln|install|unlink|dd)(?:\s|$)/;
const SED_INPLACE_RE = /(?:^|[\s;|&])sed\s+(?:-[^\s]*i[^\s]*|--in-place)/;

function isDeviceSink(token: string): boolean {
  const normalized = token.replaceAll('\\', '/');
  if (DEVICE_SINKS.has(token) || DEVICE_SINKS.has(normalized)) return true;
  return /^\/(?:dev|proc\/self)\/fd\/\d+$/.test(normalized);
}

function pathClassOf(
  kaos: Pick<Kaos, 'pathClass'> | undefined,
  fallback?: PathClass,
): PathClass {
  if (kaos !== undefined) return kaos.pathClass();
  if (fallback !== undefined) return fallback;
  return process.platform === 'win32' ? 'win32' : 'posix';
}

export function detectSandboxCwd(
  cwd: string,
  workspace: WorkspaceConfig,
  kaos?: Pick<Kaos, 'pathClass'>,
): ShellSandboxPathHit | undefined {
  const profile = workspace.sandboxProfile;
  if (profile === undefined || profile === 'off') return undefined;
  try {
    resolvePathAccess(cwd, workspace.workspaceDir, workspace, {
      operation: 'read',
      policy: policyForSandboxProfile(profile, false),
      pathClass: pathClassOf(kaos),
    });
  } catch (error) {
    if (error instanceof PathSecurityError) {
      return {
        path: cwd,
        code: 'PATH_OUTSIDE_WORKSPACE',
        message: `Sandbox cwd "${cwd}" is outside workspace roots.`,
      };
    }
    throw error;
  }
  return undefined;
}

export function detectShellSandboxPath(
  command: string,
  options: {
    readonly cwd: string;
    readonly workspace: WorkspaceConfig;
    readonly kaos?: Pick<Kaos, 'pathClass'>;
    readonly pathClass?: PathClass;
  },
): ShellSandboxPathHit | undefined {
  const profile = options.workspace.sandboxProfile;
  if (profile === undefined || profile === 'off') return undefined;

  if (profile === 'read-only') {
    if (
      WRITE_REDIRECT_RE.test(command) ||
      MUTATING_CMD_RE.test(command) ||
      SED_INPLACE_RE.test(command)
    ) {
      return {
        path: command,
        code: 'PATH_READ_ONLY',
        message: 'Sandbox is read-only: Bash write redirect or mutating file command is blocked.',
      };
    }
  }

  const pathClass = options.pathClass ?? pathClassOf(options.kaos);
  const policy = policyForSandboxProfile(profile, false);

  for (const token of extractPathCandidates(command)) {
    if (isDeviceSink(token)) continue;
    try {
      resolvePathAccess(token, options.cwd, options.workspace, {
        operation: 'read',
        policy,
        pathClass,
      });
    } catch (error) {
      if (error instanceof PathSecurityError) {
        return {
          path: token,
          code: error.code === 'PATH_READ_ONLY' ? 'PATH_READ_ONLY' : 'PATH_OUTSIDE_WORKSPACE',
          message: error.message,
        };
      }
      throw error;
    }
  }
  return undefined;
}

export function formatShellSandboxPathError(hit: ShellSandboxPathHit): string {
  return `Bash blocked: sandbox path. ${hit.message} code=${hit.code}`;
}
