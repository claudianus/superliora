import { isAbsolute, relative, resolve } from 'node:path';

import { quoteShellArg } from '../../utils/shell-quote';

export function resolveInputPath(workDir: string, input: string): string {
  return isAbsolute(input) ? input : resolve(workDir, input);
}

export function displaySourcePath(workDir: string, path: string): string {
  const localPath = relative(workDir, path);
  if (localPath.length > 0 && !localPath.startsWith('..') && !isAbsolute(localPath)) return localPath;
  return path;
}

export function quoteBenchShellArg(value: string): string {
  return /^[A-Za-z0-9_./:=@%^,+-]+$/.test(value) ? value : quoteShellArg(value);
}
