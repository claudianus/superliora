import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import type { PanelDefinition } from '../panel-definition';
import { currentTheme } from '#/tui/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SideChatCallbacks {
  /** Send a message to the agent. Returns true if accepted. */
  sendMessage(text: string): boolean;
  /** Whether the agent is currently busy (streaming). */
  isBusy(): boolean;
}

interface ChatMessage {
  readonly id: number;
  readonly role: 'user' | 'status';
  readonly text: string;
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// SideChatPanel
// ---------------------------------------------------------------------------

let nextMsgId = 1;

export class SideChatPanel implements PanelDefinition {
  readonly id = 'side-chat';
  readonly title = 'Quick Chat';
  readonly icon = '💬';
  readonly minWidth = 28;
  readonly minHeight = 8;

  private readonly callbacks: SideChatCallbacks;
  private messages: ChatMessage[] = [];
  private inputBuffer = '';
  private cursorPos = 0;
  private scrollTop = 0;
  private history: string[] = [];
  private historyIndex = -1;

  constructor(callbacks: SideChatCallbacks) {
    this.callbacks = callbacks;
  }

  // -------------------------------------------------------------------------
  // PanelDefinition implementation
  // -------------------------------------------------------------------------

  render(width: number, height: number, focused: boolean): string[] {
    const lines: string[] = [];

    // Messages area (all rows except last 2 for input)
    const msgAreaHeight = height - 2;
    const busy = this.callbacks.isBusy();

    if (this.messages.length === 0) {
      lines.push(this.pad(`  ${currentTheme.dimFg('textMuted', 'Type a quick question…')}`, width));
      lines.push(this.pad(`  ${currentTheme.dimFg('textMuted', 'Sent to the active agent.')}`, width));
    } else {
      // Clamp scroll
      const maxScroll = Math.max(0, this.messages.length - msgAreaHeight);
      this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));

      const end = Math.min(this.messages.length, this.scrollTop + msgAreaHeight);
      for (let i = this.scrollTop; i < end; i++) {
        const msg = this.messages[i]!;
        const prefix = msg.role === 'user'
          ? currentTheme.fg('roleUser', '› ')
          : currentTheme.fg('accent', '· ');
        const wrapped = this.wrapText(`${msg.text}`, width - 3);
        for (const wl of wrapped) {
          if (lines.length >= msgAreaHeight) break;
          const styled = msg.role === 'user'
            ? `${prefix}${currentTheme.fg('text', wl)}`
            : `${prefix}${currentTheme.dimFg('textDim', wl)}`;
          lines.push(this.pad(styled, width));
        }
      }
    }

    // Fill message area
    while (lines.length < msgAreaHeight) {
      lines.push(' '.repeat(width));
    }

    // Status line
    const statusText = busy ? currentTheme.fg('warning', ' ⏳ agent busy') : '';
    lines.push(this.pad(`${currentTheme.dimFg('border', ' ─')}${statusText}${currentTheme.dimFg('border', '─')}`, width));

    // Input line
    const prompt = focused ? currentTheme.boldFg('primary', '❯ ') : '  ';
    const cursor = focused ? currentTheme.fg('primary', '▏') : '';
    const inputDisplay = this.inputBuffer.slice(0, width - 3);
    const inputLine = `${prompt}${inputDisplay}${cursor}`;
    lines.push(this.pad(inputLine, width));

