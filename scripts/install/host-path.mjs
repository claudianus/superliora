/**
 * Platform-aware path join for installer helpers (tests inject `platform`).
 */

import { join } from 'node:path';

export function hostJoin(platform, ...parts) {
  const filtered = parts
    .filter((part) => part !== undefined && part !== null && String(part).length > 0)
    .map((part, index) => {
      const text = String(part);
      if (index === 0) return text.replace(/[\\/]+$/, '');
      return text.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
    });
  if (platform === 'win32') return filtered.join('\\');
  if (process.platform !== 'win32') return join(...filtered);
  return filtered.join('/');
}

export function hostArch(arch = process.arch) {
  if (arch === 'arm64') return 'arm64';
  return 'x64';
}
