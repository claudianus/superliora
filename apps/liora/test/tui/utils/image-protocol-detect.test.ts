import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getProbedKittyGraphics,
  initImageProtocolProbe,
  KITTY_GRAPHICS_PROBE_TIMEOUT_MS,
  parseKittyGraphicsProbe,
  resetImageProtocolProbeForTests,
  resolveImageProtocol,
  setProbedKittyGraphicsForTests,
} from '#/tui/utils/image-protocol-detect';

const ESC = '\u001B';
const BEL = '\u0007';
const ST = `${ESC}\\`;

describe('parseKittyGraphicsProbe', () => {
  it('parses an OK reply terminated with ST as supported', () => {
    expect(parseKittyGraphicsProbe(`${ESC}_Gi=31;OK${ST}`)).toBe('supported');
  });

  it('parses an OK reply terminated with BEL as supported', () => {
    expect(parseKittyGraphicsProbe(`${ESC}_Gi=31;OK${BEL}`)).toBe('supported');
  });

  it('treats any error reply carrying the probe id as supported', () => {
    // EINVAL still proves the terminal implements the graphics protocol.
    expect(parseKittyGraphicsProbe(`${ESC}_Gi=31;EINVAL${ST}`)).toBe('supported');
  });

  it('parses a DA1 reply as unsupported', () => {
    expect(parseKittyGraphicsProbe(`${ESC}[?62;4c`)).toBe('unsupported');
  });

  it('parses a short DA1 variant as unsupported', () => {
    expect(parseKittyGraphicsProbe(`${ESC}[?1;2c`)).toBe('unsupported');
  });

  it('prefers the graphics reply when both replies are buffered', () => {
    expect(parseKittyGraphicsProbe(`${ESC}_Gi=31;OK${ST}${ESC}[?62;4c`)).toBe('supported');
  });

  it('stays pending on a partial graphics reply without terminator', () => {
    expect(parseKittyGraphicsProbe(`${ESC}_Gi=3`)).toBe('pending');
  });

  it('stays pending on empty or unrelated noise', () => {
    expect(parseKittyGraphicsProbe('')).toBe('pending');
    expect(parseKittyGraphicsProbe('random terminal noise')).toBe('pending');
  });
});

describe('resolveImageProtocol', () => {
  beforeEach(() => {
    resetImageProtocolProbeForTests();
  });

  it('lets SUPERLIORA_IMAGE_PROTOCOL=none beat kitty env detection', () => {
    expect(
      resolveImageProtocol({ SUPERLIORA_IMAGE_PROTOCOL: 'none', KITTY_WINDOW_ID: '1' }),
    ).toBe('none');
  });

  it('accepts kitty and iterm2 overrides', () => {
    expect(resolveImageProtocol({ SUPERLIORA_IMAGE_PROTOCOL: 'kitty' })).toBe('kitty');
    expect(resolveImageProtocol({ SUPERLIORA_IMAGE_PROTOCOL: 'iterm2' })).toBe('iterm2');
  });

  it('ignores a garbage override and falls through to env detection', () => {
    expect(
      resolveImageProtocol({ SUPERLIORA_IMAGE_PROTOCOL: 'carrier-pigeon', KITTY_WINDOW_ID: '1' }),
    ).toBe('kitty');
  });

  it('upgrades none to kitty when the runtime probe succeeded', () => {
    setProbedKittyGraphicsForTests(true);
    expect(resolveImageProtocol({})).toBe('kitty');
  });

  it('upgrades iterm2 env detection to kitty when the probe succeeded', () => {
    setProbedKittyGraphicsForTests(true);
    expect(resolveImageProtocol({ TERM_PROGRAM: 'WezTerm' })).toBe('kitty');
  });

  it('keeps kitty env detection even when the probe failed', () => {
    setProbedKittyGraphicsForTests(false);
    expect(resolveImageProtocol({ KITTY_WINDOW_ID: '1' })).toBe('kitty');
  });

  it('passes the base detection through when the probe never ran', () => {
    expect(getProbedKittyGraphics()).toBeNull();
    expect(resolveImageProtocol({})).toBe('none');
    expect(resolveImageProtocol({ TERM_PROGRAM: 'iTerm.app' })).toBe('iterm2');
  });
});

