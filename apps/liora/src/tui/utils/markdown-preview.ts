/**
 * MarkdownPreview — real-time markdown rendering preview.
 *
 * Provides a markdown preview UI:
 * - Live preview of markdown content
 * - Syntax highlighting for code blocks
 * - Header rendering (H1-H6)
 * - List rendering (ordered/unordered/nested)
 * - Table rendering
 * - Blockquote styling
 * - Inline formatting (bold, italic, code, links)
 * - Horizontal rules
 * - Image placeholders
 * - Task lists (checkboxes)
 * - Word/character count
 * - Scroll sync with editor
 *
 * Visual style:
 * ┌─ Preview ──────────────────────── [123 words] ───┐
 * │                                                   │
 * │  Heading 1                                        │
 * │  ═════════                                        │
 * │                                                   │
 * │  This is a paragraph with *italic* and **bold**   │
 * │  text, plus `inline code`.                        │
 * │                                                   │
 * │  • List item one                                  │
 * │  • List item two                                  │
 * │    ◦ Nested item                                  │
 * │                                                   │
 * │  ┌──────────────────────────────────────────────┐ │
 * │  │ const x = 42;                                │ │
 * │  │ console.log(x);                              │ │
 * │  └──────────────────────────────────────────────┘ │
 * │                                                   │
 * │  > This is a blockquote                           │
 * └───────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarkdownBlockType =
  | 'heading'
  | 'paragraph'
  | 'code'
  | 'blockquote'
  | 'list'
  | 'table'
  | 'hr'
  | 'image';

export interface MarkdownBlock {
  readonly type: MarkdownBlockType;
  readonly content: string;
  readonly level?: number; // for headings
  readonly language?: string; // for code
  readonly items?: string[]; // for lists
  readonly ordered?: boolean; // for lists
  readonly rows?: string[][]; // for tables
}

export interface MarkdownPreviewRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showWordCount?: boolean;
  readonly showLineNumbers?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// MarkdownPreview
// ---------------------------------------------------------------------------

export class MarkdownPreview {
  private source = '';
  private blocks: MarkdownBlock[] = [];
  private scrollOffset = 0;

  // ─── Content ─────────────────────────────────────────────────────

  /** Set markdown source. */
  setSource(markdown: string): void {
    this.source = markdown;
    this.blocks = this.parse(markdown);
  }

  /** Get parsed blocks. */
  getBlocks(): MarkdownBlock[] {
    return this.blocks;
  }

  /** Get word count. */
  get wordCount(): number {
    return this.source.split(/\s+/).filter((w) => w.length > 0).length;
  }

  /** Get character count. */
  get charCount(): number {
    return this.source.length;
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Scroll to line. */
  scrollTo(line: number): void {
    this.scrollOffset = Math.max(0, line);
  }

  /** Scroll by delta. */
  scrollBy(delta: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
  }

  // ─── Parsing ─────────────────────────────────────────────────────

  private parse(markdown: string): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = [];
    const lines = markdown.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;

      // Empty line
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        blocks.push({
          type: 'heading',
          content: headingMatch[2]!,
          level: headingMatch[1]!.length,
        });
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        blocks.push({ type: 'hr', content: '' });
        i++;
        continue;
      }

      // Code block
      if (line.startsWith('```')) {
        const language = line.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i]!.startsWith('```')) {
          codeLines.push(lines[i]!);
          i++;
        }
        i++; // skip closing ```
        blocks.push({
          type: 'code',
          content: codeLines.join('\n'),
          language: language || undefined,
        });
        continue;
      }

      // Blockquote
      if (line.startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i]!.startsWith('>')) {
          quoteLines.push(lines[i]!.slice(1).trim());
          i++;
        }
        blocks.push({
          type: 'blockquote',
          content: quoteLines.join(' '),
        });
        continue;
      }

      // Table
      if (line.includes('|') && i + 1 < lines.length && lines[i + 1]!.includes('---')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i]!.includes('|')) {
          tableLines.push(lines[i]!);
          i++;
        }
        const rows = tableLines
          .filter((l) => !l.includes('---'))
          .map((l) => l.split('|').map((c) => c.trim()).filter((c) => c !== ''));
        blocks.push({
          type: 'table',
          content: '',
          rows,
        });
        continue;
      }

      // List
      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
      if (listMatch) {
        const items: string[] = [];
        const ordered = /\d+\./.test(listMatch[2]!);
        while (i < lines.length) {
          const itemMatch = lines[i]!.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
          if (!itemMatch) break;
          items.push(itemMatch[3]!);
          i++;
        }
        blocks.push({
          type: 'list',
          content: '',
          items,
          ordered,
        });
        continue;
      }

      // Image
      const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imageMatch) {
        blocks.push({
          type: 'image',
          content: imageMatch[1] || 'image',
        });
        i++;
        continue;
      }

      // Paragraph (collect consecutive non-empty lines)
      const paraLines: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.match(/^(#{1,6}\s|```|>|[-*+]\s|\d+\.\s)/)) {
        paraLines.push(lines[i]!);
        i++;
      }
      if (paraLines.length > 0) {
        blocks.push({
          type: 'paragraph',
          content: paraLines.join(' '),
        });
      }
    }

    return blocks;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the preview. */
  render(options: MarkdownPreviewRenderOptions): string[] {
    const { width, height, showWordCount = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    // Header
    const wordInfo = showWordCount ? ` [${dimFg('textMuted', `${String(this.wordCount)} words`)}]` : '';
    const title = ` Preview`;
    lines.push(fg('textMuted', `┌─${boldFg('text', title)}${'─'.repeat(Math.max(0, innerWidth - title.length - 14))}${wordInfo} ┐`));

    // Render blocks
    const contentHeight = height - 3;
    let lineCount = 0;

    for (const block of this.blocks) {
      if (lineCount >= contentHeight) break;

      const blockLines = this.renderBlock(block, innerWidth, options);
      for (const blockLine of blockLines) {
        if (lineCount >= contentHeight) break;
        lines.push(fg('textMuted', '│') + blockLine + fg('textMuted', '│'));
        lineCount++;
      }

      // Add spacing between blocks
      if (lineCount < contentHeight && block.type !== 'hr') {
        lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
        lineCount++;
      }
    }

    // Pad
    while (lines.length < height - 1) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    lines.push(fg('textMuted', `└${'─'.repeat(innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private renderBlock(block: MarkdownBlock, width: number, options: MarkdownPreviewRenderOptions): string[] {
    const { fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    switch (block.type) {
      case 'heading': {
        const level = block.level ?? 1;
        const text = this.renderInline(block.content, options);
        if (level === 1) {
          lines.push(` ${boldFg('text', text)}`);
          lines.push(` ${dimFg('textMuted', '═'.repeat(Math.min(text.length + 4, width - 4)))}`);
        } else if (level === 2) {
          lines.push(` ${boldFg('primary', text)}`);
          lines.push(` ${dimFg('textMuted', '─'.repeat(Math.min(text.length + 4, width - 4)))}`);
        } else {
          const prefix = '#'.repeat(level);
          lines.push(` ${dimFg('textMuted', prefix)} ${boldFg('text', text)}`);
        }
        break;
      }

      case 'paragraph': {
        const text = this.renderInline(block.content, options);
        const wrapped = this.wrapText(text, width - 2);
        for (const line of wrapped) {
          lines.push(` ${line}`);
        }
        break;
      }

      case 'code': {
        const codeLines = block.content.split('\n');
        const langLabel = block.language ? dimFg('textMuted', ` [${block.language}]`) : '';
        lines.push(` ${fg('textMuted', '┌')}${langLabel}${fg('textMuted', '─'.repeat(Math.max(0, width - 8 - (block.language?.length ?? 0))))}┐`);
        for (const codeLine of codeLines.slice(0, 8)) {
          lines.push(` ${fg('textMuted', '│')} ${fg('success', codeLine.slice(0, width - 6))}${' '.repeat(Math.max(0, width - 6 - codeLine.length))}${fg('textMuted', '│')}`);
        }
        if (codeLines.length > 8) {
          lines.push(` ${fg('textMuted', '│')} ${dimFg('textMuted', `... ${String(codeLines.length - 8)} more lines`)}${' '.repeat(Math.max(0, width - 25))}${fg('textMuted', '│')}`);
        }
        lines.push(` ${fg('textMuted', '└')}${fg('textMuted', '─'.repeat(width - 4))}┘`);
        break;
      }

      case 'blockquote': {
        const text = this.renderInline(block.content, options);
        lines.push(` ${fg('accent', '│')} ${dimFg('textMuted', text.slice(0, width - 6))}`);
        break;
      }

      case 'list': {
        const items = block.items ?? [];
        items.forEach((item, idx) => {
          const bullet = block.ordered ? `${String(idx + 1)}.` : '•';
          const text = this.renderInline(item, options);
          lines.push(` ${fg('primary', bullet)} ${text.slice(0, width - 6)}`);
        });
        break;
      }

      case 'table': {
        const rows = block.rows ?? [];
        if (rows.length > 0) {
          const colWidths = rows[0]!.map((_, i) =>
            Math.max(...rows.map((r) => (r[i] ?? '').length)) + 2
          );
          // Header
          const header = rows[0]!.map((cell, i) => boldFg('text', cell.padEnd(colWidths[i]!))).join(fg('textMuted', '│'));
          lines.push(` ${header}`);
          lines.push(` ${dimFg('textMuted', colWidths.map((w) => '─'.repeat(w)).join('┼'))}`);
          // Data rows
          for (const row of rows.slice(1, 6)) {
            const rowStr = row.map((cell, i) => fg('text', (cell ?? '').padEnd(colWidths[i]!))).join(fg('textMuted', '│'));
            lines.push(` ${rowStr}`);
          }
        }
        break;
      }

      case 'hr': {
        lines.push(` ${dimFg('textMuted', '─'.repeat(width - 4))}`);
        break;
      }

      case 'image': {
        lines.push(` ${fg('textMuted', '[🖼')} ${dimFg('textMuted', block.content)} ${fg('textMuted', ']')}`);
        break;
      }
    }

    return lines;
  }

  private renderInline(text: string, options: MarkdownPreviewRenderOptions): string {
    const { fg, boldFg, dimFg } = options;

    return text
      // Bold: **text** or __text__
      .replace(/\*\*([^*]+)\*\*/g, (_, t: string) => boldFg('text', t))
      .replace(/__([^_]+)__/g, (_, t: string) => boldFg('text', t))
      // Italic: *text* or _text_
      .replace(/\*([^*]+)\*/g, (_, t: string) => fg('accent', t))
      .replace(/_([^_]+)_/g, (_, t: string) => fg('accent', t))
      // Inline code: `code`
      .replace(/`([^`]+)`/g, (_, t: string) => fg('success', t))
      // Links: [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text: string) => fg('primary', text))
      // Strikethrough: ~~text~~
      .replace(/~~([^~]+)~~/g, (_, t: string) => dimFg('textMuted', t));
  }

  private wrapText(text: string, width: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const visibleWord = word.replace(/\x1b\[[0-9;]*m/g, '');
      const visibleLine = currentLine.replace(/\x1b\[[0-9;]*m/g, '');

      if (visibleLine.length + visibleWord.length + 1 > width) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      }
    }

    if (currentLine) lines.push(currentLine);
    return lines;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRight(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo markdown preview with sample content. */
export function createDemoMarkdownPreview(): MarkdownPreview {
  const preview = new MarkdownPreview();

  preview.setSource(`# Heading 1

This is a paragraph with *italic* and **bold** text, plus \`inline code\`.

## Heading 2

- List item one
- List item two
- List item three

\`\`\`typescript
const x = 42;
console.log(x);
\`\`\`

> This is a blockquote with some wisdom.

| Name  | Value |
|-------|-------|
| Alpha | 100   |
| Beta  | 200   |

---

1. First ordered item
2. Second ordered item
3. Third ordered item
`);

  return preview;
}
