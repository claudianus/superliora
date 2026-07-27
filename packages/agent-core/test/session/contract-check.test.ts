import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { Readable } from 'node:stream';

import type { Kaos, KaosProcess } from '@superliora/kaos';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkContractFile } from '../../src/session/contract-check';

function fakeProcess(exitCode: number, output = ''): KaosProcess {
  return {
    stdin: { end: () => {} },
    stdout: Readable.from(output.length > 0 ? [output] : []),
    stderr: Readable.from([]),
    wait: () => Promise.resolve(exitCode),
    kill: () => Promise.resolve(),
  } as unknown as KaosProcess;
}

function fakeKaos(proc: KaosProcess | Error, capture: string[][]): Kaos {
  return {
    exec: (...args: string[]) => {
      capture.push(args);
      if (proc instanceof Error) return Promise.reject(proc);
      return Promise.resolve(proc);
    },
    getcwd: () => '/unused',
  } as unknown as Kaos;
}

describe('checkContractFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'contract-check-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('type-checks the owning package when a package.json exists above the file', async () => {
    await writeFile(join(dir, 'package.json'), '{"name":"contract-pkg"}');
    const contract = join(dir, 'contract.ts');
    await writeFile(contract, 'export type X = number;');

    const calls: string[][] = [];
    const result = await checkContractFile(fakeKaos(fakeProcess(0), calls), dir, 'contract.ts');

    expect(result).toEqual({ ok: true });
    expect(calls[0]).toEqual([
      'pnpm',
      '-C',
      dir,
      'exec',
      'tsc',
      '--noEmit',
      '--skipLibCheck',
    ]);
  });

  it('falls back to a standalone file check without a package.json', async () => {
    // tmpdir has no package.json above it, so no owning package is found.
    const contract = join(dir, 'loose-contract.ts');
    await writeFile(contract, 'export type Y = string;');

    const calls: string[][] = [];
    const result = await checkContractFile(fakeKaos(fakeProcess(0), calls), dir, contract);

    expect(result).toEqual({ ok: true });
    expect(calls[0]).toEqual(['pnpm', 'exec', 'tsc', '--noEmit', '--skipLibCheck', contract]);
  });

  it('reports compile failures with truncated compiler output', async () => {
    await writeFile(join(dir, 'package.json'), '{"name":"contract-pkg"}');
    const contract = join(dir, 'broken.ts');
    await writeFile(contract, 'const x: number = "nope";');

    const calls: string[][] = [];
    const kaos = fakeKaos(
      fakeProcess(2, "broken.ts(1,7): error TS2322: Type 'string' is not assignable"),
      calls,
    );
    const result = await checkContractFile(kaos, dir, contract);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('compile-failed');
      expect(result.output).toContain('TS2322');
    }
  });

  it('reports spawn errors without throwing', async () => {
    const contract = join(dir, 'any.ts');
    await writeFile(contract, 'export {};');
    const calls: string[][] = [];
    const result = await checkContractFile(
      fakeKaos(new Error('pnpm not found'), calls),
      dir,
      contract,
    );
    expect(result).toEqual({ ok: false, kind: 'spawn-error' });
  });
});
