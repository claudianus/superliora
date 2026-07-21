import * as os from 'node:os';

import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';
import { currentTheme } from '#/tui/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PtyLike {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number) => void): void;
  kill(): void;
  readonly pid: number;
}

// ---------------------------------------------------------------------------
// TerminalPanel
// ---------------------------------------------------------------------------

export class TerminalPanel implements PanelDefinition {
  readonly id = 'terminal';
  readonly title = 'Terminal';
  readonly icon = '>';
  readonly minWidth = 30;
  readonly minHeight = 5;

  private pty: PtyLike | null = null;
  private lines: string[] = [''];
  private scrollTop = 0;
  private followTail = true;
  private cols = 80;
  private rows = 24;
  private exited = false;
  private exitCode: number | null = null;
  private readonly cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, _focused: boolean): string[] {
    this.cols = width;
    this.rows = height;

    // Resize PTY if needed
    if (this.pty && !this.exited) {
      try {
        this.pty.resize(width, height);
      } catch {
        // PTY may have been destroyed
      }
    }

    if (this.exited) {
      return [
        ...this.getVisibleLines(height),
        '',
        dim(`[Process exited with code ${this.exitCode ?? '?'}] Press 'r' to restart`),
      ].slice(0, height);
    }

    if (!this.pty) {
      return [dim('  Starting shell...')];
    }

    return this.getVisibleLines(height);
  }

  onInput(event: NativeInputEvent): boolean {
    // Mouse wheel support for scrolling terminal output
    if (event.type === 'mouse' && event.action === 'wheel') {
      if (event.button === 'wheel-up') {
        this.scrollTop = Math.max(0, this.scrollTop - 3);
        this.followTail = false;
        return true;
      }
      if (event.button === 'wheel-down') {
        this.scrollTop += 3;
        if (this.scrollTop >= Math.max(0, this.lines.length - this.rows)) {
          this.followTail = true;
        }
        return true;
      }
      return false;
    }

    if (event.type === 'key') {
      // Restart on 'r' when exited
      if (this.exited && event.key === 'character' && event.text === 'r') {
        this.spawnPty();
        return true;
      }

      if (!this.pty || this.exited) return false;

      // Convert key event to terminal input
      const data = keyEventToTerminalInput(event);
      if (data) {
        this.pty.write(data);
        return true;
      }
      return false;
    }

    if (event.type === 'paste') {
      if (this.pty && !this.exited) {
        this.pty.write(event.text);
        return true;
      }
      return false;
    }

    return false;
  }

  onFocus(): void {
    // Ensure PTY is spawned when focused
    if (!this.pty && !this.exited) {
      this.spawnPty();
    }
  }

  dispose(): void {
    if (this.pty) {
      try {
        this.pty.kill();
      } catch {
        // Already dead
      }
      this.pty = null;
    }
  }

  // -------------------------------------------------------------------------
  // PTY management
  // -------------------------------------------------------------------------

  private spawnPty(): void {
    this.exited = false;
    this.exitCode = null;
    this.lines = [''];
    this.scrollTop = 0;
    this.followTail = true;

    try {
      // Dynamic import to avoid issues if node-pty is not available
      const nodePty = require('node-pty') as typeof import('node-pty');
      const shell = this.detectShell();
      const shellArgs = this.getShellArgs(shell);

      const pty = nodePty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols: this.cols,
        rows: this.rows,
        cwd: this.cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>,
      });

      this.pty = pty as unknown as PtyLike;

      pty.onData((data: string) => {
        this.handlePtyOutput(data);
      });

      pty.onExit(({ exitCode }: { exitCode: number }) => {
        this.exited = true;
        this.exitCode = exitCode;
        this.pty = null;
      });
    } catch (err) {
      this.lines = [
        dim('  Failed to start terminal.'),
        dim(`  Error: ${err instanceof Error ? err.message : String(err)}`),
        dim('  Ensure node-pty is installed.'),
      ];
    }
  }

  private detectShell(): string {
    if (process.platform === 'win32') {
      return process.env['COMSPEC'] ?? 'cmd.exe';
    }
    return process.env['SHELL'] ?? '/bin/bash';
  }

  private getShellArgs(shell: string): string[] {
    if (shell.includes('zsh')) return ['--interactive'];
    if (shell.includes('bash')) return ['--login'];
    if (shell.includes('fish')) return ['--interactive'];
    return [];
  }

  // -------------------------------------------------------------------------
  // Output handling
  // -------------------------------------------------------------------------

  private handlePtyOutput(data: string): void {
    // Simple terminal output handling:
    // Split by newlines and append to buffer
    // This is a simplified renderer - full ANSI parsing would be more complex

    const parts = data.split('\n');

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;

      if (i === 0) {
        // Append to current last line
        this.lines[this.lines.length - 1] = (this.lines[this.lines.length - 1] ?? '') + stripAnsi(part);
      } else {
        // New line
        this.lines.push(stripAnsi(part));
      }
    }

    // Handle carriage return (overwrite current line)
    const lastLine = this.lines[this.lines.length - 1] ?? '';
    if (lastLine.includes('\r')) {
      const segments = lastLine.split('\r');
      this.lines[this.lines.length - 1] = segments[segments.length - 1] ?? '';
    }

    // Cap buffer size
    const MAX_LINES = 1000;
    if (this.lines.length > MAX_LINES) {
      this.lines = this.lines.slice(this.lines.length - MAX_LINES);
    }

    // Auto-scroll to bottom
    if (this.followTail) {
      this.scrollTop = Math.max(0, this.lines.length - this.rows);
    }
  }

  private getVisibleLines(height: number): string[] {
    const start = Math.max(0, Math.min(this.scrollTop, this.lines.length - 1));
    const visible = this.lines.slice(start, start + height);

    // Pad to fill height
    while (visible.length < height) {
      visible.push('');
    }

    return visible.map((line) => (line ?? '').slice(0, this.cols));
  }
}

