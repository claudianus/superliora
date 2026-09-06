/**
 * Redirect-aware SuperLiora data-home resolution for the oauth package.
 *
 * Mirrors `resolveLioraHome` in agent-core (oauth cannot depend on
 * agent-core): `SUPERLIORA_HOME` env wins, then the `~/.superliora/
 * home.redirect` pointer file, then `~/.superliora` itself. Without this,
 * credential writes leak to the OS-profile drive on relocated installs.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';

function parseRedirect(text: string): string | undefined {
  for (const raw of String(text).split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (!isAbsolute(line)) return undefined;
    return normalize(line);
  }
  return undefined;
}

export function resolveOAuthDataHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['SUPERLIORA_HOME']?.trim();
  if (override !== undefined && override.length > 0) return override;
  const pointer = join(homedir(), '.superliora');
  try {
    const redirected = parseRedirect(readFileSync(join(pointer, 'home.redirect'), 'utf8'));
    if (redirected !== undefined && normalize(redirected) !== normalize(pointer)) {
      return redirected;
    }
  } catch {
    // No redirect file — pointer dir is the home.
  }
  return pointer;
}
