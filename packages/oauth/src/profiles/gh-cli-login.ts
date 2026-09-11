/**
 * GitHub CLI login readiness for the deployment lane (git push, repo
 * create, Pages enable). SuperLiora shells out to `gh` for those, so login
 * lives in the user's gh config (`hosts.yml`) — which this package never
 * reads directly (sensitive-path policy); `gh auth status` is the only
 * sanctioned probe. This is distinct from the Copilot provider login
 * (`profiles/github-copilot.ts`), which is an LLM provider credential.
 */

/** Outcome of probing the GitHub CLI login state. */
export type GhCliLoginState = 'ok' | 'logged_out' | 'binary_missing' | 'probe_failed';

export interface GhCliLoginStatus {
  readonly state: GhCliLoginState;
  /** Logged-in account label from `gh auth status` when available. */
  readonly account?: string;
  /** Compact human-readable explanation for non-ok states. */
  readonly detail?: string;
}

/** Upper bound for the `gh auth status` probe so a hung CLI cannot stall the TUI. */
const GH_AUTH_STATUS_TIMEOUT_MS = 5000;

export interface ProbeGhCliLoginDeps {
  readonly execFile?: (
    cmd: string,
    args: readonly string[],
    options: { readonly timeout: number; readonly windowsHide: boolean },
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => void;
  readonly now?: () => number;
}

/** True when gh spawn failure text means the binary is not installed. */
export function isGhBinaryMissingError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('enoent') ||
    lower.includes('executable file not found') ||
    lower.includes('command not found') ||
    lower.includes('no such file')
  );
}

/** Extract the first logged-in account from `gh auth status` output. */
export function parseGhAuthStatusAccount(output: string): string | undefined {
  // Modern gh: "✓ Logged in to github.com account octocat (keyring)"
  const accountMatch = /account\s+([^\s(]+)/i.exec(output);
  if (accountMatch?.[1] !== undefined) return accountMatch[1];
  // Legacy gh: "✓ Logged in to github.com as octocat (OAuth token)"
  const asMatch = /logged in to\s+\S+\s+as\s+([^\s(]+)/i.exec(output);
  return asMatch?.[1];
}

/** Classify `gh auth status` exit + output into a login state. */
export function classifyGhAuthStatus(input: {
  readonly errText: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}): GhCliLoginStatus {
  const blob = `${input.errText}\n${input.stdout}\n${input.stderr}`;
  if (isGhBinaryMissingError(blob)) {
    return {
      state: 'binary_missing',
      detail: 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com, then run `gh auth login`.',
    };
  }
  const output = `${input.stdout}\n${input.stderr}`;
  const account = parseGhAuthStatusAccount(output);
  const loggedOut =
    input.exitCode !== 0 &&
    (/not logged in|no account|gh auth login/i.test(output) ||
      /token not found|no accessible token/i.test(output));
  if (loggedOut) {
    return {
      state: 'logged_out',
      detail: 'GitHub CLI is not logged in. Run `gh auth login` in a terminal, then retry the push.',
    };
  }
  if (input.exitCode === 0) {
    return { state: 'ok', account };
  }
  // exitCode === null means the spawn itself failed without a missing-binary
  // signature (for example a timeout kill); report it honestly.
  return {
    state: 'probe_failed',
    detail: `Could not verify gh login (exit ${input.exitCode === null ? 'n/a' : String(input.exitCode)}): ${output.trim().slice(0, 160)}`,
  };
}

/**
 * Probe the GitHub CLI login state. Never throws — every failure path maps
 * to a `GhCliLoginStatus` so callers can render guidance instead of an error.
 */
export async function probeGhCliLogin(deps: ProbeGhCliLoginDeps = {}): Promise<GhCliLoginStatus> {
  const { execFile } = await import('node:child_process');
  const exec = deps.execFile ?? execFile;
  return new Promise<GhCliLoginStatus>((resolve) => {
    try {
      exec(
        'gh',
        ['auth', 'status'],
        { timeout: GH_AUTH_STATUS_TIMEOUT_MS, windowsHide: true },
        (err, stdout, stderr) => {
          resolve(
            classifyGhAuthStatus({
              errText: err === null ? '' : err.message,
              stdout: typeof stdout === 'string' ? stdout : String(stdout),
              stderr: typeof stderr === 'string' ? stderr : String(stderr),
              exitCode: err === null ? 0 : 1,
            }),
          );
        },
      );
    } catch (error) {
      resolve(
        classifyGhAuthStatus({
          errText: error instanceof Error ? error.message : String(error),
          stdout: '',
          stderr: '',
          exitCode: null,
        }),
      );
    }
  });
}
