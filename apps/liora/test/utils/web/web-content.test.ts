import { describe, expect, it } from 'vitest';

import {
  WEB_FETCH_MAX_BYTES,
  WEB_FETCH_TIMEOUT_MS,
  fetchWebContent,
  htmlToReadableText,
  normalizeWebUrl,
} from '#/utils/web/web-content';

describe('normalizeWebUrl', () => {
  it('adds https:// to a bare domain', () => {
    expect(normalizeWebUrl('example.com')).toBe('https://example.com/');
    expect(normalizeWebUrl('example.com/docs/intro')).toBe('https://example.com/docs/intro');
  });

  it('adds https:// to a bare host:port', () => {
    expect(normalizeWebUrl('localhost:58627')).toBe('https://localhost:58627/');
    expect(normalizeWebUrl('example.com:8080/x')).toBe('https://example.com:8080/x');
  });

  it('keeps an existing http(s) scheme', () => {
    expect(normalizeWebUrl('http://example.com/x')).toBe('http://example.com/x');
    expect(normalizeWebUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeWebUrl('   https://example.com/  ')).toBe('https://example.com/');
  });

  it('rejects non-http(s) schemes', () => {
    expect(normalizeWebUrl('file:///etc/passwd')).toBeUndefined();
    expect(normalizeWebUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeWebUrl('ftp://example.com/file')).toBeUndefined();
  });

  it('rejects empty and unparseable input', () => {
    expect(normalizeWebUrl('')).toBeUndefined();
    expect(normalizeWebUrl('   ')).toBeUndefined();
    expect(normalizeWebUrl('not a valid url')).toBeUndefined();
  });
});

describe('htmlToReadableText', () => {
  it('returns empty text for empty or whitespace-only html', () => {
    expect(htmlToReadableText('').text).toBe('');
    expect(htmlToReadableText('   \n\t ').text).toBe('');
    expect(htmlToReadableText('<html><head></head><body></body></html>').text).toBe('');
  });

  it('removes script and style content', () => {
    const html =
      '<p>alpha</p><script>var x = "secret";</script><style>.a { color: red; }</style><p>beta</p>';
    const { text } = htmlToReadableText(html);
    expect(text).toContain('alpha');
    expect(text).toContain('beta');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('color: red');
  });

  it('removes nav, footer, aside, and header chrome', () => {
    const html =
      '<header>site banner</header><nav>menu links</nav><main><p>body text</p></main>' +
      '<aside>sidebar</aside><footer>copyright</footer>';
    const { text } = htmlToReadableText(html);
    expect(text).toContain('body text');
    expect(text).not.toContain('site banner');
    expect(text).not.toContain('menu links');
    expect(text).not.toContain('sidebar');
    expect(text).not.toContain('copyright');
  });

  it('converts headings to # markers', () => {
    const { text } = htmlToReadableText('<h1>Top</h1><h2>Sub</h2><h3>Deep</h3>');
    expect(text).toContain('# Top');
    expect(text).toContain('## Sub');
    expect(text).toContain('### Deep');
  });

  it('converts list items to bullets', () => {
    const { text } = htmlToReadableText('<ul><li>One</li><li>Two</li></ul>');
    expect(text).toContain('• One');
    expect(text).toContain('• Two');
  });

  it('annotates links with their href unless text equals href', () => {
    const annotated = htmlToReadableText('<p><a href="https://ex.com">site</a></p>');
    expect(annotated.text).toContain('site (https://ex.com)');

    const bare = htmlToReadableText('<p><a href="https://ex.com">https://ex.com</a></p>');
    expect(bare.text).toContain('https://ex.com');
    expect(bare.text).not.toContain('(https://ex.com)');
  });

  it('renders img alt text in brackets', () => {
    const { text } = htmlToReadableText('<p><img src="x.png" alt="A diagram"></p>');
    expect(text).toContain('[A diagram]');
  });

  it('decodes named, numeric, and hex entities', () => {
    const { text } = htmlToReadableText(
      '<p>AT&amp;T &lt;tag&gt; &quot;q&quot; &#65;&#x42; a&mdash;b&hellip; x&nbsp;y</p>',
    );
    expect(text).toContain('AT&T <tag> "q" AB a—b… x y');
  });

  it('preserves pre indentation and newlines', () => {
    const { text } = htmlToReadableText('<p>before</p><pre>  line1\n    line2\n</pre><p>after</p>');
    expect(text).toContain('  line1\n    line2');
    expect(text).toContain('before');
    expect(text).toContain('after');
  });

  it('renders hr as a separator line', () => {
    const { text } = htmlToReadableText('<p>a</p><hr><p>b</p>');
    expect(text).toContain('─'.repeat(20));
  });

  it('takes the title from <title> and falls back to og:title', () => {
    const fromTitle = htmlToReadableText(
      '<html><head><title>  My Title </title></head><body><p>x</p></body></html>',
    );
    expect(fromTitle.title).toBe('My Title');

    const fromOg = htmlToReadableText(
      '<html><head><meta property="og:title" content="OG Title"></head><body><p>x</p></body></html>',
    );
    expect(fromOg.title).toBe('OG Title');

    expect(htmlToReadableText('<p>no title</p>').title).toBeUndefined();
  });

  it('collapses three or more blank lines to two', () => {
    const { text } = htmlToReadableText('<p>a</p><div></div><div></div><p></p><p>b</p>');
    expect(text).not.toContain('\n\n\n');
    expect(text).toContain('a');
    expect(text).toContain('b');
  });

  it('strips html comments', () => {
    const { text } = htmlToReadableText('<p>a</p><!-- secret comment --><p>b</p>');
    expect(text).not.toContain('secret comment');
  });
});

