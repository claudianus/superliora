/**
 * Fake Kaos — minimal stub for tool constructor injection in tests.
 *
 * All methods throw by default. Individual tests can override specific
 * methods with vi.fn() to provide scripted responses for the tool
 * under test.
 */

import type { Environment, Kaos } from '@superliora/kaos';
import type { ExecutableToolResult } from '#/loop';


function notImplemented(method: string): never {
  throw new Error(`FakeKaos.${method} not implemented — override in test`);
}

export const FAKE_OS_ENV: Environment = {
  osKind: 'Linux',
  osArch: 'x86_64',
  osVersion: 'test',
  shellName: 'bash',
  shellPath: '/bin/bash',
};

export function createFakeKaos(
  overrides?: Partial<Kaos>,
  envLayers: readonly Record<string, string>[] = [],
): Kaos {
  // Hold cwd in a closure so `chdir` (which `config.update({cwd})` now
  // routes through) can mutate it and later `getcwd()` calls see the
  // update — mirroring real-kaos semantics without needing a backing fs.
  let cwd = overrides?.getcwd?.() ?? '/workspace';
  const base: Kaos = {
    name: 'fake',
    osEnv: FAKE_OS_ENV,
    pathClass: () => 'posix',
    normpath: (p: string) => p,
    gethome: () => '/home/test',
    getcwd: () => cwd,
    withCwd: (next: string) => createFakeKaos({ ...overrides, getcwd: () => next }, envLayers),
    withEnv: (env: Record<string, string>) =>
      createFakeKaos({ ...overrides, getcwd: () => cwd }, [...envLayers, env]),
    chdir: async (next: string) => {
      cwd = next;
    },
    stat: () => notImplemented('stat'),
    realpath: async (p: string) => p,
    iterdir: () => notImplemented('iterdir'),
    glob: () => notImplemented('glob'),
    readBytes: () => notImplemented('readBytes'),
    readText: () => notImplemented('readText'),
    readLines: () => notImplemented('readLines'),
    writeBytes: () => notImplemented('writeBytes'),
    writeText: () => notImplemented('writeText'),
    mkdir: () => notImplemented('mkdir'),
    unlink: () => notImplemented('unlink'),
    rename: async () => undefined,
    writeAtomic: () => notImplemented('writeAtomic'),
    exec: () => notImplemented('exec'),
    execWithEnv: (args, invocationEnv) => {
      const mergedEnv = mergeEnvLayers(invocationEnv, envLayers);
      if (overrides?.execWithEnv) return overrides.execWithEnv(args, mergedEnv);
      return notImplemented('execWithEnv');
    },
  };
  return {
    ...base,
    ...overrides,
    execWithEnv: base.execWithEnv,
    withCwd: base.withCwd,
    withEnv: base.withEnv,
  } as Kaos;
}

function isSecretEnvKeyName(key: string): boolean {
  const upper = key.toUpperCase();
  return upper.includes('KEY') || upper.includes('SECRET') || upper.includes('TOKEN');
}

function mergeEnvLayers(
  invocationEnv: Record<string, string> | undefined,
  envLayers: readonly Record<string, string>[],
): Record<string, string> | undefined {
  if (envLayers.length === 0) return invocationEnv;
  const merged: Record<string, string> = { ...invocationEnv };
  for (const layer of envLayers) {
    for (const [key, value] of Object.entries(layer)) {
      // Mirror LocalKaos: withEnv layers must not reintroduce secret-named keys.
      if (isSecretEnvKeyName(key)) continue;
      merged[key] = value;
    }
  }
  return merged;
}


/**
 * Assert that a `ToolResult`'s `content` is a string and return it.
 * Keeps the lint rule `typescript-eslint(no-base-to-string)` happy by
 * narrowing the `string | ToolResultContent[]` union in one place.
 */
export function toolContentString(result: ExecutableToolResult): string {
  const c = result.output;
  if (typeof c !== 'string') {
    throw new TypeError(`expected string content, got ${typeof c}`);
  }
  return c;
}

