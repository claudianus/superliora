/**
 * MarkdownRenderer — rich markdown rendering for the terminal.
 *
 * Renders markdown content with terminal-appropriate styling:
 * - Headers (H1-H4) with decorative underlines and color
 * - Code blocks with syntax highlighting hints and line numbers
 * - Inline code with distinct background
 * - Bold, italic, strikethrough
 * - Ordered and unordered lists with proper indentation
 * - Blockquotes with left border
 * - Horizontal rules
 * - Links (OSC 8 hyperlinks when supported, else URL in parens)
 * - Tables with box-drawing characters
 * - Task lists (checkboxes)
 *
 * Design principles:
 * - Readable at 80 columns
 * - Theme-aware (all colors via callback)
 * - No external dependencies (pure string processing)
 * - Streaming-friendly (can render partial markdown)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarkdownBlockType =
  | 'heading'
  | 'paragraph'
  | 'code-block'
  | 'blockquote'
  | 'list'
  | 'hr'
  | 'table'
  | 'blank';

export interface MarkdownBlock {
  readonly type: MarkdownBlockType;
  readonly content: string;
  readonly level?: number; // For headings (1-4)
  readonly language?: string; // For code blocks
  readonly items?: readonly MarkdownListItem[];
  readonly rows?: readonly (readonly string[])[]; // For tables
}

export interface MarkdownListItem {
  readonly text: string;
  readonly indent: number;
  readonly ordered: boolean;
  readonly order?: number;
  readonly checked?: boolean | null; // null = not a task item
}

export interface MarkdownRenderOptions {
  readonly width: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
  /** Whether to show line numbers in code blocks. */
  readonly codeLineNumbers?: boolean;
  /** Whether to use OSC 8 hyperlinks. */
  readonly hyperlinks?: boolean;
}

// ---------------------------------------------------------------------------
// MarkdownRenderer
// ---------------------------------------------------------------------------

export class MarkdownRenderer {
  /**
   * Parse and render a markdown string into styled terminal lines.
   */
  render(markdown: string, options: MarkdownRenderOptions): string[] {
    const blocks = this.parse(markdown);
    const lines: string[] = [];

    for (const block of blocks) {
      const rendered = this.renderBlock(block, options);
      lines.push(...rendered);
      lines.push(''); // Blank line between blocks
    }

    // Remove trailing blank line
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines;
  }

  // ─── Parsing ──────────────────────────────────────────────────────

  parse(markdown: string): MarkdownBlock[] {
    const lines = markdown.split('\n');
    const blocks: MarkdownBlock[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i] ?? '';

      // Blank line
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Code block (fenced)
      if (line.startsWith('```')) {
        const language = line.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
          codeLines.push(lines[i] ?? '');
          i++;
        }
        i++; // Skip closing ```
        blocks.push({ type: 'code-block', content: codeLines.join('\n'), language });
        continue;
      }

