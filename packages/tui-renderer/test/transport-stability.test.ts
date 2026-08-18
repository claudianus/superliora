import { describe, expect, it } from 'vitest';

import {
  UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS,
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

  it('trusts an explicit probe answer over the platform heuristic', () => {
    expect(
      resolveRendererTransportStability({
        platform: 'win32',
        environment: {},
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
