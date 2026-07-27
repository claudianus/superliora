import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';

import type { Kaos, KaosProcess } from '@superliora/kaos';

const CONTRACT_CHECK_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 4_000;

export type ContractCheckOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: 'spawn-error' | 'timeout' | 'compile-failed';
      readonly output?: string;
    };

/**
 * Contract-first fan-out guard (harness reform T4-3): type-check a shared
 * contract file before subagents are spawned, so every side imports a
 * contract the compiler has already accepted. The check runs the owning
 * package's `tsc --noEmit` when a package.json exists above the file, and
 * falls back to a standalone file check otherwise.
 */
export async function checkContractFile(
  kaos: Kaos,
  baseDir: string,
  contractPath: string,
): Promise<ContractCheckOutcome> {
  const absolute = isAbsolute(contractPath) ? contractPath : resolve(baseDir, contractPath);
  const packageDir = findPackageDirFromDir(dirname(absolute));
  const args =
    packageDir === undefined
      ? ['exec', 'tsc', '--noEmit', '--skipLibCheck', absolute]
      : ['-C', packageDir, 'exec', 'tsc', '--noEmit', '--skipLibCheck'];
  return runTypecheckCommand(kaos, args);
}

/**
 * Rolling integration guard (harness reform T3-3d): type-check the package
 * owning `baseDir` without targeting a single file. Fan-out runs invoke it
 * after each subagent completion so cross-agent type leaks surface
 * incrementally instead of at the final gate. No owning package means there
 * is nothing to enforce.
 */
export async function checkPackageTypecheck(
  kaos: Kaos,
  baseDir: string,
): Promise<ContractCheckOutcome> {
  const packageDir = findPackageDirFromDir(resolve(baseDir));
  if (packageDir === undefined) return { ok: true };
  return runTypecheckCommand(kaos, [
    '-C',
    packageDir,
    'exec',
    'tsc',
    '--noEmit',
    '--skipLibCheck',
  ]);
}

async function runTypecheckCommand(
  kaos: Kaos,
  args: readonly string[],
): Promise<ContractCheckOutcome> {
  let proc: KaosProcess | undefined;
  try {
    proc = await kaos.exec('pnpm', ...args);
  } catch {
    return { ok: false, kind: 'spawn-error' };
  }
  try {
    proc.stdin.end();
  } catch {
    /* stdin already closed */
  }

  const chunks: string[] = [];
  const collected = new Promise<string>((done) => {
    let pending = 2;
    const finish = (): void => {
      pending -= 1;
      if (pending === 0) done(chunks.join(''));
    };
    const collect = (stream: Readable): void => {
      stream.on('data', (chunk: unknown) => chunks.push(String(chunk)));
      stream.on('end', finish);
    };
    collect(proc.stdout);
    collect(proc.stderr);
  });

  let exitCode: number | null;
  try {
    exitCode = await Promise.race([
      proc.wait(),
      new Promise<null>((resolveRace) => {
        const timer = setTimeout(() => resolveRace(null), CONTRACT_CHECK_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } catch {
    return { ok: false, kind: 'spawn-error' };
  }
  if (exitCode === null) {
    try {
      await proc.kill();
    } catch {
      /* already dead */
    }
    return { ok: false, kind: 'timeout' };
  }
  if (exitCode !== 0) {
    const output = (await collected).trim().slice(0, MAX_OUTPUT_CHARS);
    return {
      ok: false,
      kind: 'compile-failed',
      output,
    };
  }
  return { ok: true };
}

function findPackageDirFromDir(startDir: string): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
