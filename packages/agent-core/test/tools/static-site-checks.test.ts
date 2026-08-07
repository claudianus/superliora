import { Readable, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { Kaos, KaosProcess } from '@superliora/kaos';

import type { Agent } from '../../src/agent';
import { runCompletionVerification } from '../../src/session/subagent/subagent-verification-gate';
import { VERIFICATION_NOT_RUN } from '../../src/session/subagent/subagent-result-contract';
import {
  isStaticSiteChangeSet,
  runStaticSiteChecks,
} from '../../src/tools/builtin/ops/static-site-checks';
import { createFakeKaos } from './fixtures/fake-kaos';

function fakeProcess(exitCode: number, stdout = '', stderr = ''): KaosProcess {
  return {
    stdin: new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    }),
    stdout: Readable.from([stdout]),
    stderr: Readable.from([stderr]),
    pid: 1234,
    exitCode: null,
    wait: async () => exitCode,
    kill: async () => undefined,
    dispose: () => undefined,
  };
}

/** Kaos where every probed file exists and `node --check` follows `jsExit`. */
function staticSiteKaos(options: {
  readonly missing?: readonly string[];
  readonly jsExit?: number;
  readonly jsStderr?: string;
}): Kaos {
  const missing = new Set(options.missing ?? []);
  return createFakeKaos({
    stat: async (path: string) => {
      if ([...missing].some((file) => path.endsWith(file))) {
        throw new Error('ENOENT');
      }
      return { isFile: () => true } as never;
    },
    exec: (async (...args: string[]) => {
      if (args[0] === 'node' && args[1] === '--check') {
        return fakeProcess(options.jsExit ?? 0, '', options.jsStderr ?? '');
      }
      throw new Error(`unexpected exec: ${args.join(' ')}`);
    }) as Kaos['exec'],
  });
}

describe('isStaticSiteChangeSet', () => {
  it('accepts pure static change sets', () => {
    expect(isStaticSiteChangeSet(['index.html', 'style.css', 'app.js', 'assets/logo.svg'])).toBe(
      true,
    );
    expect(isStaticSiteChangeSet(['README.md', 'data.json'])).toBe(true);
  });

  it('rejects empty, toolchain, and extensionless change sets', () => {
    expect(isStaticSiteChangeSet([])).toBe(false);
    expect(isStaticSiteChangeSet(['index.html', 'src/main.ts'])).toBe(false);
    expect(isStaticSiteChangeSet(['package.json5'])).toBe(false);
    expect(isStaticSiteChangeSet(['Makefile'])).toBe(false);
  });
});

describe('runStaticSiteChecks', () => {
  it('passes when all files exist and all JS parses', async () => {
    const outcome = await runStaticSiteChecks(staticSiteKaos({}), '/site', [
      'index.html',
      'app.js',
    ]);
    expect(outcome.ok).toBe(true);
    expect(outcome.jsChecked).toBe(1);
    expect(outcome.missingFiles).toHaveLength(0);
    expect(outcome.failures).toHaveLength(0);
  });

  it('fails when a changed file is missing', async () => {
    const outcome = await runStaticSiteChecks(
      staticSiteKaos({ missing: ['index.html'] }),
      '/site',
      ['index.html', 'app.js'],
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.missingFiles).toEqual(['index.html']);
  });

  it('fails when node --check rejects a JS file', async () => {
    const outcome = await runStaticSiteChecks(
      staticSiteKaos({ jsExit: 1, jsStderr: 'SyntaxError: Unexpected token' }),
      '/site',
      ['app.js'],
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.failures[0]?.file).toBe('app.js');
    expect(outcome.failures[0]?.detail).toContain('SyntaxError');
  });
});

describe('runCompletionVerification — static-site contract', () => {
  function fakeChild(kaos: Kaos): Agent {
    return { kaos, config: { cwd: '/site' } } as unknown as Agent;
  }

  it('goes green for a verified static site instead of staying unverified', async () => {
    const verdict = await runCompletionVerification(
      fakeChild(staticSiteKaos({})),
      'coder',
      ['index.html', 'app.js'],
      undefined,
    );
    expect(verdict).toEqual({
      tests: 'passed',
      typecheck: 'passed',
      lint: 'passed',
      visual: 'not_run',
    });
  });

  it('fails the gate when static checks fail', async () => {
    const verdict = await runCompletionVerification(
      fakeChild(staticSiteKaos({ jsExit: 1, jsStderr: 'SyntaxError' })),
      'coder',
      ['index.html', 'app.js'],
      undefined,
    );
    expect(verdict.tests).toBe('failed');
  });

  it('still skips non-static out-of-package change sets', async () => {
    const verdict = await runCompletionVerification(
      fakeChild(staticSiteKaos({})),
      'coder',
      ['src/main.ts', 'README.md'],
      undefined,
    );
    expect(verdict).toEqual(VERIFICATION_NOT_RUN);
  });
});