describe('fetchWebContent', () => {
  const jsonResponse = (body: string, init?: ResponseInit): Response =>
    new Response(body, init);

  it('exports the default timeout and byte cap', () => {
    expect(WEB_FETCH_TIMEOUT_MS).toBe(10_000);
    expect(WEB_FETCH_MAX_BYTES).toBe(1_000_000);
  });

  it('throws on an invalid URL', async () => {
    await expect(
      fetchWebContent('javascript:alert(1)', { fetchImpl: fetch }),
    ).rejects.toThrow(/invalid url/i);
  });

  it('throws with the status on non-2xx responses', async () => {
    const fetchImpl = (async () => jsonResponse('nope', { status: 404 })) as typeof fetch;
    await expect(fetchWebContent('example.com/missing', { fetchImpl })).rejects.toThrow(/404/);
  });

  it('passes plain text through unchanged', async () => {
    const fetchImpl = (async () =>
      jsonResponse('hello world', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })) as typeof fetch;
    const content = await fetchWebContent('example.com/file.txt', { fetchImpl });
    expect(content.body).toBe('hello world');
    expect(content.title).toBeUndefined();
    expect(content.contentType).toBe('text/plain');
    expect(content.truncated).toBe(false);
    expect(content.url).toBe('https://example.com/file.txt');
  });

  it('converts html and lifts the document title', async () => {
    const html = '<html><head><title>Docs</title></head><body><h1>Hi</h1><p>body</p></body></html>';
    const fetchImpl = (async () =>
      jsonResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })) as typeof fetch;
    const content = await fetchWebContent('https://example.com/', { fetchImpl });
    expect(content.title).toBe('Docs');
    expect(content.body).toContain('# Hi');
    expect(content.body).toContain('body');
    expect(content.contentType).toBe('text/html');
  });

  it('sets truncated when the body exceeds the byte cap', async () => {
    const fetchImpl = (async () =>
      jsonResponse('a'.repeat(500), { headers: { 'content-type': 'text/plain' } })) as typeof fetch;
    const content = await fetchWebContent('example.com/big', { fetchImpl, maxBytes: 100 });
    expect(content.truncated).toBe(true);
    expect(content.body).toBe('a'.repeat(100));
  });

  it('throws naming an unsupported content type', async () => {
    const fetchImpl = (async () =>
      jsonResponse('binary', { headers: { 'content-type': 'application/pdf' } })) as typeof fetch;
    await expect(fetchWebContent('example.com/doc.pdf', { fetchImpl })).rejects.toThrow(
      /application\/pdf/,
    );
  });

  it('rejects when the request times out', async () => {
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      })) as typeof fetch;
    await expect(
      fetchWebContent('example.com/slow', { fetchImpl, timeoutMs: 10 }),
    ).rejects.toThrow(/timed out after 10ms/i);
  });
});
