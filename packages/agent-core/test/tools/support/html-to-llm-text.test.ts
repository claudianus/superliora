/**
 * Covers: htmlToLlmText Defuddle integration.
 */

import { describe, expect, it } from 'vitest';

import { htmlToLlmText } from '../../../src/tools/support/html-to-llm-text';

describe('htmlToLlmText', () => {
  it('returns markdown with code fences instead of raw HTML tags', async () => {
    const html = [
      '<html><head><title>Demo</title></head><body>',
      '<article>',
      '<h1>Demo</h1>',
      '<p>Hello <strong>world</strong>.</p>',
      '<pre><code class="language-ts">const n: number = 1;</code></pre>',
      '</article>',
      '</body></html>',
    ].join('');

    const result = await htmlToLlmText(html, { url: 'https://example.com/demo' });

    expect(result.title).toBe('Demo');
    expect(result.content).toContain('Hello');
    expect(result.content).toContain('world');
    expect(result.content).toContain('```');
    expect(result.content).toContain('const n: number = 1;');
    expect(result.content).not.toContain('<article>');
    expect(result.content).not.toContain('<strong>');
  });

  it('honors maxChars soft truncation', async () => {
    const body = 'word '.repeat(500);
    const html = `<html><body><article><p>${body}</p></article></body></html>`;
    const result = await htmlToLlmText(html, { maxChars: 120 });
    expect(result.content.length).toBeLessThanOrEqual(140);
    expect(result.content).toContain('[...truncated]');
  });
});
