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
  /** Output rate tracking */
  private lastOutputTime = 0;
  private recentBytes = 0;
  private outputRate = 0;
  /** Bell flash effect */
  private bellFlashStart = 0;
  private static readonly BELL_FLASH_DURATION = 300;
  /** Environment overlay */
  private envOverlayOpen = false;
  /** Command execution time tracking */
  private cmdStartTime = 0;
  private cmdRunning = false;
  /** Output encoding detection */
  private hasNonUtf8 = false;
  /** Session start time for uptime display */
  private sessionStart = Date.now();
  /** Terminal output search */
  private searchQuery = '';
  private searchActive = false;
  /** Prompt detection for visual highlighting */
  private lastPromptLine = -1;
  /** Command history tracking */
  private commandHistory: string[] = [];
  private currentCmdBuffer = '';
  /** Whether buffer has been compressed (earlier output discarded) */
  private bufferCompressed = false;
  private totalLinesReceived = 0;
  /** Whether output syntax highlighting is enabled */
  private syntaxHighlight = true;

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
        `${this.exitCode === 0
          ? currentTheme.fg('success', '✓')
          : currentTheme.fg('error', '✗')} ${currentTheme.fg(this.exitCode === 0 ? 'success' : 'error', `Process exited with code ${String(this.exitCode ?? '?')}`)} ${currentTheme.dimFg('textMuted', "· 'r' to restart")}`,
      ].slice(0, height);
    }

    if (!this.pty) {
      return [
        `  ${currentTheme.fg('accent', '▶')} ${currentTheme.dimFg('textMuted', 'Starting shell...')}`,
        `  ${currentTheme.dimFg('textMuted', `(${this.detectShell().split('/').pop() ?? 'sh'} · ${this.cwd.split('/').slice(-2).join('/')})`)}`,
      ];
    }

    const visible = this.getVisibleLines(height);
    // Line count indicator in last row when buffer is large
    if (this.lines.length > 100 && visible.length > 0) {
      const lineCount = currentTheme.dimFg('textMuted', ` ${String(this.lines.length)}L`);
      const lastIdx = visible.length - 1;
      visible[lastIdx] = (visible[lastIdx] ?? '').slice(0, this.cols - 8) + lineCount;
    }
    // PID indicator in first row when PTY is active
    if (this.pty && visible.length > 0) {
      const encBadge = this.hasNonUtf8 ? currentTheme.fg('warning', ' ⚠enc') : '';
      // Session uptime (compact)
      const uptimeSec = Math.floor((Date.now() - this.sessionStart) / 1000);
      const uptimeLabel = uptimeSec < 60
        ? `${String(uptimeSec)}s`
        : uptimeSec < 3600
          ? `${String(Math.floor(uptimeSec / 60))}m`
          : `${String(Math.floor(uptimeSec / 3600))}h${String(Math.floor((uptimeSec % 3600) / 60))}m`;
      const cmdCount = this.commandHistory.length > 0 ? currentTheme.dimFg('textMuted', ` · ${String(this.commandHistory.length)}cmd`) : '';
      const compressBadge = this.bufferCompressed ? currentTheme.dimFg('textMuted', ` · ${String(this.totalLinesReceived)}L↑`) : '';
      const pidLabel = currentTheme.dimFg('textMuted', ` pid:${String(this.pty.pid)} · ${uptimeLabel}`) + cmdCount + compressBadge + encBadge;
      visible[0] = (visible[0] ?? '').slice(0, this.cols - 22) + pidLabel;
    }
    // Command execution time indicator
    const renderNow = Date.now();
    if (this.cmdRunning && renderNow - this.cmdStartTime > 500) {
      const elapsed = Math.round((renderNow - this.cmdStartTime) / 1000);
      const cmdTimeLabel = currentTheme.fg('accent', ` ⏱${String(elapsed)}s`);
      visible[visible.length - 1] = (visible[visible.length - 1] ?? '').slice(0, this.cols - 8) + cmdTimeLabel;
    }
    // Output rate indicator when actively streaming
    if (renderNow - this.lastOutputTime < 1000 && this.outputRate > 100) {
      const rateLabel = this.outputRate > 10000
        ? currentTheme.fg('accent', ` ${String(Math.round(this.outputRate / 1024))}KB/s`)
        : currentTheme.dimFg('textMuted', ` ${String(Math.round(this.outputRate))}B/s`);
      visible[visible.length - 1] = (visible[visible.length - 1] ?? '').slice(0, this.cols - 10) + rateLabel;
    }
    // Prompt line highlighting: subtle accent on the detected prompt line
    if (this.lastPromptLine >= 0) {
      const promptIdx = this.lastPromptLine - this.scrollTop;
      if (promptIdx >= 0 && promptIdx < visible.length) {
        const promptLine = visible[promptIdx] ?? '';
        // Add a subtle accent marker at the start of the prompt line
        visible[promptIdx] = currentTheme.fg('accent', '▎') + promptLine.slice(1);
      }
    }

    // Search bar overlay (Ctrl+F)
    if (this.searchActive && visible.length > 0) {
      const searchLabel = currentTheme.fg('primary', `/${this.searchQuery}`) + currentTheme.fg('primary', '▏');
      visible[0] = searchLabel + ' '.repeat(Math.max(0, this.cols - this.searchQuery.length - 2));
    }

    // Environment overlay (Ctrl+E)
    if (this.envOverlayOpen) {
      const envKeys = ['SHELL', 'TERM', 'PATH', 'HOME', 'USER', 'NODE_VERSION', 'PWD'];
      const envLines = envKeys
        .filter((k) => process.env[k] !== undefined)
        .map((k) => {
          const val = process.env[k]!;
          const shortVal = val.length > this.cols - 14 ? val.slice(0, this.cols - 17) + '…' : val;
          return `  ${currentTheme.fg('accent', k)}=${currentTheme.dimFg('textMuted', shortVal)}`;
        });
      const header = currentTheme.boldFg('primary', ' Environment (Ctrl+E to close)');
      const overlay = [header, ...envLines];
      // Overlay on top of visible content
      for (let i = 0; i < overlay.length && i < visible.length; i++) {
        visible[i] = (overlay[i] ?? '').slice(0, this.cols);
      }
    }

    // Bell flash overlay: brief border flash when bell is received
    const bellAge = Date.now() - this.bellFlashStart;
    if (bellAge < TerminalPanel.BELL_FLASH_DURATION && visible.length > 0) {
      const intensity = 1 - bellAge / TerminalPanel.BELL_FLASH_DURATION;
      const flashChar = intensity > 0.5 ? '█' : '▓';
      const flashColor = currentTheme.fg('warning', flashChar);
      // Flash the top-right corner
      const lastLine = visible.length - 1;
      visible[lastLine] = (visible[lastLine] ?? '').slice(0, this.cols - 2) + flashColor;
    }
    return visible;
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

      // Ctrl+L: clear terminal buffer
      if (event.ctrl && event.key === 'character' && event.text === 'l') {
        this.lines = [''];
        this.scrollTop = 0;
        this.followTail = true;
        return true;
      }

      // Ctrl+E: toggle environment overlay
      if (event.ctrl && event.key === 'character' && event.text === 'e') {
        this.envOverlayOpen = !this.envOverlayOpen;
        return true;
      }

      // Ctrl+F: toggle output search
      if (event.ctrl && event.key === 'character' && event.text === 'f') {
        this.searchActive = !this.searchActive;
        if (!this.searchActive) this.searchQuery = '';
        return true;
      }

      // Ctrl+H: toggle output syntax highlighting
      if (event.ctrl && event.key === 'character' && event.text === 'h') {
        this.syntaxHighlight = !this.syntaxHighlight;
        return true;
      }

      // Handle search input when search is active
      if (this.searchActive && event.key === 'character' && event.text !== undefined && !event.ctrl) {
        if (event.key === 'escape') {
          this.searchActive = false;
          this.searchQuery = '';
          return true;
        }
        this.searchQuery += event.text;
        // Scroll to first match
        this.scrollToMatch();
        return true;
      }
      if (this.searchActive && event.key === 'backspace') {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.scrollToMatch();
        return true;
      }
      if (this.searchActive && event.key === 'escape') {
        this.searchActive = false;
        this.searchQuery = '';
        return true;
      }

      if (!this.pty || this.exited) return false;

      // Track command execution timing and history
      if (event.key === 'enter') {
        this.cmdStartTime = Date.now();
        this.cmdRunning = true;
        // Capture the current line as a command
        const currentLine = this.lines[this.lines.length - 1] ?? '';
        const cmdMatch = currentLine.match(/[$❯%>]\s*(.+)$/);
        if (cmdMatch && cmdMatch[1] && cmdMatch[1].trim().length > 0) {
          this.commandHistory.push(cmdMatch[1].trim());
          if (this.commandHistory.length > 50) this.commandHistory = this.commandHistory.slice(-50);
        }
      }

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
        `  ${currentTheme.boldFg('error', 'Failed to start terminal.')}`,
        `  ${currentTheme.fg('error', `Error: ${err instanceof Error ? err.message : String(err)}`)}`,
        `  ${currentTheme.dimFg('textMuted', 'Ensure node-pty is installed.')}`,
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

    // Detect command completion: output arriving after Enter was pressed
    if (this.cmdRunning && Date.now() - this.cmdStartTime > 100) {
      this.cmdRunning = false;
    }

    // Track output rate
    const rateNow = Date.now();
    const rateElapsed = rateNow - this.lastOutputTime;
    if (rateElapsed > 0 && rateElapsed < 2000) {
      this.outputRate = (this.recentBytes + data.length) / (rateElapsed / 1000);
    }
    this.recentBytes = data.length;
    this.lastOutputTime = rateNow;

    // Detect bell character (\x07) for flash effect
    if (data.includes('\x07')) {
      this.bellFlashStart = Date.now();
    }

    // Detect non-UTF8 or binary output
    if (!this.hasNonUtf8 && /[\x80-\xFF]{3,}/.test(data) && !data.includes('\x1b')) {
      this.hasNonUtf8 = true;
    }

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
    this.totalLinesReceived += parts.length - 1; // Count newlines received
    if (this.lines.length > MAX_LINES) {
      this.lines = this.lines.slice(this.lines.length - MAX_LINES);
      this.bufferCompressed = true;
    }

    // Detect shell prompt line for visual highlighting
    const promptLineStr = this.lines[this.lines.length - 1] ?? '';
    if (/^\s*[\$❯%>]\s*$/.test(promptLineStr) || /\$\s*$/.test(promptLineStr) || /❯\s*$/.test(promptLineStr)) {
      this.lastPromptLine = this.lines.length - 1;
    }

    // Auto-scroll to bottom
    if (this.followTail) {
      this.scrollTop = Math.max(0, this.lines.length - this.rows);
    }
  }

  /** Scroll to the first line matching the search query. */
  private scrollToMatch(): void {
    if (this.searchQuery.length === 0) return;
    const lowerQuery = this.searchQuery.toLowerCase();
    for (let i = 0; i < this.lines.length; i++) {
      if ((this.lines[i] ?? '').toLowerCase().includes(lowerQuery)) {
        this.scrollTop = Math.max(0, i - 2);
        this.followTail = false;
        return;
      }
    }
  }

  private getVisibleLines(height: number): string[] {
    const start = Math.max(0, Math.min(this.scrollTop, this.lines.length - 1));
    const visible = this.lines.slice(start, start + height);

    // Pad to fill height
    while (visible.length < height) {
      visible.push('');
    }

    const result = visible.map((line) => {
      let l = (line ?? '').slice(0, this.cols);
      // Syntax highlighting for common output patterns
      if (this.syntaxHighlight && l.length > 0) {
        // Error patterns (Error:, error:, ERR!, ✗, FAILED)
        if (/\b(Error|error|ERR!|FAILED|✗|fatal)\b/.test(l)) {
          l = currentTheme.fg('error', l);
        }
        // Warning patterns (Warning:, warn:, ⚠)
        else if (/\b(Warning|warn|⚠|WARN)\b/.test(l)) {
          l = currentTheme.fg('warning', l);
        }
        // Success patterns (✓, done, OK, passed)
        else if (/\b(✓|done|OK|passed|success)\b/.test(l)) {
          l = currentTheme.fg('success', l);
        }
      }
      // Highlight search matches
      if (this.searchActive && this.searchQuery.length > 0) {
        const idx = l.toLowerCase().indexOf(this.searchQuery.toLowerCase());
        if (idx !== -1) {
          const before = l.slice(0, idx);
          const match = l.slice(idx, idx + this.searchQuery.length);
          const after = l.slice(idx + this.searchQuery.length);
          l = before + currentTheme.bg('selectionBg', currentTheme.fg('selectionText', match)) + after;
        }
      }
      return l;
    });

    // Scroll position indicator when not following tail
    if (!this.followTail && this.lines.length > height) {
      const maxScroll = Math.max(1, this.lines.length - height);
      const pct = Math.round((this.scrollTop / maxScroll) * 100);
      const indicator = currentTheme.fg('accent', ` ↑${String(pct)}% `);
      // Place indicator in the top-right corner
      const lastIdx = result.length - 1;
      if (lastIdx >= 0) {
        const pad = Math.max(0, this.cols - 6);
        result[0] = (result[0] ?? '').slice(0, pad) + indicator;
      }
      // Mini scroll region bar (right edge, 1 char per visible region)
      const barHeight = Math.min(result.length, 8);
      const barPos = Math.round((this.scrollTop / maxScroll) * (barHeight - 1));
      for (let i = 0; i < barHeight && i < result.length; i++) {
        const barChar = i === barPos ? '█' : '░';
        const barColor = i === barPos ? currentTheme.fg('accent', barChar) : currentTheme.dimFg('border', barChar);
        result[i] = (result[i] ?? '').slice(0, this.cols - 1) + barColor;
      }
    }

    return result;
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
