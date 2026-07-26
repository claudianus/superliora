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
  return `Bash blocked: sensitive path. ${hit.message}`;
}

/**
 * Pull path-like tokens and redirect targets from a shell command.
 * Quote-aware enough for common agent invocations; not a full shell parser.
 */
function extractPathCandidates(command: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (value: string): void => {
    const cleaned = stripOuterQuotes(value.trim());
    if (cleaned.length === 0) return;
    if (!looksLikePathCandidate(cleaned)) return;
    if (seen.has(cleaned)) return;
    seen.add(cleaned);
    out.push(cleaned);
  };

  // Redirect targets: >file, >>file, <file (optional spaces).
  for (const match of command.matchAll(/(?:^|[\s])(?:>>?|<)\s*([^\s|&;<>]+)/g)) {
    const target = match[1];
    if (target !== undefined) push(target);
  }

  for (const token of tokenizeShellish(command)) {
    push(token);
  }

  return out;
}

function looksLikePathCandidate(token: string): boolean {
  // Reject pure flags and assignment-only env prefixes.
  if (token.startsWith('-')) return false;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) return false;
  // Path-like: has a separator, home, relative dot, or known secret basename.
  if (token.includes('/') || token.includes('\\')) return true;
  if (token.startsWith('~')) return true;
  if (token.startsWith('.')) return true;
  const base = token.split(/[/\\]/).pop() ?? token;
  return (
    base === '.env' ||
    base.startsWith('.env.') ||
    base === 'credentials' ||
    base.startsWith('id_rsa') ||
    base.startsWith('id_ed25519') ||
    base.startsWith('id_ecdsa') ||
    base === 'config.json' ||
    base === 'config'
  );
}

function stripOuterQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
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
