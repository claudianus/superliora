/**
 * Loop44a — surface Bash sensitive-path hard blocks in the TUI.
 *
 * When Bash targets env/credential/SSH-key paths, agent-core hard-denies with
 * `SHELL_SENSITIVE_PATH` (no force hatch). Without a notice the operator only
 * sees a red tool card and may miss that secrets cannot be shell-exfiltrated.
 */

export const SHELL_SENSITIVE_PATH_CODE = 'SHELL_SENSITIVE_PATH';

export type ShellSensitivePathNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'shell-sensitive-path';
  readonly path?: string;
};

function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (output !== null && typeof output === 'object') {
    try {
      return JSON.stringify(output);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isShellSensitivePathOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return (
    text.includes(SHELL_SENSITIVE_PATH_CODE) ||
    text.includes('Bash blocked: sensitive path')
  );
}

/** Best-effort path token from the engine message (`"path" matches …`). */
export function extractShellSensitivePath(output: unknown): string | undefined {
  const text = outputText(output);
  if (text === undefined) return undefined;
  const m = text.match(/"([^"]+)" matches a sensitive-file pattern/);
  if (m?.[1] === undefined || m[1].length === 0) return undefined;
  return m[1];
}

export function formatShellSensitivePathNotice(
  toolName?: string,
  output?: unknown,
): ShellSensitivePathNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'Bash';
  const path = extractShellSensitivePath(output);
  const pathLabel =
    path !== undefined && path.length > 0 ? path : 'a sensitive file';
  return {
    title: 'Sensitive path blocked',
    detail: `${tool} was hard-blocked for ${pathLabel} (code=${SHELL_SENSITIVE_PATH_CODE}). Env, credentials, and SSH keys cannot be read or written through the shell — no force-prefix escape hatch.`,
    status:
      path !== undefined && path.length > 0
        ? `${tool} blocked: sensitive path (${path})`
        : `${tool} blocked: sensitive path`,
    coalesceKey: 'shell-sensitive-path',
    ...(path !== undefined ? { path } : {}),
  };
}