    return lines.slice(0, height);
  }

  onInput(event: NativeInputEvent): boolean {
    // Mouse wheel support
    if (event.type === 'mouse' && event.action === 'wheel') {
      if (event.button === 'wheel-up') {
        this.scrollTop = Math.max(0, this.scrollTop - 3);
        return true;
      }
      if (event.button === 'wheel-down') {
        this.scrollTop += 3;
        return true;
      }
      return false;
    }

    if (event.type !== 'key') return false;

    // Named keys
    if (event.key === 'enter') {
      this.submitInput();
      return true;
    }
    if (event.key === 'backspace') {
      if (this.cursorPos > 0) {
        this.inputBuffer =
          this.inputBuffer.slice(0, this.cursorPos - 1) +
          this.inputBuffer.slice(this.cursorPos);
        this.cursorPos--;
      }
      return true;
    }
    if (event.key === 'left') {
      this.cursorPos = Math.max(0, this.cursorPos - 1);
      return true;
    }
    if (event.key === 'right') {
      this.cursorPos = Math.min(this.inputBuffer.length, this.cursorPos + 1);
      return true;
    }
    if (event.key === 'home') {
      this.cursorPos = 0;
      return true;
    }
    if (event.key === 'end') {
      this.cursorPos = this.inputBuffer.length;
      return true;
    }
    if (event.key === 'up') {
      this.navigateHistory(-1);
      return true;
    }
    if (event.key === 'down') {
      this.navigateHistory(1);
      return true;
    }
    if (event.key === 'escape') {
      this.inputBuffer = '';
      this.cursorPos = 0;
      return true;
    }

    // Character input
    if (event.key === 'character' && event.text !== undefined) {
      if (event.ctrl) {
        // Ctrl+U: clear line
        if (event.text === 'u') {
          this.inputBuffer = '';
          this.cursorPos = 0;
          return true;
        }
        // Ctrl+A: home
        if (event.text === 'a') {
          this.cursorPos = 0;
          return true;
        }
        // Ctrl+E: end
        if (event.text === 'e') {
          this.cursorPos = this.inputBuffer.length;
          return true;
        }
        return false;
      }
      this.inputBuffer =
        this.inputBuffer.slice(0, this.cursorPos) +
        event.text +
        this.inputBuffer.slice(this.cursorPos);
      this.cursorPos += event.text.length;
      return true;
    }

    return false;
  }

  onFocus(): void {
    // Scroll to bottom of messages
    this.scrollTop = Math.max(0, this.messages.length - 10);
  }

  dispose(): void {
    this.messages = [];
    this.history = [];
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private submitInput(): void {
    const text = this.inputBuffer.trim();
    if (text.length === 0) return;

    // Add to history
    this.history.push(text);
    if (this.history.length > 50) this.history = this.history.slice(-50);
    this.historyIndex = -1;

    // Add user message
    this.messages.push({
      id: nextMsgId++,
      role: 'user',
      text,
      timestamp: Date.now(),
    });

    // Clear input
    this.inputBuffer = '';
    this.cursorPos = 0;

    // Send to agent
    const accepted = this.callbacks.sendMessage(text);
    if (!accepted) {
      this.messages.push({
        id: nextMsgId++,
        role: 'status',
        text: 'queued (agent busy)',
        timestamp: Date.now(),
      });
    }

    // Scroll to bottom
    this.scrollTop = Math.max(0, this.messages.length - 10);
  }

  private navigateHistory(direction: number): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      this.historyIndex = direction === -1 ? this.history.length - 1 : 0;
    } else {
      this.historyIndex += direction;
      if (this.historyIndex < 0) this.historyIndex = 0;
      if (this.historyIndex >= this.history.length) {
        this.historyIndex = -1;
        this.inputBuffer = '';
        this.cursorPos = 0;
        return;
      }
    }
    this.inputBuffer = this.history[this.historyIndex] ?? '';
    this.cursorPos = this.inputBuffer.length;
  }

  // -------------------------------------------------------------------------
  // Rendering helpers
  // -------------------------------------------------------------------------

  private wrapText(text: string, maxWidth: number): string[] {
    if (text.length <= maxWidth) return [text];
    const lines: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      lines.push(remaining.slice(0, maxWidth));
      remaining = remaining.slice(maxWidth);
    }
    return lines;
  }

  private pad(text: string, width: number): string {
    const visibleLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    if (visibleLen >= width) return text;
    return text + ' '.repeat(width - visibleLen);
  }

  private dim(text: string): string {
    return currentTheme.dimFg('textDim', text);
  }
}
