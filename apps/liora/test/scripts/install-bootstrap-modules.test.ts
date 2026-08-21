import { readFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const STATIC_IMPORT_RE = /from\s+['"](\.\/[^'"]+\.mjs)['"]/g;

function parseInstallPs1Modules(ps1: string): string[] {
  const block = ps1.match(/\$InstallModules\s*=\s*@\(([\s\S]*?)\)\s*\r?\n/)?.[1];
  if (!block) {
    throw new Error('install.ps1 $InstallModules list not found');
  }
  return [...block.matchAll(/'([^']+\.mjs)'/g)].map((match) => match[1]!);
}

function parseInstallShModules(sh: string): string[] {
  const block = sh.match(/for f in ((?:[\w.-]+\.mjs\s*)+); do/)?.[1];
  if (!block) {
    throw new Error('install.sh bootstrap module loop not found');
  }
  return block.trim().split(/\s+/);
}

async function collectImportedInstallModules(entryRelPaths: readonly string[]): Promise<string[]> {
  const queue = [...entryRelPaths];
  const seenFiles = new Set<string>();
  const installModules = new Set<string>();

  while (queue.length > 0) {
    const rel = queue.pop()!;
    if (seenFiles.has(rel)) continue;
    seenFiles.add(rel);

    const text = await readFile(resolve(repoRoot, rel), 'utf8');
    const dir = dirname(rel).replaceAll('\\', '/');
    for (const match of text.matchAll(STATIC_IMPORT_RE)) {
      const imported = posix.normalize(`${dir}/${match[1]}`);
      if (!imported.startsWith('scripts/install/') || !imported.endsWith('.mjs')) {
        continue;
      }
      installModules.add(posix.basename(imported));
      queue.push(imported);
    }
  }

  return [...installModules];
}

describe('install bootstrap module allowlists', () => {
  it('downloads every statically imported scripts/install module', async () => {
    const [ps1, sh] = await Promise.all([
      readFile(resolve(repoRoot, 'install.ps1'), 'utf8'),
      readFile(resolve(repoRoot, 'install.sh'), 'utf8'),
    ]);
    const ps1Modules = parseInstallPs1Modules(ps1);
    const shModules = parseInstallShModules(sh);
    const imported = await collectImportedInstallModules([
      'scripts/install-superliora.mjs',
      'scripts/install/source.mjs',
    ]);

    expect(ps1Modules).toEqual(shModules);
    expect(imported.filter((name) => !ps1Modules.includes(name))).toEqual([]);
    expect(imported.filter((name) => !shModules.includes(name))).toEqual([]);
  });
});
