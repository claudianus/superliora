import type { KaosProcess } from '@superliora/kaos';
import { z } from 'zod';

export const MS_PER_SECOND = 1000;
export const DEFAULT_TIMEOUT_S = 60;
export const DEFAULT_BACKGROUND_TIMEOUT_S = 10 * 60;
export const USER_INTERRUPT_REASON = 'Interrupted by user';

export const BashInputSchema = z
  .object({
    command: z.string().min(1, 'Command cannot be empty.').describe('The command to execute.'),
    cwd: z
      .string()
      .optional()
      .describe(
        "The working directory in which to run the command. When omitted, the command runs in the session's working directory.",
      ),
    timeout: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_TIMEOUT_S)
      .describe(
        'Timeout in seconds. Defaults to 60 foreground or 600 background. Ignored for background commands when disable_timeout=true.',
      )
      .optional(),
    description: z
      .string()
      .optional()
      .describe(
        'A short description for the background task. Required when run_in_background is true.',
      ),
    run_in_background: z
      .boolean()
      .optional()
      .describe('Whether to run the command as a background task.'),
    disable_timeout: z
      .boolean()
      .optional()
      .describe(
        'If true, do not apply a timeout to the command. Only applies when run_in_background is true.',
      ),
  });

export const BashOutputSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

export type BashInput = z.infer<typeof BashInputSchema>;
export type BashOutput = z.infer<typeof BashOutputSchema>;

export const SHELL_TIMEOUT_VARS = {
  DEFAULT_TIMEOUT_S,
  DEFAULT_BACKGROUND_TIMEOUT_S,
};


export function normalizeTimeoutMs(timeout: number | undefined, isBackground: boolean): number {
  const defaultSeconds = isBackground ? DEFAULT_BACKGROUND_TIMEOUT_S : DEFAULT_TIMEOUT_S;
  const value = timeout ?? defaultSeconds;
  return value * MS_PER_SECOND;
}

export function closeProcessStdin(proc: KaosProcess): void {
  try {
    proc.stdin.end();
  } catch {
    /* process already gone */
  }
}

export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

export function windowsPathToPosixPath(path: string): string {
  if (path.startsWith('\\\\')) {
    return path.replaceAll('\\', '/');
  }

  const driveMatch = /^([A-Za-z]):(?:[\\/]|$)/.exec(path);
  if (driveMatch !== null) {
    const drive = driveMatch[1]!.toLowerCase();
    const rest = path.slice(2).replaceAll('\\', '/');
    return `/${drive}${rest.startsWith('/') ? rest : `/${rest}`}`;
  }

  return path.replaceAll('\\', '/');
}

const WINDOWS_NUL_REDIRECT = /(\d?&?>+\s*)[Nn][Uu][Ll](?=\s|$|[|&;)\n])/g;

export function rewriteWindowsNullRedirect(command: string): string {
  return command.replace(WINDOWS_NUL_REDIRECT, '$1/dev/null');
}

export function backgroundResultMessage(title: string, suffix: string): string {
  const normalized = title.endsWith('.') ? title : `${title}.`;
  if (suffix.length === 0) return normalized;
  return suffix.endsWith('.') ? `${normalized} ${suffix}` : `${normalized} ${suffix}.`;
}

export function formatTimeoutLabel(timeoutMs: number): string {
  return timeoutMs % 1000 === 0 ? `${String(timeoutMs / 1000)}s` : `${String(timeoutMs)}ms`;
}

export function foregroundDescription(args: BashInput): string {
  const explicit = args.description?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const preview = args.command.length > 60 ? `${args.command.slice(0, 60)}…` : args.command;
  return `Bash: ${preview}`;
}

