import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'pathe';

export function resolveLioraHome(homeDir?: string | undefined): string {
  return homeDir ?? process.env['SUPERLIORA_HOME'] ?? join(homedir(), '.superliora');
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
