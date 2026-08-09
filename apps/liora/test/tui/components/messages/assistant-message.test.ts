import { Markdown, visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantMessageComponent } from '#/tui/components/messages/assistant-message';
import * as codeHighlight from '#/tui/components/media/code-highlight';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { createMarkdownTheme } from '#/tui/theme/pi-tui-theme';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';
import { TURN_BOUNDARY_CUE_MS } from '#/tui/features/transcript/transcript-entrance';
import { setActiveTranscriptDetail } from '#/tui/features/transcript/transcript-density';

import { captureProcessWrite } from '../../../helpers/process';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('AssistantMessageComponent', () => {
  it('defines the shared status bullet as a stable non-emoji glyph', () => {
    expect(STATUS_BULLET).toBe('● ');
    expect(visibleWidth(STATUS_BULLET)).toBe(2);
  });

  it('uses the stable status bullet without stealing content width', () => {
    const component = new AssistantMessageComponent();

    component.updateContent('abcdef');

    const lines = component.render(8).map(strip);
    // Leading blank + answer phase chrome + bullet content.
    expect(lines.some((line) => line.includes('answer'))).toBe(true);
    const content = lines.find((line) => line.includes('abcdef'));
    expect(content).toBeDefined();
    expect(content).toContain(STATUS_BULLET.trimEnd());
    expect(visibleWidth(content!)).toBeLessThanOrEqual(8);
  });

  it('keeps one untinted blank above and below the answer body', () => {
    const component = new AssistantMessageComponent();
    component.updateContent('hello breath');
    const lines = component.render(40).map(strip);
    expect(lines[0]).toBe('');
    expect(lines[lines.length - 1]).toBe('');
    expect(lines.some((line) => line.includes('hello breath'))).toBe(true);
  });

  it('keeps assistant lines within very narrow widths', () => {
    const component = new AssistantMessageComponent();
    component.updateContent('abcdef');

    for (const width of [1, 2, 4, 10, 39]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('renders unknown markdown fence languages as plain text without stderr noise', () => {
    const stderr = captureProcessWrite('stderr');
    try {
      const theme = createMarkdownTheme();
      expect(theme.highlightCode?.('hello\nworld', 'abcxyz')).toEqual(['hello', 'world']);
      expect(stderr.text()).not.toContain('Could not find the language');
    } finally {
      stderr.restore();
    }
  });

  it('preserves literal hook result XML in normal assistant text', () => {
    const component = new AssistantMessageComponent();

    component.updateContent('<hook_result hook_event="UserPromptSubmit">\n{}\n</hook_result>');

    const text = component.render(80).map(strip).join('\n');
    expect(text).toContain('<hook_result hook_event="UserPromptSubmit">');
    expect(text).toContain('{}');
    expect(text).toContain('</hook_result>');
    expect(text).not.toContain('UserPromptSubmit hook');
  });

  it('reuses the same Markdown child across streaming text updates', () => {
    const component = new AssistantMessageComponent();

    component.updateContent('hello');
    const first = (component as any).contentContainer.children[0];
    expect(first).toBeInstanceOf(Markdown);

    component.updateContent('hello world');
    const second = (component as any).contentContainer.children[0];

    expect(second).toBe(first);
    expect(strip(component.render(80).join('\n'))).toContain('hello world');
  });

  it('does not recreate the Markdown child when the text is unchanged', () => {
    const component = new AssistantMessageComponent();

    component.updateContent('hello');
    const first = (component as any).contentContainer.children[0];
    expect(first).toBeInstanceOf(Markdown);

    component.updateContent('hello');
    const second = (component as any).contentContainer.children[0];

    expect(second).toBe(first);
  });

  it('reuses rendered line arrays at the same width until content changes', () => {
    const component = new AssistantMessageComponent();

    component.updateContent('hello');
    const first = component.render(80);
    const second = component.render(80);

    expect(second).toBe(first);

    component.updateContent('hello world');
    expect(component.render(80)).not.toBe(first);
  });

  it('rebuilds the Markdown child when transient changes so final render can highlight code', () => {
    const component = new AssistantMessageComponent();
    const code = '```ts\nconst x = 1\n```';

    component.updateContent(code, { transient: true });
    const streaming = (component as any).contentContainer.children[0];
    expect(streaming).toBeInstanceOf(Markdown);

    component.updateContent(code, { transient: false });
    const finalized = (component as any).contentContainer.children[0];
    expect(finalized).toBeInstanceOf(Markdown);

    expect(finalized).not.toBe(streaming);
  });

  it('skips synchronous syntax highlighting in transient markdown themes', () => {
    const highlightSpy = vi.spyOn(codeHighlight, 'highlightLines');
    try {
      const streamingTheme = createMarkdownTheme({ transient: true });
      const finalTheme = createMarkdownTheme();
      const code = 'const x = 1';

      expect(streamingTheme.highlightCode?.(code, 'typescript')).toEqual([code]);
      expect(highlightSpy).not.toHaveBeenCalled();

      finalTheme.highlightCode?.(code, 'typescript');
      expect(highlightSpy).toHaveBeenCalled();
    } finally {
      highlightSpy.mockRestore();
    }
  });

  it('shows a pulsing caret at the end of the content while streaming', () => {
    const previousEnv = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
    };
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];

    try {
      const component = new AssistantMessageComponent();
      component.updateContent('hello world', { transient: true });
      const lines = component.render(40).map(strip);
      const lastContent = lines.filter((line) => line.trim().length > 0).at(-1) ?? '';
      // Kinetic streaming caret: dual micro-trail + block glyph (▌).
      expect(lastContent).toContain('▌');
      expect(lastContent).toContain('hello world');
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('hides the caret once the message is finalized', () => {
    const previousEnv = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
    };
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];

    try {
      const component = new AssistantMessageComponent();
      component.updateContent('hello world', { transient: false });
      const lines = component.render(40).map(strip);
      const lastContent = lines.filter((line) => line.trim().length > 0).at(-1) ?? '';
      expect(lastContent).not.toContain('▍');
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('renders the full multi-line answer body at minimal density (no 4-line collapse)', () => {
    setActiveTranscriptDetail('minimal');
    try {
      const component = new AssistantMessageComponent();
      // Separate paragraphs so Markdown keeps each marker on its own block
      // (single newlines soft-wrap into one paragraph).
      const body = [
        'ANSWER_MARK_ONE unique opener for the full answer body',
        'ANSWER_MARK_TWO second paragraph of the answer body',
        'ANSWER_MARK_THREE third paragraph of the answer body',
        'ANSWER_MARK_FOUR fourth paragraph of the answer body',
        'ANSWER_MARK_FIVE fifth paragraph of the answer body',
        'ANSWER_MARK_SIX sixth paragraph of the answer body',
        'ANSWER_MARK_SEVEN seventh paragraph of the answer body',
      ].join('\n\n');
      component.updateContent(body, { transient: false });
      const out = strip(component.render(80).join('\n'));
      expect(out).toContain('ANSWER_MARK_ONE');
      expect(out).toContain('ANSWER_MARK_SEVEN');
      expect(out).not.toMatch(/more lines/i);
      expect(out).not.toMatch(/Ctrl\+O full/i);
      // Collapse used to keep ~4 non-empty chrome/content lines; full body is longer.
      const contentLines = out.split('\n').filter((line) => line.trim().length > 0);
      expect(contentLines.length).toBeGreaterThan(5);
    } finally {
      setActiveTranscriptDetail('standard');
    }
  });

  it('keeps the full streaming answer body at minimal density', () => {
    const previousEnv = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
    };
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];

    setActiveTranscriptDetail('minimal');
    try {
      const component = new AssistantMessageComponent();
      const body = [
        'STREAM_MARK_ONE unique streaming opener paragraph',
        'STREAM_MARK_TWO second streaming paragraph body',
        'STREAM_MARK_THREE third streaming paragraph body',
        'STREAM_MARK_FOUR fourth streaming paragraph body',
        'STREAM_MARK_FIVE fifth streaming paragraph body',
        'STREAM_MARK_SIX sixth streaming paragraph body',
      ].join('\n\n');
      component.updateContent(body, { transient: true });
      const out = strip(component.render(80).join('\n'));
      expect(out).toContain('STREAM_MARK_ONE');
      expect(out).toContain('STREAM_MARK_SIX');
      expect(out).not.toMatch(/more lines/i);
      expect(out).not.toMatch(/Ctrl\+O full/i);
      const contentLines = out.split('\n').filter((line) => line.trim().length > 0);
      expect(contentLines.length).toBeGreaterThan(5);
    } finally {
      setActiveTranscriptDetail('standard');
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('AssistantMessageComponent turn boundary cues', () => {
  const previousEnv = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };
  const previousChalkLevel = chalk.level;
  const premium = {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium' as const,
    particles: 'premium' as const,
  };

  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    chalk.level = 3;
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences(premium);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
    chalk.level = previousChalkLevel;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function mountedPair(text: string): {
    withCue: AssistantMessageComponent;
    plain: AssistantMessageComponent;
  } {
    // Same clock tick → identical entrance wash; only the cue may differ.
    const withCue = new AssistantMessageComponent();
    const plain = new AssistantMessageComponent();
    withCue.updateContent(text);
    plain.updateContent(text);
    return { withCue, plain };
  }

  function firstVisibleIndex(lines: readonly string[]): number {
    return lines.findIndex((line) => line.trim().length > 0);
  }

  function lastVisibleIndex(lines: readonly string[]): number {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.trim().length > 0) return i;
    }
    return -1;
  }

  it('turn start cue is active at t0 and settles byte-identical after the window', () => {
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const { withCue, plain } = mountedPair('line one\n\nline two');
    withCue.markTurnStartCue(start);

    const active = withCue.render(80);
    const baseline = plain.render(80);
    expect(strip(active.join('\n'))).toContain('line one');
    expect(active).not.toEqual(baseline);

    // The cue lands on the first visible line only; the rest matches the
    // baseline wash byte-for-byte at the same clock.
    const first = firstVisibleIndex(active);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(active[first]).not.toBe(baseline[first]);
    expect(active.slice(first + 1)).toEqual(baseline.slice(first + 1));

    // Past the bounded window the block is byte-stable again.
    vi.setSystemTime(new Date(start + TURN_BOUNDARY_CUE_MS + 60));
    advanceAppearanceAnimationClock(Date.now());
    expect(withCue.render(80)).toEqual(plain.render(80));
  });

  it('turn end cue settles the last visible line only', () => {
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const { withCue, plain } = mountedPair('line one\n\nline two');
    withCue.markTurnEndCue(start);

    const active = withCue.render(80);
    const baseline = plain.render(80);
    const last = lastVisibleIndex(active);
    expect(last).toBeGreaterThan(firstVisibleIndex(active));
    expect(active[last]).not.toBe(baseline[last]);
    expect(active.slice(0, last)).toEqual(baseline.slice(0, last));

    vi.setSystemTime(new Date(start + TURN_BOUNDARY_CUE_MS + 60));
    advanceAppearanceAnimationClock(Date.now());
    expect(withCue.render(80)).toEqual(plain.render(80));
  });

  it('quality off renders no cue bytes (byte-identical to an unarmed block)', () => {
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off',
      particles: 'off',
      animationFps: 0,
    });
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const { withCue, plain } = mountedPair('line one\n\nline two');
    withCue.markTurnStartCue(start);
    withCue.markTurnEndCue(start);

    expect(withCue.render(80)).toEqual(plain.render(80));
  });
});
