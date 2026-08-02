/**
 * Block Bash commands that target known sensitive files (env, SSH keys,
 * cloud credentials). Read/Write/Edit already refuse these paths; without
 * this check, agents can exfiltrate secrets via `cat .env`, `base64 id_rsa`,
 * or `source .env`.
 *
 * Hard deny — there is no force-prefix escape hatch. Legitimate secret work
 * belongs outside the agent tool surface.
 */

import { isSensitiveFile } from './sensitive';

export type ShellSensitivePathHit = {
  readonly path: string;
  readonly message: string;
};

/**
 * Loop44a — stable marker when Bash is hard-denied for a sensitive path
 * (env / credential / SSH key). TUI matches this for a named notice; there is
 * no force-prefix escape hatch.
 */
export const SHELL_SENSITIVE_PATH_CODE = 'SHELL_SENSITIVE_PATH' as const;

/**
 * Returns a hit when the command clearly references a sensitive path.
 * Undefined means allow Bash (subject to other policies).
 */
export function detectShellSensitivePath(command: string): ShellSensitivePathHit | undefined {
  const raw = command.trim();
  if (raw.length === 0) return undefined;

  for (const token of extractPathCandidates(raw)) {
    if (!isSensitiveFile(token)) continue;
    return {
      path: token,
      message:
        `"${token}" matches a sensitive-file pattern (env / credential / SSH key). ` +
        'Bash cannot read or write secret files. Do not exfiltrate credentials through the shell.',
    };
  }
  return undefined;
}

export function formatShellSensitivePathError(hit: ShellSensitivePathHit): string {
  return `Bash blocked: sensitive path. ${hit.message} code=${SHELL_SENSITIVE_PATH_CODE}`;
}

/**
 * Pull path-like tokens and redirect targets from a shell command.
 * Quote-aware enough for common agent invocations; not a full shell parser.
 */
function extractPathCandidates(command: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (value: string): void => {
    for (const candidate of expandPathForms(value)) {
      if (candidate.length === 0) continue;
      if (!looksLikePathCandidate(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  };

  // Redirect targets: >file, >>file, <file (optional spaces).
  for (const match of command.matchAll(/(?:^|[\s])(?:>>?|<)\s*([^\s|&;<>]+)/g)) {
    const target = match[1];
    if (target !== undefined) push(target);
  }

  for (const token of tokenizeShellish(command)) {
    push(token);
  }

  // Language one-liners: open(".env"), Path('.ssh/id_rsa')
  for (const match of command.matchAll(
    /\b(?:open|Path|readFile(?:Sync)?|read_text|read_bytes)\s*\(\s*(['"])([^'"]+)\1/g,
  )) {
    const path = match[2];
    if (path !== undefined) push(path);
  }

  return out;
}

/**
 * Normalize shell path spellings agents actually type.
 * - strip outer quotes (already done upstream)
 * - peel `file=`, `--flag=`, `-f=` style values
 * - drop `file://` scheme
 * - peel scp/rsync remote forms `user@host:path`
 * - expand a few common home prefixes for isSensitiveFile directory checks
 */
function expandPathForms(raw: string): string[] {
  let value = stripOuterQuotes(raw.trim());
  if (value.length === 0) return [];

  // Long/short opt or env assignment: --env-file=.env, KEY=.env, -f=.ssh/id_rsa
  const assigned = /^(?:--?[A-Za-z0-9][\w-]*|[A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(value);
  if (assigned?.[1] !== undefined) {
    value = stripOuterQuotes(assigned[1]);
  }

  if (value.startsWith('file://')) {
    value = value.slice('file://'.length);
  }

  // scp/rsync remote: user@host:.env  host:/path/.ssh/id_rsa  [::1]:.env
  // Prefer the path after the *last* unescaped colon when a host marker is present.
  const remote = /^(?:[^\s/@]+@)?(?:\[[^\]]+\]|[^\s:/]+):(.+)$/.exec(value);
  if (remote?.[1] !== undefined && remote[1].length > 0) {
    value = stripOuterQuotes(remote[1]);
  }

  const forms = new Set<string>([value]);

  // `$HOME/.ssh/id_rsa` / `${HOME}/.ssh/id_rsa` → treat like `/home/*/.ssh/...` for dir rules
  const homeExpanded = value
    .replace(/^\$\{?HOME\}?(?=\/|\\|$)/, '/home/user')
    .replace(/^\$\{?USERPROFILE\}?(?=\/|\\|$)/i, '/home/user');
  if (homeExpanded !== value) forms.add(homeExpanded);

  // `~/.ssh/config` already matches isSensitiveFile via directory parts.
  return [...forms];
}

function looksLikePathCandidate(token: string): boolean {
  // Reject pure flags (not `--flag=path` — those are peeled in expandPathForms).
  if (token.startsWith('-') && !token.includes('/')) return false;
  // Path-like: separator, home, relative dotfile, or absolute.
  if (token.includes('/') || token.includes('\\')) return true;
  if (token.startsWith('~')) return true;
  if (token.startsWith('.')) return true;
  // Bare secret basenames that are unambiguous files (not English words like "credentials" alone).
  const base = token.split(/[/\\]/).pop() ?? token;
  if (base.startsWith('.env')) return true;
  if (/^id_(?:rsa|ed25519|ecdsa)(?:$|[-_.])/.test(base)) return true;
  return false;
}

function stripOuterQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value.at(-1);
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Minimal quote-aware tokenizer. Splits on whitespace outside quotes;
 * keeps quoted segments as single tokens.
 */
function tokenizeShellish(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  const flush = (): void => {
    if (current.length === 0) return;
    tokens.push(current);
    current = '';
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    // Split on common shell metacharacters so `cat;.env` still yields `.env`.
    if (/[|;&<>`()$]/.test(ch)) {
      flush();
      continue;
    }
    current += ch;
  }
  flush();
  return tokens;
}
