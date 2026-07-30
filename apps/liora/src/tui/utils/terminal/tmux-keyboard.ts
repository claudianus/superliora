import { spawn } from 'node:child_process';
import { once } from 'node:events';

const TMUX_QUERY_TIMEOUT_MS = 2000;

export const TMUX_EXTENDED_KEYS_OFF_WARNING =
  'tmux extended-keys is off; Shift-Enter may submit. Run `tmux set -g extended-keys on`; persist in ~/.tmux.conf.';

export const TMUX_EXTENDED_KEYS_FORMAT_XTERM_WARNING =
  'tmux extended-keys-format is xterm; use csi-u for modified keys. Run `tmux set -g extended-keys-format csi-u`; persist in ~/.tmux.conf.';

export type TmuxOptionReader = (option: string) => Promise<string | undefined>;

export async function detectTmuxKeyboardWarning(
  env: NodeJS.ProcessEnv = process.env,
  readTmuxOption: TmuxOptionReader = readTmuxOptionFromProcess,
): Promise<string | undefined> {
  if ((env['TMUX'] ?? '').length === 0) return undefined;

  const [extendedKeys, extendedKeysFormat] = await Promise.all([
    readTmuxOption('extended-keys'),
    readTmuxOption('extended-keys-format'),
  ]);

  if (extendedKeys === undefined) return undefined;

  if (extendedKeys !== 'on' && extendedKeys !== 'always') {
    return TMUX_EXTENDED_KEYS_OFF_WARNING;
  }

  if (extendedKeysFormat === 'xterm') {
    return TMUX_EXTENDED_KEYS_FORMAT_XTERM_WARNING;
  }

  return undefined;
}

async function readTmuxOptionFromProcess(option: string): Promise<string | undefined> {
  const proc = spawn('tmux', ['show', '-gv', option], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let stdout = '';
  proc.stdout?.on('data', (data: Buffer) => {
    stdout += data.toString('utf8');
  });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      proc.kill();
      resolve(undefined);
    }, TMUX_QUERY_TIMEOUT_MS);
  });
  const closed = once(proc, 'close')
    .then(([code]) => code === 0 ? stdout.trim() : undefined)
    .catch(() => undefined);
  const failed = once(proc, 'error')
    .then(() => undefined)
    .catch(() => undefined);

  const result = await Promise.race([closed, failed, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}
