import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import { createVerificationSensorLedger } from '../../src/sensors/verification-sensor-ledger';
import {
  maybeAutoVerifySurface,
  resolveVerifySurfaceUrl,
} from '../../src/session/subagent/subagent-visual-completion';

describe('resolveVerifySurfaceUrl', () => {
  it('prefers an http(s) URL from the summary', () => {
    expect(
      resolveVerifySurfaceUrl({
        summary: 'Shipped hero at https://example.test/landing — see screenshot',
        filesChanged: ['apps/site/index.html'],
        cwd: '/work',
      }),
    ).toBe('https://example.test/landing');
  });

  it('does not invent file:// from changed HTML paths', () => {
    expect(
      resolveVerifySurfaceUrl({
        summary: 'static tweak',
        filesChanged: ['public/index.html', 'public/app.css'],
        cwd: '/work',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when no http(s) URL is available', () => {
    expect(
      resolveVerifySurfaceUrl({
        summary: 'tsx-only UI',
        filesChanged: ['apps/site/src/app/page.tsx'],
        cwd: '/work',
      }),
    ).toBeUndefined();
  });
});

describe('maybeAutoVerifySurface', () => {
  it('keeps an already-recorded sensor verdict', async () => {
    const ledger = createVerificationSensorLedger();
    ledger.visualVerdict = 'passed';
    const child = {
      verificationSensorLedger: ledger,
      config: { cwd: '/work' },
      toolServices: undefined,
      kaos: {},
    } as unknown as Agent;
    await expect(
      maybeAutoVerifySurface(child, ['apps/site/index.html'], 'done', undefined),
    ).resolves.toBe('passed');
  });

  it('records failed when browser-use runtime is missing but URL resolves', async () => {
    const ledger = createVerificationSensorLedger();
    const child = {
      verificationSensorLedger: ledger,
      config: { cwd: '/work' },
      toolServices: { browserUse: undefined },
      kaos: {},
    } as unknown as Agent;
    const verdict = await maybeAutoVerifySurface(
      child,
      ['public/index.html'],
      'preview at https://example.test/',
      undefined,
    );
    expect(verdict).toBe('failed');
    expect(ledger.visualVerdict).toBe('failed');
  });

  it('stays not_run when no URL can be resolved', async () => {
    const ledger = createVerificationSensorLedger();
    const child = {
      verificationSensorLedger: ledger,
      config: { cwd: '/work' },
      toolServices: undefined,
      kaos: {},
    } as unknown as Agent;
    await expect(
      maybeAutoVerifySurface(child, ['apps/site/src/app/page.tsx'], 'tsx only', undefined),
    ).resolves.toBe('not_run');
    expect(ledger.visualVerdict).toBe('not_run');
  });
});
