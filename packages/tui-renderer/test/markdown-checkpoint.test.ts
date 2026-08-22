import { describe, expect, it } from 'vitest';

import {
  findFrozenMarkdownSourceEnd,
  Markdown,
  splitMarkdownSourceLines,
  type MarkdownTheme,
} from '../src';

const theme = {
  heading: (text) => text,
  link: (text) => text,
  linkUrl: (text) => text,
  code: (text) => text,
  codeBlock: (text) => text,
  codeBlockBorder: (text) => text,
  quote: (text) => text,
  quoteBorder: (text) => text,
  hr: (text) => text,
  listBullet: (text) => text,
  bold: (text) => text,
  italic: (text) => text,
  strikethrough: (text) => text,
  underline: (text) => text,
} satisfies MarkdownTheme;

function makeMarkdown(source: string, onHighlight?: () => void): Markdown {
  return new Markdown(source, 0, 0, {
    ...theme,
    highlightCode:
      onHighlight === undefined
        ? undefined
        : (code) => {
            onHighlight();
            return code.split('\n');
          },
  });
}

describe('findFrozenMarkdownSourceEnd', () => {
  it('stays at 0 until a blank line or closed fence settles', () => {
    expect(findFrozenMarkdownSourceEnd('still writing')).toBe(0);
    expect(findFrozenMarkdownSourceEnd('# Title\nstill writing')).toBe(0);
    expect(findFrozenMarkdownSourceEnd('```js\nconst x = 1\n')).toBe(0);
  });

  it('freezes before the last structural blank so the tail keeps the separator', () => {
    const text = '# Title\n\npara one.\n\nwriting';
    const end = findFrozenMarkdownSourceEnd(text);
    expect(text.slice(0, end)).toBe('# Title\n\npara one.\n');
    expect(text.slice(end)).toBe('\nwriting');
  });

  it('freezes after a closed fence', () => {
    const text = '```js\nconst x = 1;\n```\nmore';
    const end = findFrozenMarkdownSourceEnd(text);
    expect(text.slice(0, end)).toBe('```js\nconst x = 1;\n```\n');
    expect(text.slice(end)).toBe('more');
  });

  it('does not move the checkpoint through consecutive blanks', () => {
    const text = 'para\n\n\nmore';
    const end = findFrozenMarkdownSourceEnd(text);
    expect(text.slice(0, end)).toBe('para\n');
    expect(text.slice(end)).toBe('\n\nmore');
  });

  it('splits source lines without a trailing empty complete row', () => {
    expect(splitMarkdownSourceLines('a\nb\n')).toEqual([
      { text: 'a', start: 0, hasNewline: true },
      { text: 'b', start: 2, hasNewline: true },
    ]);
    expect(splitMarkdownSourceLines('a\nb')).toEqual([
      { text: 'a', start: 0, hasNewline: true },
      { text: 'b', start: 2, hasNewline: false },
    ]);
  });
});

describe('Markdown streaming checkpoint', () => {
  it('matches a full parse when text is appended in chunks', () => {
    const chunks = [
      '# Title\n\n',
      'First paragraph of text.\n\n',
      'Second paragraph with **bold** and `code`.\n\n',
      '```ts\nconst x = 1;\n```\n\n',
      'Still writing this sentence',
    ];
    let source = '';
    const streaming = makeMarkdown('');
    for (const chunk of chunks) {
      source += chunk;
      streaming.setText(source);
      const incremental = streaming.render(60).map((line) => line.trimEnd());
      const full = makeMarkdown(source).render(60).map((line) => line.trimEnd());
      expect(incremental).toEqual(full);
    }
  });

  it('does not re-highlight a settled fence when the tail grows', () => {
    let highlights = 0;
    const fence = '```js\nconst x = 1;\nconst y = 2;\n```\n\n';
    const md = makeMarkdown(`${fence}start`, () => {
      highlights += 1;
    });
    md.render(60);
    expect(highlights).toBe(1);
    md.setText(`${fence}start more words`);
    md.render(60);
    expect(highlights).toBe(1);
    md.setText(`${fence}start more words and a second line\n\nstill going`);
    md.render(60);
    expect(highlights).toBe(1);
  });

  it('re-highlights after a width change', () => {
    let highlights = 0;
    const fence = '```js\nconst x = 1;\n```\n\n';
    const md = makeMarkdown(`${fence}tail`, () => {
      highlights += 1;
    });
    md.render(60);
    md.setText(`${fence}tail grows`);
    md.render(40);
    expect(highlights).toBe(2);
  });
});
