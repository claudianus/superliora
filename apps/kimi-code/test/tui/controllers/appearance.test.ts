import type { ProcessTerminal } from '@earendil-works/pi-tui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { AppearanceController, shouldAnimate, terminalMutationAllowed } from '#/tui/controllers/appearance';
import { AnimationScheduler } from '#/tui/controllers/animation-scheduler';
import { currentTheme } from '#/tui/theme';

const ENV_KEYS = [
  'TERM',
  'CI',
  'NO_COLOR',
  'SSH_TTY',
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'TMUX',
] as const;

describe('AnimationScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps render ticks by fps and stops cleanly on dispose', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const scheduler = new AnimationScheduler({
      fps: 10,
      enabled: true,
      requestRender,
    });

    vi.advanceTimersByTime(99);
    expect(requestRender).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestRender).toHaveBeenCalledTimes(1);

    scheduler.update({ enabled: false });
    vi.advanceTimersByTime(300);
    expect(requestRender).toHaveBeenCalledTimes(1);

    scheduler.update({ enabled: true, fps: 30 });
    vi.advanceTimersByTime(34);
    expect(requestRender).toHaveBeenCalledTimes(2);

    scheduler.dispose();
    vi.advanceTimersByTime(100);
    expect(requestRender).toHaveBeenCalledTimes(2);
  });
});

describe('AppearanceController', () => {
  const originalEnv = { ...process.env };
  let stdoutDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    for (const key of ENV_KEYS) delete process.env[key];
    process.env['TERM'] = 'xterm-256color';
    setStdoutTty(true);
    currentTheme.setCanvasBackgroundEnabled(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (stdoutDescriptor === undefined) {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    } else {
      Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor);
    }
    currentTheme.setCanvasBackgroundEnabled(true);
  });

  it('enables animation for auto and explicit motion profiles in safe terminals', () => {
    expect(
      shouldAnimate({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
      }),
    ).toBe(true);
    expect(shouldAnimate(DEFAULT_APPEARANCE_PREFERENCES)).toBe(true);
    expect(
      shouldAnimate({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
      }),
    ).toBe(false);

    process.env['SSH_TTY'] = '/dev/pts/1';
    expect(
      shouldAnimate({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
      }),
    ).toBe(false);
  });

  it('blocks terminal palette mutation in unsafe environments', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      terminalBackground: 'session' as const,
    };

    expect(terminalMutationAllowed(appearance)).toBe(true);
    process.env['NO_COLOR'] = '1';
    expect(terminalMutationAllowed(appearance)).toBe(false);
    delete process.env['NO_COLOR'];
    process.env['TMUX'] = '/tmp/tmux';
    expect(terminalMutationAllowed(appearance)).toBe(false);
  });

  it('applies canvas background and opt-in OSC colors, then resets them on dispose', () => {
    const writes: string[] = [];
    const terminal = {
      write: (chunk: string) => {
        writes.push(chunk);
      },
    } as ProcessTerminal;

    const controller = new AppearanceController({
      terminal,
      requestRender: vi.fn(),
      getAppearance: () => ({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'off',
        canvasBackground: false,
        terminalBackground: 'session',
        terminalPalette: true,
      }),
    });

    expect(currentTheme.canvasBackgroundEnabled).toBe(false);
    expect(writes.join('')).toContain('\u001B]11;');
    expect(writes.join('')).toContain('\u001B]4;0;');

    controller.dispose();

    expect(writes.at(-1)).toContain('\u001B]111');
    expect(writes.at(-1)).toContain('\u001B]104');
  });
});

function setStdoutTty(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value,
  });
}