describe('initImageProtocolProbe', () => {
  beforeEach(() => {
    resetImageProtocolProbeForTests();
  });

  it('skips the probe in CI and leaves state null', async () => {
    const probe = vi.fn(async () => true);
    await initImageProtocolProbe({ env: { CI: '1', TERM: 'xterm-256color' }, probe, isInteractive: true });
    expect(probe).not.toHaveBeenCalled();
    expect(getProbedKittyGraphics()).toBeNull();
  });

  it('skips the probe for dumb terminals', async () => {
    const probe = vi.fn(async () => true);
    await initImageProtocolProbe({ env: { TERM: 'dumb' }, probe, isInteractive: true });
    expect(probe).not.toHaveBeenCalled();
    expect(getProbedKittyGraphics()).toBeNull();
  });

  it('skips the probe inside tmux', async () => {
    const probe = vi.fn(async () => true);
    await initImageProtocolProbe({
      env: { TMUX: '/tmp/tmux-501/default,1234,0', TERM: 'xterm-256color' },
      probe,
      isInteractive: true,
    });
    expect(probe).not.toHaveBeenCalled();
    expect(getProbedKittyGraphics()).toBeNull();
  });

  it('skips the probe inside zellij', async () => {
    const probe = vi.fn(async () => true);
    await initImageProtocolProbe({ env: { ZELLIJ: '1', TERM: 'xterm-256color' }, probe, isInteractive: true });
    expect(probe).not.toHaveBeenCalled();
    expect(getProbedKittyGraphics()).toBeNull();
  });

  it('skips the probe when the override env var is set', async () => {
    const probe = vi.fn(async () => true);
    await initImageProtocolProbe({
      env: { SUPERLIORA_IMAGE_PROTOCOL: 'none', TERM: 'xterm-256color' },
      probe,
      isInteractive: true,
    });
    expect(probe).not.toHaveBeenCalled();
    expect(getProbedKittyGraphics()).toBeNull();
  });

  it('skips the probe when env detection already says kitty', async () => {
    const probe = vi.fn(async () => true);
    await initImageProtocolProbe({ env: { KITTY_WINDOW_ID: '1' }, probe, isInteractive: true });
    expect(probe).not.toHaveBeenCalled();
    expect(getProbedKittyGraphics()).toBeNull();
  });

  it('skips the probe on a non-interactive session', async () => {
    const probe = vi.fn(async () => true);
    await initImageProtocolProbe({ env: { TERM: 'xterm-256color' }, probe, isInteractive: false });
    expect(probe).not.toHaveBeenCalled();
    expect(getProbedKittyGraphics()).toBeNull();
  });

  it('probes once on a plain interactive terminal and stores the result', async () => {
    const probe = vi.fn(async () => true);
    await initImageProtocolProbe({ env: { TERM: 'xterm-256color' }, probe, isInteractive: true });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(getProbedKittyGraphics()).toBe(true);
    expect(resolveImageProtocol({ TERM: 'xterm-256color' })).toBe('kitty');
  });

  it('stores a failed probe outcome', async () => {
    const probe = vi.fn(async () => false);
    await initImageProtocolProbe({ env: { TERM: 'xterm-256color' }, probe, isInteractive: true });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(getProbedKittyGraphics()).toBe(false);
    expect(resolveImageProtocol({ TERM: 'xterm-256color' })).toBe('none');
  });
});

describe('probe defaults', () => {
  it('exposes a bounded default timeout', () => {
    expect(KITTY_GRAPHICS_PROBE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(KITTY_GRAPHICS_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(1000);
  });
});
