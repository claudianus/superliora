import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'pathe';

/** Comfortable SuperLiora home volume free space (~100 GB). */
export const LIORA_HOME_COMFORT_FREE_BYTES = 100 * 1024 * 1024 * 1024;

/** Pointer file under the OS-profile `~/.superliora` directory. */
export const LIORA_HOME_REDIRECT_FILE = 'home.redirect';

export const LIORA_DATA_DIR_NAME = '.superliora';

export interface ResolveLioraHomeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly osHome?: string;
}

export function defaultLioraHomePointerDir(osHome: string = homedir()): string {
  return join(osHome, LIORA_DATA_DIR_NAME);
}

export function parseHomeRedirectText(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (!isAbsolute(line)) return undefined;
    return normalize(line);
  }
  return undefined;
}

export function readLioraHomeRedirect(
  pointerDir: string = defaultLioraHomePointerDir(),
): string | undefined {
  const file = join(pointerDir, LIORA_HOME_REDIRECT_FILE);
  try {
    const parsed = parseHomeRedirectText(readFileSync(file, 'utf8'));
    if (parsed === undefined) return undefined;
    if (sameHomePath(parsed, pointerDir)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeLioraHomeRedirect(target: string, osHome: string = homedir()): void {
  const pointerDir = defaultLioraHomePointerDir(osHome);
  mkdirSync(pointerDir, { recursive: true, mode: 0o700 });
  const file = join(pointerDir, LIORA_HOME_REDIRECT_FILE);
  if (sameHomePath(target, pointerDir)) {
    try {
      unlinkSync(file);
    } catch {
      // No redirect to clear.
    }
    return;
  }
  writeFileSync(file, `# SuperLiora data home.\n${target}\n`, { encoding: 'utf8' });
}

export function resolveLioraHome(
  homeDir?: string | undefined,
  options?: ResolveLioraHomeOptions,
): string {
  const trimmed = homeDir?.trim();
  if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  const env = options?.env ?? process.env;
  const fromEnv = env['SUPERLIORA_HOME']?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const pointerDir = defaultLioraHomePointerDir(options?.osHome);
  const redirected = readLioraHomeRedirect(pointerDir);
  if (redirected !== undefined) return redirected;
  return pointerDir;
}

export function resolveConfigPath(input: {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
}): string {
  return input.configPath ?? join(resolveLioraHome(input.homeDir), 'config.toml');
}

export function ensureLioraHome(homeDir: string): void {
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
}

export function isLioraHomePopulated(homeDir: string): boolean {
  if (existsSync(join(homeDir, 'config.toml'))) return true;
  if (existsSync(join(homeDir, 'tui.toml'))) return true;
  if (existsSync(join(homeDir, 'credentials'))) return true;
  if (existsSync(join(homeDir, 'memory', 'liora-memory.sqlite'))) return true;
  const sessions = join(homeDir, 'sessions');
  if (!existsSync(sessions)) return false;
  try {
    return readdirSync(sessions).some((name) => name !== '.' && name !== '..');
  } catch {
    return false;
  }
}

export function sameHomePath(left: string, right: string): boolean {
  const a = normalize(left).replace(/[\\/]+$/u, '');
  const b = normalize(right).replace(/[\\/]+$/u, '');
  if (process.platform === 'win32') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}