// ---------------------------------------------------------------------------
// Key event → terminal input conversion
// ---------------------------------------------------------------------------

function keyEventToTerminalInput(event: import('@harness-kit/tui-renderer').NativeInputKeyEvent): string | null {
  const { key, ctrl, alt, text } = event;

  // Control characters
  if (ctrl && text && text.length === 1) {
    const code = text.toLowerCase().charCodeAt(0) - 96;
    if (code >= 0 && code <= 31) {
      return String.fromCharCode(code);
    }
  }

  switch (key) {
    case 'enter':
      return '\r';
    case 'backspace':
      return '\x7f';
    case 'tab':
      return '\t';
    case 'escape':
      return '\x1b';
    case 'up':
      return '\x1b[A';
    case 'down':
      return '\x1b[B';
    case 'right':
      return '\x1b[C';
    case 'left':
      return '\x1b[D';
    case 'home':
      return '\x1b[H';
    case 'end':
      return '\x1b[F';
    case 'pageup':
      return '\x1b[5~';
    case 'pagedown':
      return '\x1b[6~';
    case 'delete':
      return '\x1b[3~';
    case 'insert':
      return '\x1b[2~';
    case 'f1':
      return '\x1bOP';
    case 'f2':
      return '\x1bOQ';
    case 'f3':
      return '\x1bOR';
    case 'f4':
      return '\x1bOS';
    case 'f5':
      return '\x1b[15~';
    case 'f6':
      return '\x1b[17~';
    case 'f7':
      return '\x1b[18~';
    case 'f8':
      return '\x1b[19~';
    case 'f9':
      return '\x1b[20~';
    case 'f10':
      return '\x1b[21~';
    case 'f11':
      return '\x1b[23~';
    case 'f12':
      return '\x1b[24~';
    case 'character':
      if (text) {
        return alt ? `\x1b${text}` : text;
      }
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

function dim(text: string): string {
  return currentTheme.dimFg('textDim', text);
}
