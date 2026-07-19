import chalk from 'chalk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  QueuePaneComponent,
  queuePaneSelectionIdentity,
  resolveHostOwnedQueueSettleStartedAtMs,
} from '#/tui/components/panes/queue-pane';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import * as appearanceEffects from '#/tui/utils/appearance-effects';
import {
  advanceAppearanceAnimationClock,
  SETTLE_FLASH_MS,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const previousEnv = {
  TERM: process.env['TERM'],
  CI: process.env['CI'],
  NO_COLOR: process.env['NO_COLOR'],
  SSH_TTY: process.env['SSH_TTY'],
  SSH_CONNECTION: process.env['SSH_CONNECTION'],
  SSH_CLIENT: process.env['SSH_CLIENT'],
};
const previousChalkLevel = chalk.level;

function enablePremiumAmbient(): void {
  process.env['TERM'] = 'xterm-256color';
  delete process.env['CI'];
  delete process.env['NO_COLOR'];
  delete process.env['SSH_TTY'];
  delete process.env['SSH_CONNECTION'];
  delete process.env['SSH_CLIENT'];
  setAppearanceRenderHealth('healthy');
  setAppearanceRenderQuality('full');
  setActiveAppearancePreferences({
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium',
    particles: 'premium',
  });
}

describe('QueuePaneComponent', () => {
  it('renders queued messages with the steer hint', () => {
    const component = new QueuePaneComponent({
      isCompacting: false,
      isStreaming: true,
      canSteerImmediately: true,
      messages: [
        { text: 'first message' },
        { text: '/skill:review src/app.ts' },
      ],
    });

    const output = stripAnsi(component.render(120).join('\n'));

    expect(output).toContain('queue 2 · 2 prompts');
    expect(output).toContain('❯ first message');
    expect(output).toContain('❯ /skill:review src/app.ts');
    expect(output).toContain('ctrl-s to steer immediately');
  });

  it('renders compaction hint when waiting for compaction', () => {
    const component = new QueuePaneComponent({
      isCompacting: true,
      isStreaming: false,
      canSteerImmediately: true,
      messages: [{ text: 'after compact' }],
    });

    const output = stripAnsi(component.render(120).join('\n'));

    expect(output).toContain('will send after compaction');
  });

  it('omits the steer hint when immediate steering is disabled', () => {
    const component = new QueuePaneComponent({
      isCompacting: false,
      isStreaming: true,
      canSteerImmediately: false,
      messages: [{ text: 'after init' }],
    });

    const output = stripAnsi(component.render(120).join('\n'));

    expect(output).toContain('will send after current task');
    expect(output).not.toContain('ctrl-s to steer immediately');
  });

  it('truncates long messages to a single line', () => {
    const longText = 'a'.repeat(200);
    const component = new QueuePaneComponent({
      isCompacting: false,
      isStreaming: true,
      canSteerImmediately: true,
      messages: [{ text: longText }],
    });

    const lines = component.render(30);
    expect(lines).toHaveLength(4); // border + count + message + hint
    const messageLine = stripAnsi(lines[2] as string);
    expect(messageLine).not.toContain('a'.repeat(30));
    expect(messageLine.endsWith('…')).toBe(true);
  });

  it('collapses multiline text into a single line', () => {
    const component = new QueuePaneComponent({
      isCompacting: false,
      isStreaming: true,
      canSteerImmediately: true,
      messages: [{ text: 'line one\nline two\nline three' }],
    });

    const lines = component.render(120);
    expect(lines).toHaveLength(4); // border + count + message + hint
    const messageLine = stripAnsi(lines[2] as string);
    expect(messageLine).toContain('line one line two line three');
    expect(messageLine).not.toContain('\n');
  });

  it('uses display text for hidden internal prompts', () => {
    const component = new QueuePaneComponent({
      isCompacting: false,
      isStreaming: true,
      canSteerImmediately: true,
      messages: [{ text: '<ultrawork_flow>secret contract</ultrawork_flow>', displayText: 'Ship feature X' }],
    });

    const output = stripAnsi(component.render(120).join('\n'));
    expect(output).toContain('❯ Ship feature X');
    expect(output).not.toContain('<ultrawork_flow>');
    expect(output).not.toContain('secret contract');
  });

  it('renders bash queued items with a $ prompt to distinguish them from text', () => {
    const component = new QueuePaneComponent({
      isCompacting: false,
      isStreaming: true,
      canSteerImmediately: false,
      messages: [{ text: 'ls -la', mode: 'bash' }],
    });

    const output = stripAnsi(component.render(120).join('\n'));
    expect(output).toContain('queue 1 · 1 shell');
    expect(output).toContain('❯ $ ls -la');
  });

  it('omits the steer hint when every queued item is a bash command', () => {
    const component = new QueuePaneComponent({
      isCompacting: false,
      isStreaming: true,
      canSteerImmediately: true,
      messages: [{ text: 'ls', mode: 'bash' }],
    });

    const output = stripAnsi(component.render(120).join('\n'));
    expect(output).not.toContain('ctrl-s to steer immediately');
    expect(output).toContain('will send after current task');
  });

  it('keeps the steer hint when at least one queued item is steerable', () => {
    const component = new QueuePaneComponent({
      isCompacting: false,
      isStreaming: true,
      canSteerImmediately: true,
      messages: [{ text: 'ls', mode: 'bash' }, { text: 'focus on tests' }],
    });

    const output = stripAnsi(component.render(120).join('\n'));
    expect(output).toContain('queue 2 · 1 prompt · 1 shell');
    expect(output).toContain('ctrl-s to steer immediately');
  });

  it('settle-flashes the selected (last) row under premium, then settles', () => {
    chalk.level = 3;
    enablePremiumAmbient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const settleSpy = vi.spyOn(appearanceEffects, 'renderSettleFlash');

    const component = new QueuePaneComponent({
      isCompacting: false,
      isStreaming: true,
      canSteerImmediately: true,
      messages: [{ text: 'first' }, { text: 'selected row' }],
      settleStartedAtMs: Date.now(),
    });

    const settling = stripAnsi(component.render(120).join('\n'));
    expect(settling).toContain('selected row');
    expect(settleSpy).toHaveBeenCalled();
    expect(String(settleSpy.mock.calls[0]?.[0])).toContain('selected row');

    settleSpy.mockClear();
    advanceAppearanceAnimationClock(Date.now() + SETTLE_FLASH_MS + 80);
    component.render(120);
    expect(settleSpy).not.toHaveBeenCalled();

    chalk.level = previousChalkLevel;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps host-owned settleStartedAtMs across remounts with the same selection', () => {
    chalk.level = 3;
    enablePremiumAmbient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
    const settleSpy = vi.spyOn(appearanceEffects, 'renderSettleFlash');

    const messages = [{ text: 'first' }, { text: 'selected row' }] as const;
    const selectedIndex = 1;
    const selectionIdentity = queuePaneSelectionIdentity(messages, selectedIndex);
    let host = resolveHostOwnedQueueSettleStartedAtMs({
      selectionIdentity,
      previousSelectionIdentity: undefined,
      previousSettleStartedAtMs: undefined,
      nowMs: Date.now(),
    });

    const first = new QueuePaneComponent({
      isCompacting: false,
      isStreaming: true,
      canSteerImmediately: true,
      messages,
      selectedIndex,
      settleStartedAtMs: host.settleStartedAtMs,
    });
    first.render(120);
    expect(settleSpy).toHaveBeenCalled();
    expect(settleSpy.mock.calls[0]?.[2]).toBe(host.settleStartedAtMs);

    // Remount after settle window with the same host clock — no restart.
    settleSpy.mockClear();
    const remountNow = Date.now() + SETTLE_FLASH_MS + 80;
    vi.setSystemTime(new Date(remountNow));
    advanceAppearanceAnimationClock(remountNow);
    host = resolveHostOwnedQueueSettleStartedAtMs({
      selectionIdentity,
      previousSelectionIdentity: host.selectionIdentity,
      previousSettleStartedAtMs: host.settleStartedAtMs,
      nowMs: remountNow,
    });
    expect(host.settleStartedAtMs).toBe(Date.now() - (SETTLE_FLASH_MS + 80));

    const remounted = new QueuePaneComponent({
      isCompacting: true, // host often remounts on unrelated state churn
      isStreaming: true,
      canSteerImmediately: true,
      messages,
      selectedIndex,
      settleStartedAtMs: host.settleStartedAtMs,
    });
    remounted.render(120);
    expect(settleSpy).not.toHaveBeenCalled();

    // New selection identity starts a fresh settle clock.
    const nextMessages = [...messages, { text: 'new last' }];
    const nextIndex = nextMessages.length - 1;
    const next = resolveHostOwnedQueueSettleStartedAtMs({
      selectionIdentity: queuePaneSelectionIdentity(nextMessages, nextIndex),
      previousSelectionIdentity: host.selectionIdentity,
      previousSettleStartedAtMs: host.settleStartedAtMs,
      nowMs: remountNow,
    });
    expect(next.settleStartedAtMs).toBe(remountNow);

    chalk.level = previousChalkLevel;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