      // Heading
      const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        blocks.push({ type: 'heading', content: headingMatch[2] ?? '', level });
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        blocks.push({ type: 'hr', content: '' });
        i++;
        continue;
      }

      // Blockquote
      if (line.startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
          quoteLines.push((lines[i] ?? '').replace(/^>\s?/, ''));
          i++;
        }
        blocks.push({ type: 'blockquote', content: quoteLines.join('\n') });
        continue;
      }

      // Table (detect header + separator)
      if (line.includes('|') && i + 1 < lines.length && /^\|?[\s-:|]+\|?$/.test(lines[i + 1] ?? '')) {
        const rows: string[][] = [];
        while (i < lines.length && (lines[i] ?? '').includes('|')) {
          const cells = (lines[i] ?? '').split('|').map((c) => c.trim()).filter((c) => c !== '');
          // Skip separator row
          if (!/^[\s-:]+$/.test(cells.join(''))) {
            rows.push(cells);
          }
          i++;
        }
        blocks.push({ type: 'table', content: '', rows });
        continue;
      }

      // List items
      const listMatch = /^(\s*)([-*+]|\d+\.)\s+(.+)$/.exec(line);
      if (listMatch) {
        const items: MarkdownListItem[] = [];
        while (i < lines.length) {
          const itemMatch = /^(\s*)([-*+]|\d+\.)\s+(.+)$/.exec(lines[i] ?? '');
          if (!itemMatch) break;

          const indent = itemMatch[1]!.length;
          const marker = itemMatch[2] ?? '';
          let text = itemMatch[3] ?? '';
          const ordered = /^\d+\.$/.test(marker);
          const order = ordered ? parseInt(marker, 10) : undefined;

          // Task list detection
          let checked: boolean | null = null;
          const taskMatch = /^\[([ xX])\]\s*(.+)$/.exec(text);
          if (taskMatch) {
            checked = taskMatch[1]!.toLowerCase() === 'x';
            text = taskMatch[2] ?? '';
          }

          items.push({ text, indent, ordered, order, checked });
          i++;
        }
        blocks.push({ type: 'list', content: '', items });
        continue;
      }

      // Paragraph (collect consecutive non-blank, non-special lines)
      const paraLines: string[] = [];
      while (i < lines.length) {
        const pLine = lines[i] ?? '';
        if (pLine.trim() === '') break;
        if (pLine.startsWith('#') || pLine.startsWith('```') || pLine.startsWith('>')) break;
        if (/^(\s*)([-*+]|\d+\.)\s+/.test(pLine)) break;
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(pLine.trim())) break;
        paraLines.push(pLine);
        i++;
      }
      if (paraLines.length > 0) {
        blocks.push({ type: 'paragraph', content: paraLines.join(' ') });
      }
    }

    return blocks;
  }

  // ─── Block Rendering ──────────────────────────────────────────────

  private renderBlock(block: MarkdownBlock, options: MarkdownRenderOptions): string[] {
    switch (block.type) {
      case 'heading': return this.renderHeading(block, options);
      case 'paragraph': return this.renderParagraph(block, options);
      case 'code-block': return this.renderCodeBlock(block, options);
      case 'blockquote': return this.renderBlockquote(block, options);
      case 'list': return this.renderList(block, options);
      case 'hr': return this.renderHr(options);
      case 'table': return this.renderTable(block, options);
      default: return [];
    }
  }

  private renderHeading(block: MarkdownBlock, options: MarkdownRenderOptions): string[] {
    const { width, fg, boldFg, dimFg } = options;
    const level = block.level ?? 1;
    const lines: string[] = [];

    switch (level) {
      case 1:
        lines.push(boldFg('accent', ` ${block.content}`));
        lines.push(fg('accent', '━'.repeat(Math.min(width - 2, block.content.length + 2))));
        break;
      case 2:
        lines.push(boldFg('primary', ` ${block.content}`));
        lines.push(fg('primary', '─'.repeat(Math.min(width - 2, block.content.length + 2))));
        break;
      case 3:
        lines.push(boldFg('text', ` ▎${block.content}`));
        break;
      default:
        lines.push(boldFg('text', `  ${block.content}`));
        break;
    }

    return lines;
  }

  private renderParagraph(block: MarkdownBlock, options: MarkdownRenderOptions): string[] {
    const { width, fg } = options;
    const text = this.renderInline(block.content, options);
    return this.wrapText(text, width - 2, fg);
  }

  private renderCodeBlock(block: MarkdownBlock, options: MarkdownRenderOptions): string[] {
    const { width, fg, boldFg, dimFg, bg, codeLineNumbers = true } = options;
    const lines: string[] = [];
    const codeLines = block.content.split('\n');
    const lang = block.language ?? '';

    // Header with language
    const headerRight = lang ? dimFg('textMuted', ` ${lang} `) : '';
    lines.push(fg('textMuted', `┌${'─'.repeat(Math.min(width - 4, 50))}┐${headerRight}`));

    // Code lines
    for (let i = 0; i < codeLines.length; i++) {
      const lineNo = codeLineNumbers
        ? dimFg('textMuted', String(i + 1).padStart(3) + ' │ ')
        : fg('textMuted', '│ ');
      const code = codeLines[i] ?? '';
      lines.push(`${fg('textMuted', '│')} ${lineNo}${fg('text', code)}`);
    }

    // Footer
    lines.push(fg('textMuted', `└${'─'.repeat(Math.min(width - 4, 50))}┘`));

    return lines;
  }

  private renderBlockquote(block: MarkdownBlock, options: MarkdownRenderOptions): string[] {
    const { fg, dimFg } = options;
    const quoteLines = block.content.split('\n');
    return quoteLines.map((line) =>
      `${fg('accent', '▐')} ${dimFg('textMuted', this.renderInline(line, options))}`
    );
  }

  private renderList(block: MarkdownBlock, options: MarkdownRenderOptions): string[] {
    const { fg, dimFg } = options;
    const lines: string[] = [];
    const items = block.items ?? [];

    for (const item of items) {
      const indent = ' '.repeat(item.indent + 1);
      let bullet: string;

      if (item.checked !== null) {
        // Task list
        bullet = item.checked ? fg('success', '☑') : dimFg('textMuted', '☐');
      } else if (item.ordered) {
        bullet = fg('primary', `${String(item.order ?? 1)}.`);
      } else {
        bullet = fg('accent', '•');
      }

      const text = this.renderInline(item.text, options);
      lines.push(`${indent}${bullet} ${text}`);
    }

    return lines;
  }

  private renderHr(options: MarkdownRenderOptions): string[] {
    const { width, dimFg } = options;
    return [dimFg('textMuted', '─'.repeat(Math.min(width - 2, 60)))];
  }

  private renderTable(block: MarkdownBlock, options: MarkdownRenderOptions): string[] {
    const { width, fg, boldFg, dimFg } = options;
    const rows = block.rows ?? [];
    if (rows.length === 0) return [];

    const lines: string[] = [];

    // Calculate column widths
    const colCount = Math.max(...rows.map((r) => r.length));
    const colWidths: number[] = new Array(colCount).fill(0);
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        colWidths[i] = Math.max(colWidths[i] ?? 0, (row[i] ?? '').length);
      }
    }

    // Cap total width
    const totalWidth = colWidths.reduce((a, b) => a + b + 3, 1);
    if (totalWidth > width) {
      const scale = (width - colCount - 1) / colWidths.reduce((a, b) => a + b, 0);
      for (let i = 0; i < colWidths.length; i++) {
        colWidths[i] = Math.max(4, Math.floor((colWidths[i] ?? 4) * scale));
      }
    }

    // Render rows
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]!;
      const cells = row.map((cell, i) => {
        const w = colWidths[i] ?? 10;
        const text = cell.length > w ? cell.slice(0, w - 1) + '…' : cell.padEnd(w);
        return rowIdx === 0 ? boldFg('text', text) : fg('text', text);
      });

      lines.push(fg('textMuted', '│') + ' ' + cells.join(fg('textMuted', ' │ ')) + ' ' + fg('textMuted', '│'));

      // Separator after header
      if (rowIdx === 0) {
        const sep = colWidths.map((w) => '─'.repeat(w)).join('─┼─');
        lines.push(fg('textMuted', `├─${sep}─┤`));
      }
    }

    return lines;
  }

  // ─── Inline Rendering ─────────────────────────────────────────────

  private renderInline(text: string, options: MarkdownRenderOptions): string {
    const { fg, boldFg, dimFg, bg, hyperlinks = false } = options;
    let result = text;

    // Bold: **text** or __text__
    result = result.replace(/\*\*(.+?)\*\*/g, (_, content: string) => boldFg('text', content));
    result = result.replace(/__(.+?)__/g, (_, content: string) => boldFg('text', content));

    // Italic: *text* or _text_
    result = result.replace(/\*(.+?)\*/g, (_, content: string) => fg('accent', content));
    result = result.replace(/_(.+?)_/g, (_, content: string) => fg('accent', content));

    // Strikethrough: ~~text~~
    result = result.replace(/~~(.+?)~~/g, (_, content: string) => dimFg('textMuted', content));

    // Inline code: `code`
    result = result.replace(/`(.+?)`/g, (_, content: string) => fg('warning', content));

    // Links: [text](url)
    if (hyperlinks) {
      result = result.replace(/\[(.+?)\]\((.+?)\)/g, (_, text: string, url: string) =>
        `\x1b]8;;${url}\x1b\\${fg('primary', text)}\x1b]8;;\x1b\\`
      );
    } else {
      result = result.replace(/\[(.+?)\]\((.+?)\)/g, (_, text: string, url: string) =>
        `${fg('primary', text)} ${dimFg('textMuted', `(${url})`)}`
      );
    }

    return result;
  }

  // ─── Text Wrapping ────────────────────────────────────────────────

  private wrapText(text: string, maxWidth: number, fg: (t: string, s: string) => string): string[] {
    // Simple word wrap (doesn't handle ANSI perfectly but works for most cases)
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      if (current.length + word.length + 1 > maxWidth) {
        if (current.length > 0) lines.push(` ${current}`);
        current = word;
      } else {
        current = current.length > 0 ? `${current} ${word}` : word;
      }
    }
    if (current.length > 0) lines.push(` ${current}`);

    return lines;
  }
}
