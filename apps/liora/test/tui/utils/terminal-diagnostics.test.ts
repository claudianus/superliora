import { describe, expect, it } from 'vitest';

import {
  collectTerminalDiagnostics,
  formatTerminalDiagnosticsLines,
} from '#/tui/utils/terminal-diagnostics';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('collectTerminalDiagnostics', () => {
  it('detects kitty with truecolor and explains the KITTY_WINDOW_ID signal', () => {
    const report = collectTerminalDiagnostics({
      TERM: 'xterm-kitty',
      KITTY_WINDOW_ID: '1',
      COLORTERM: 'truecolor',
    });

    expect(report.colorMode).toBe('truecolor');
    expect(report.imageProtocol).toBe('kitty');
    expect(report.terminal.multiplexer).toBeNull();
    expect(report.colorSignals).toContain('COLORTERM=truecolor');
    expect(report.imageSignals).toContain('KITTY_WINDOW_ID set');
    expect(report.features).toContainEqual({ name: 'keyboard protocol', enabled: true });
    expect(report.features).toContainEqual({ name: 'interactive', enabled: true });
  });

  it('detects the kitty image protocol from TERM on ghostty', () => {
    const report = collectTerminalDiagnostics({ TERM: 'ghostty' });

    expect(report.imageProtocol).toBe('kitty');
    expect(report.colorMode).toBe('truecolor');
    expect(report.imageSignals).toContain("TERM contains 'ghostty'");
  });

  it('detects the iterm2 image protocol from TERM_PROGRAM', () => {
    const report = collectTerminalDiagnostics({ TERM_PROGRAM: 'iTerm.app' });

    expect(report.imageProtocol).toBe('iterm2');
    expect(report.imageSignals).toContain("TERM_PROGRAM contains 'iterm'");
  });

  it('reports colorMode none when NO_COLOR is set', () => {
    const report = collectTerminalDiagnostics({
      TERM: 'xterm-256color',
      NO_COLOR: '1',
    });

    expect(report.colorMode).toBe('none');
    expect(report.colorSignals).toContain('NO_COLOR set');
  });

  it('lets FORCE_COLOR=3 win over NO_COLOR', () => {
    const report = collectTerminalDiagnostics({
      FORCE_COLOR: '3',
      NO_COLOR: '1',
    });

    expect(report.colorMode).toBe('truecolor');
    expect(report.colorSignals).toContain('FORCE_COLOR=3');
  });

  it('disables images inside tmux and flags the passthrough gate', () => {
    const report = collectTerminalDiagnostics({
      TMUX: '/tmp/tmux-501/default,1234,0',
      TERM: 'xterm-kitty',
      KITTY_WINDOW_ID: '1',
    });

    expect(report.imageProtocol).toBe('none');
    expect(report.terminal.multiplexer).toBe('tmux');
    expect(report.imageSignals.some((signal) => signal.includes('passthrough'))).toBe(true);
  });

  it('turns features off in a non-interactive CI environment', () => {
    const report = collectTerminalDiagnostics({ CI: '1', TERM: 'xterm-kitty' });

    expect(report.colorMode).toBe('none');
    expect(report.imageProtocol).toBe('none');
    expect(report.features).toContainEqual({ name: 'interactive', enabled: false });
    expect(report.features).toContainEqual({ name: 'mouse tracking', enabled: false });
  });
});

describe('formatTerminalDiagnosticsLines', () => {
  it('renders effective values as dense aligned rows', () => {
    const report = collectTerminalDiagnostics({
      TERM: 'xterm-kitty',
      KITTY_WINDOW_ID: '1',
      COLORTERM: 'truecolor',
    });

    const plain = formatTerminalDiagnosticsLines(report).map(strip);
    const joined = plain.join('\n');

    expect(joined).toContain('xterm-kitty');
    expect(joined).toContain('TERM=xterm-kitty');
    expect(joined).toContain('truecolor');
    expect(joined).toContain('COLORTERM=truecolor');
    expect(joined).toContain('kitty');
    expect(joined).toContain('KITTY_WINDOW_ID set');
    expect(joined).toContain('keyboard protocol');
    expect(joined).toContain('synchronized output');
    expect(joined.match(/\bon\b/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('shows the tmux multiplexer note and muted none values', () => {
    const report = collectTerminalDiagnostics({
      TMUX: '/tmp/tmux-501/default,1234,0',
      TERM: 'xterm-kitty',
      KITTY_WINDOW_ID: '1',
    });

    const joined = formatTerminalDiagnosticsLines(report).map(strip).join('\n');

    expect(joined).toContain('tmux');
    expect(joined).toContain('allow-passthrough');
    expect(joined).toMatch(/images\s+none/);
  });

  it('keeps labels aligned across rows', () => {
    const report = collectTerminalDiagnostics({ TERM: 'xterm-256color' });

    const plain = formatTerminalDiagnosticsLines(report).map(strip);

    expect(plain[0]?.startsWith('terminal')).toBe(true);
    // Every row pads its label to the same column before the value starts.
    for (const line of plain) {
      expect(line.charAt(19)).toBe(' ');
      expect(line.charAt(20)).not.toBe(' ');
      expect(line.charAt(20)).not.toBe('');
    }
  });
});
