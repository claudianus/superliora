import { describe, it, expect } from 'vitest';

import { highlightRendererEditorSlashToken } from '#/tui/renderer';

const paint = (text: string): string => `\u001B[1m${text}\u001B[0m`;

function highlightFirstSlashToken(line: string): string | undefined {
  return highlightRendererEditorSlashToken(line, paint);
}

function strip(s: string): string {
  return s.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function expectHighlighted(out: string, token: string): void {
  expect(out).toMatch(new RegExp(`\\u001B\\[[0-9;]*m${token}\\u001B\\[`));
}

describe('highlightFirstSlashToken', () => {
  it('colours /cmd when line starts with a slash', () => {
    const out = highlightFirstSlashToken('  /help rest of input');
    expect(out).toBeDefined();
    // Visible text unchanged
    expect(strip(out!)).toBe('  /help rest of input');
    // SGR escapes surround /help
    expectHighlighted(out!, '/help');
  });

  it('colours next in /goal next', () => {
    const out = highlightFirstSlashToken('/goal next Ship feature X');
    expect(out).toBeDefined();
    expect(strip(out!)).toBe('/goal next Ship feature X');
    expectHighlighted(out!, '/goal');
    expectHighlighted(out!, 'next');
    expect(out!).toContain(' Ship feature X');
  });

  it('colours manage in /goal next manage', () => {
    const out = highlightFirstSlashToken('/goal next manage');
    expect(out).toBeDefined();
    expect(strip(out!)).toBe('/goal next manage');
    expectHighlighted(out!, '/goal');
    expectHighlighted(out!, 'next');
    expectHighlighted(out!, 'manage');
  });

  it('returns undefined when the line has no slash', () => {
    expect(highlightFirstSlashToken('hello world')).toBeUndefined();
  });

  it('returns undefined when slash is not at the leading position', () => {
    expect(highlightFirstSlashToken('  hello /not-cmd')).toBeUndefined();
  });

  it('returns undefined for path-like slash tokens', () => {
    expect(highlightFirstSlashToken('/user/desktop/ foo')).toBeUndefined();
  });

  it('handles /token at end of line (no trailing whitespace)', () => {
    const out = highlightFirstSlashToken('/exit');
    expect(out).toBeDefined();
    expect(strip(out!)).toBe('/exit');
  });

  it('passes through pre-existing ANSI (e.g. cursor inverse) in the tail', () => {
    // Simulate pi-tui Editor inserting an inverse-video cursor marker
    // somewhere after the slash token.
    const line = '/help x\u001B[7m \u001B[0m';
    const out = highlightFirstSlashToken(line);
    expect(out).toBeDefined();
    // Stripped visible content unchanged
    expect(strip(out!)).toBe(strip(line));
    // Inverse cursor SGR is still present afterwards
    expect(out!.includes('\u001B[7m')).toBe(true);
  });

  it('only paints the first token, not other slashes further along', () => {
    const out = highlightFirstSlashToken('/a /b');
    expect(out).toBeDefined();
    // Count the SGR opens — should be exactly one for /a.
    const opens = (out!.match(/\u001B\[[0-9;]+m/g) ?? []).length;
    expect(opens).toBeGreaterThanOrEqual(2); // chalk bold+fg open and reset(s)
    // /b should remain plain — the substring " /b" exists verbatim.
    expect(out!).toContain(' /b');
  });
});
