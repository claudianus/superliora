/**
 * ChatInterface — message bubbles, typing indicators, and reactions.
 *
 * Provides modern chat UI components:
 * - Message bubbles (sent/received alignment)
 * - User avatars (initials or emoji)
 * - Timestamps
 * - Typing indicators (animated dots)
 * - Message reactions (emoji + count)
 * - Read receipts (✓, ✓✓)
 * - Message grouping (consecutive from same user)
 * - Reply threading (quoted messages)
 * - Edit/delete indicators
 * - System messages (centered, muted)
 * - Unread divider
 * - Message search highlighting
 * - Compact/comfortable density
 *
 * Visual style:
 * ┌─────────────────────────────────────────────────┐
 * │  ┌─ Alice ──────────────────────────────────┐   │
 * │  │ Hey! How's the project going?            │   │
 * │  └────────────────────────────── 10:30 ✓✓ ──┘   │
 * │                                                 │
 * │   ┌─ You ──────────────────────────────────┐   │
 * │   │ Great! Just finished the TUI modules   │   │
 * │   │ 🎉 3  👍 2                             │   │
 * │   └────────────────────────────── 10:32 ✓✓ ──┘   │
 * │                                                 │
 * │  Alice is typing...                            │
 * └─────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatUser {
  readonly id: string;
  readonly name: string;
  readonly avatar?: string; // Emoji or initials
  readonly color?: string;
  readonly isSelf?: boolean;
}

export interface MessageReaction {
  readonly emoji: string;
  readonly count: number;
  readonly reactedBySelf?: boolean;
}

export interface ChatMessage {
  readonly id: string;
  readonly user: ChatUser;
  readonly content: string;
  readonly timestamp: number;
  readonly reactions: readonly MessageReaction[];
  readonly replyTo?: string; // Message ID being replied to
  readonly edited?: boolean;
  readonly deleted?: boolean;
  readonly readStatus?: 'sent' | 'delivered' | 'read';
  readonly isSystem?: boolean;
}

export interface ChatRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly density?: 'compact' | 'comfortable';
  readonly showTimestamps?: boolean;
  readonly showAvatars?: boolean;
  readonly showReactions?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const READ_ICONS: Record<string, string> = {
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓', // Would be colored differently
};

const TYPING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ---------------------------------------------------------------------------
// ChatInterface
// ---------------------------------------------------------------------------

export class ChatInterface {
  private messages: ChatMessage[] = [];
  private users: Map<string, ChatUser> = new Map();
  private typingUsers: Set<string> = new Set();
  private scrollOffset = 0;
  private typingFrame = 0;
  private unreadAfterId: string | null = null;

  // ─── User Management ─────────────────────────────────────────────

  /** Register a user. */
  addUser(user: ChatUser): void {
    this.users.set(user.id, user);
  }

  /** Get a user. */
  getUser(id: string): ChatUser | undefined {
    return this.users.get(id);
  }

  // ─── Message Management ──────────────────────────────────────────

  /** Add a message. */
  addMessage(message: ChatMessage): void {
    this.messages.push(message);
    if (!message.user.isSelf) {
      // Auto-scroll to bottom for received messages
      this.scrollOffset = Math.max(0, this.messages.length - 10);
    }
  }

  /** Add a system message. */
  addSystemMessage(content: string): void {
    this.addMessage({
      id: `sys-${String(Date.now())}`,
      user: { id: 'system', name: 'System' },
      content,
      timestamp: Date.now(),
      reactions: [],
      isSystem: true,
    });
  }

  /** Delete a message. */
  deleteMessage(id: string): void {
    this.messages = this.messages.map((m) =>
      m.id === id ? { ...m, deleted: true, content: '' } : m,
    );
  }

  /** Edit a message. */
  editMessage(id: string, newContent: string): void {
    this.messages = this.messages.map((m) =>
      m.id === id ? { ...m, content: newContent, edited: true } : m,
    );
  }

  /** Add a reaction to a message. */
  addReaction(messageId: string, emoji: string): void {
    this.messages = this.messages.map((m) => {
      if (m.id !== messageId) return m;

      const existing = m.reactions.find((r) => r.emoji === emoji);
      if (existing) {
        return {
          ...m,
          reactions: m.reactions.map((r) =>
            r.emoji === emoji
              ? { ...r, count: r.count + 1, reactedBySelf: true }
              : r,
          ),
        };
      }

      return {
        ...m,
        reactions: [...m.reactions, { emoji, count: 1, reactedBySelf: true }],
      };
    });
  }

  /** Set reply target for next message. */
  setReplyTo(messageId: string | null): void {
    // Store for next addMessage call
    this.pendingReplyTo = messageId;
  }

  private pendingReplyTo: string | null = null;

  // ─── Typing Indicators ───────────────────────────────────────────

  /** Set a user as typing. */
  setTyping(userId: string, isTyping: boolean): void {
    if (isTyping) {
      this.typingUsers.add(userId);
    } else {
      this.typingUsers.delete(userId);
    }
  }

  /** Advance typing animation frame. */
  tickTyping(): void {
    this.typingFrame = (this.typingFrame + 1) % TYPING_FRAMES.length;
  }

  // ─── Unread Management ───────────────────────────────────────────

  /** Set the unread divider after a message. */
  setUnreadAfter(messageId: string | null): void {
    this.unreadAfterId = messageId;
  }

  /** Mark all as read. */
  markAllRead(): void {
    this.unreadAfterId = null;
    this.messages = this.messages.map((m) => ({ ...m, readStatus: 'read' as const }));
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Scroll up. */
  scrollUp(amount = 1): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - amount);
  }

  /** Scroll down. */
  scrollDown(amount = 1): void {
    this.scrollOffset = Math.min(Math.max(0, this.messages.length - 10), this.scrollOffset + amount);
  }

  /** Scroll to bottom. */
  scrollToBottom(): void {
    this.scrollOffset = Math.max(0, this.messages.length - 10);
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get all messages. */
  getMessages(): readonly ChatMessage[] {
    return this.messages;
  }

  /** Get message count. */
  get messageCount(): number {
    return this.messages.length;
  }

  /** Get unread count. */
  get unreadCount(): number {
    if (!this.unreadAfterId) return 0;
    const idx = this.messages.findIndex((m) => m.id === this.unreadAfterId);
    return idx >= 0 ? this.messages.length - idx - 1 : 0;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the chat interface. */
  render(options: ChatRenderOptions): string[] {
    const { width, height, density = 'comfortable', showTimestamps = true, showAvatars = true, showReactions = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    const visibleMessages = this.messages.slice(this.scrollOffset, this.scrollOffset + height - 2);
    let lastUserId: string | null = null;

    for (const message of visibleMessages) {
      // Unread divider
      if (message.id === this.unreadAfterId) {
        lines.push(dimFg('error', `${'─'.repeat(Math.floor(width / 2) - 5)} New messages ${'─'.repeat(Math.floor(width / 2) - 5)}`));
      }

      // System message
      if (message.isSystem) {
        lines.push(this.renderSystemMessage(message, width, options));
        lastUserId = null;
        continue;
      }

      // Check if we should show header (new user or gap)
      const showHeader = message.user.id !== lastUserId;
      lastUserId = message.user.id;

      // Render message
      const msgLines = this.renderMessage(message, {
        showHeader,
        showTimestamps,
        showAvatars,
        showReactions,
        density,
        ...options,
      });
      lines.push(...msgLines);

      // Spacing
      if (density === 'comfortable' && showHeader) {
        lines.push('');
      }
    }

    // Typing indicator
    if (this.typingUsers.size > 0) {
      const typingNames = [...this.typingUsers]
        .map((id) => this.users.get(id)?.name ?? 'Someone')
        .join(', ');
      const dots = TYPING_FRAMES[this.typingFrame] ?? '⠋';
      lines.push('');
      lines.push(dimFg('textMuted', `  ${typingNames} is typing ${dots}`));
    }

    return lines;
  }

  private renderMessage(message: ChatMessage, options: ChatRenderOptions & { showHeader: boolean; density: 'compact' | 'comfortable' }): string[] {
    const { width, fg, boldFg, dimFg, showHeader, showTimestamps, showAvatars, showReactions, density } = options;
    const lines: string[] = [];
    const isSelf = message.user.isSelf;
    const bubbleWidth = Math.floor(width * 0.75);

    // Alignment
    const leftPad = isSelf ? width - bubbleWidth - 2 : 2;
    const indent = ' '.repeat(Math.max(0, leftPad));

    // Header (username + avatar)
    if (showHeader) {
      const avatar = showAvatars ? (message.user.avatar ?? message.user.name[0]) : '';
      const name = isSelf ? 'You' : message.user.name;
      const time = showTimestamps ? dimFg('textMuted', ` ${this.formatTime(message.timestamp)}`) : '';

      if (isSelf) {
        lines.push(`${indent}${dimFg('textMuted', '')}${boldFg('primary', name)}${time}`);
      } else {
        lines.push(`${indent}${fg('accent', avatar ? `${avatar} ` : '')}${boldFg('text', name)}${time}`);
      }
    }

    // Deleted message
    if (message.deleted) {
      lines.push(`${indent}${dimFg('textDim', '  🚫 Message deleted')}`);
      return lines;
    }

    // Reply quote
    if (message.replyTo) {
      const repliedMsg = this.messages.find((m) => m.id === message.replyTo);
      if (repliedMsg) {
        const quote = this.truncate(repliedMsg.content, bubbleWidth - 6);
        lines.push(`${indent}${dimFg('textMuted', `  ┃ ${quote}`)}`);
      }
    }

    // Message bubble
    const contentLines = this.wrapText(message.content, bubbleWidth - 4);
    const border = isSelf ? fg('primary', '│') : fg('textMuted', '│');

    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i]!;
      const editedMark = message.edited && i === contentLines.length - 1 ? dimFg('textDim', ' (edited)') : '';
      lines.push(`${indent}${border} ${fg('text', line)}${editedMark}`);
    }

    // Reactions
    if (showReactions && message.reactions.length > 0) {
      const reactionStrs = message.reactions.map((r) => {
        const highlight = r.reactedBySelf ? fg('primary', `${r.emoji} ${String(r.count)}`) : dimFg('textMuted', `${r.emoji} ${String(r.count)}`);
        return highlight;
      });
      lines.push(`${indent}  ${reactionStrs.join('  ')}`);
    }

    // Read status (for self messages)
    if (isSelf && message.readStatus) {
      const icon = READ_ICONS[message.readStatus] ?? '';
      const color = message.readStatus === 'read' ? 'primary' : 'textMuted';
      lines.push(`${indent}${' '.repeat(bubbleWidth - 4)}${fg(color, icon)}`);
    }

    return lines;
  }

  private renderSystemMessage(message: ChatMessage, width: number, options: ChatRenderOptions): string {
    const { dimFg } = options;
    const content = this.truncate(message.content, width - 10);
    const padding = Math.floor((width - content.length) / 2);
    return `${' '.repeat(Math.max(0, padding))}${dimFg('textDim', `── ${content} ──`)}`;
  }

  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '…';
  }

  private wrapText(text: string, width: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      if (current.length + word.length + 1 > width) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
  }
}
