import { describe, expect, it } from 'vitest';

import {
  UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS,
  isTrustedWindowsSynchronizedHost,
  resolveRendererTransportStability,
  resolveUnstableTransportFrameIntervalMs,
} from '../src/terminal/transport-stability';

describe('resolveRendererTransportStability', () => {
  it('treats Windows without a probe answer as unstable', () => {
    expect(resolveRendererTransportStability({ platform: 'win32', environment: {} })).toBe(
      'unstable',
    );
  });

  it('treats POSIX without a probe answer as synchronized', () => {
    expect(resolveRendererTransportStability({ platform: 'linux', environment: {} })).toBe(
      'synchronized',
    );
    expect(resolveRendererTransportStability({ platform: 'darwin', environment: {} })).toBe(
      'synchronized',
    );
  });

  it('trusts Windows Terminal even when the 2026 probe has no answer', () => {
    expect(
      resolveRendererTransportStability({
        platform: 'win32',
        environment: { WT_SESSION: 'abc' },
      }),
    ).toBe('synchronized');
    expect(
      resolveRendererTransportStability({
        platform: 'win32',
        environment: { WT_SESSION: 'abc' },
        synchronizedOutputProbeTimedOut: true,
      }),
    ).toBe('synchronized');
  });

  it('trusts a 2026 answer from Windows Terminal', () => {
    expect(
      resolveRendererTransportStability({
        platform: 'win32',
        environment: { WT_SESSION: 'abc' },
        synchronizedOutputSupport: 'supported',
      }),
    ).toBe('synchronized');
    expect(
      resolveRendererTransportStability({
        platform: 'linux',
        environment: {},
        synchronizedOutputSupport: 'unsupported',
      }),
    ).toBe('unstable');
    expect(
      resolveRendererTransportStability({
        platform: 'win32',
        environment: { WT_SESSION: 'abc' },
        synchronizedOutputSupport: 'unsupported',
      }),
    ).toBe('unstable');
  });

  it('keeps legacy conhost unstable even when something answers 2026', () => {
    expect(
      resolveRendererTransportStability({
        platform: 'win32',
        environment: { TERM: 'xterm-256color', TERM_PROGRAM: 'vscode' },
        synchronizedOutputSupport: 'supported',
      }),
    ).toBe('unstable');
    expect(
      resolveRendererTransportStability({
        platform: 'win32',
        environment: {},
        synchronizedOutputSupport: 'supported',
      }),
    ).toBe('unstable');
  });

  it('honors the environment override above probe and platform', () => {
    expect(
      resolveRendererTransportStability({
        platform: 'linux',
        environment: { TUI_RENDERER_TRANSPORT_STABILITY: 'unstable' },
        synchronizedOutputSupport: 'supported',
      }),
    ).toBe('unstable');
    expect(
      resolveRendererTransportStability({
        platform: 'win32',
        environment: { HARNESS_TUI_TRANSPORT_STABILITY: ' synchronized ' },
      }),
    ).toBe('synchronized');
  });

  it('ignores unrecognized override values', () => {
    expect(
      resolveRendererTransportStability({
        platform: 'win32',
        environment: { TUI_RENDERER_TRANSPORT_STABILITY: 'maybe' },
      }),
    ).toBe('unstable');
  });
});

describe('isTrustedWindowsSynchronizedHost', () => {
  it('treats non-Windows hosts as trusted', () => {
    expect(isTrustedWindowsSynchronizedHost({}, 'linux')).toBe(true);
    expect(isTrustedWindowsSynchronizedHost({}, 'darwin')).toBe(true);
  });

  it('trusts Windows Terminal, which implements 2026 and holds frames', () => {
    expect(isTrustedWindowsSynchronizedHost({ WT_SESSION: '1' }, 'win32')).toBe(true);
  });

  it('does not trust a Windows host outside Windows Terminal', () => {
    expect(
      isTrustedWindowsSynchronizedHost({ TERM: 'xterm-256color', TERM_PROGRAM: 'vscode' }, 'win32'),
    ).toBe(false);
    expect(isTrustedWindowsSynchronizedHost({ TERM: 'xterm-256color' }, 'win32')).toBe(false);
    expect(isTrustedWindowsSynchronizedHost({ WT_SESSION: '  ' }, 'win32')).toBe(false);
  });
});

describe('resolveUnstableTransportFrameIntervalMs', () => {
  it('defaults to the shared floor when no override is set', () => {
    expect(resolveUnstableTransportFrameIntervalMs({})).toBe(UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS);
  });

  it('honors the environment override', () => {
    expect(
      resolveUnstableTransportFrameIntervalMs({ TUI_RENDERER_UNSTABLE_FRAME_INTERVAL_MS: '40' }),
    ).toBe(40);
    expect(
      resolveUnstableTransportFrameIntervalMs({ HARNESS_TUI_UNSTABLE_FRAME_INTERVAL_MS: '120' }),
    ).toBe(120);
  });

  it('passes 0 through so the render loop can disable the floor', () => {
    expect(
      resolveUnstableTransportFrameIntervalMs({ TUI_RENDERER_UNSTABLE_FRAME_INTERVAL_MS: '0' }),
    ).toBe(0);
  });

  it('falls back to the default on empty or non-numeric overrides', () => {
    expect(
      resolveUnstableTransportFrameIntervalMs({ TUI_RENDERER_UNSTABLE_FRAME_INTERVAL_MS: '' }),
    ).toBe(UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS);
    expect(
      resolveUnstableTransportFrameIntervalMs({ TUI_RENDERER_UNSTABLE_FRAME_INTERVAL_MS: 'abc' }),
    ).toBe(UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS);
  });
});
