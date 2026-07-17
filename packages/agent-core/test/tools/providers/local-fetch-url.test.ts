/**
 * Covers: LocalFetchURLProvider content-kind reporting.
 *
 * Verifies the provider tells callers whether the returned content is a
 * verbatim passthrough of the response body or the main text extracted
 * from an HTML page.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  extractLocalMainContent,
  isPrivateIp,
  LocalFetchURLProvider,
} from '../../../src/tools/providers/local-fetch-url';

// Disable DNS resolution for content-kind tests so they never touch the
// network resolver; the SSRF/DNS behavior has its own suite below.
function providerWith(fetchImpl: typeof fetch): LocalFetchURLProvider {
  return new LocalFetchURLProvider({ fetchImpl, resolveDns: false });
}

function htmlResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('LocalFetchURLProvider content kind', () => {
  it('reports text/plain bodies as a verbatim passthrough', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(htmlResponse('plain body', 'text/plain; charset=utf-8'));
    const provider = providerWith(fetchImpl);

    const result = await provider.fetch('https://example.com/file.txt');

    expect(result).toEqual({ content: 'plain body', kind: 'passthrough' });
  });

  it('reports text/markdown bodies as a verbatim passthrough', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(htmlResponse('# Title\n\nbody', 'text/markdown'));
    const provider = providerWith(fetchImpl);

    const result = await provider.fetch('https://example.com/readme.md');

    expect(result).toEqual({ content: '# Title\n\nbody', kind: 'passthrough' });
  });

  it('reports HTML bodies as extracted main content', async () => {
    const html =
      '<html><head><title>Doc</title></head><body><article>' +
      '<p>The quick brown fox jumps over the lazy dog. '.repeat(20) +
      '</p></article></body></html>';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(htmlResponse(html, 'text/html; charset=utf-8'));
    const provider = providerWith(fetchImpl);

    const result = await provider.fetch('https://example.com/page');

    expect(result.kind).toBe('extracted');
    expect(result.content).toContain('quick brown fox');
  });

  it('uses Defuddle markdown extraction for common documentation containers', async () => {
    const html = [
      '<html><head><title>SDK Guide</title></head><body>',
      '<nav>',
      'Navigation noise '.repeat(20),
      '</nav>',
      '<div class="markdown-body">',
      '<h1>Install</h1>',
      '<p>Use the built-in fetch path for source-backed research.</p>',
      '<pre><code class="language-js">const ok = true;</code></pre>',
      '</div>',
      '<footer>Footer noise</footer>',
      '</body></html>',
    ].join('');

    const result = await extractLocalMainContent(html, { url: 'https://example.com/sdk' });

    expect(result.source).toBe('selector');
    expect(result.selector).toBe('.markdown-body');
    expect(result.content).toContain('# SDK Guide');
    expect(result.content).toContain('Use the built-in fetch path');
    expect(result.content).toContain('```');
    expect(result.content).toContain('const ok = true;');
    expect(result.content).not.toContain('Navigation noise');
    expect(result.content).not.toContain('<div');
  });

  it('preserves structure and strips chrome on article pages', async () => {
    const html = [
      '<!doctype html><html><head><title>Sample Bug Report</title>',
      '<style>.nav{display:block}</style><script>var x=1</script></head><body>',
      '<nav>Home Docs Blog Login</nav>',
      '<aside>Related posts Sponsored</aside>',
      '<article>',
      '<h1>Sample Bug Report</h1>',
      '<p>The default parameter value for <code>optimizer</code> should probably be <code>adamw</code> instead of <code>adamW</code>.</p>',
      '<pre><code class="language-js">const x = 1;\nconsole.log(x);</code></pre>',
      '<ul><li>one</li><li>two</li></ul>',
      '</article>',
      '<footer>Copyright 2026</footer>',
      '</body></html>',
    ].join('');

    const result = await extractLocalMainContent(html, { url: 'https://example.com/bug' });

    expect(result.content).toContain('optimizer');
    expect(result.content).toContain('adamw');
    expect(result.content).toContain('```');
    expect(result.content).toContain('console.log(x);');
    expect(result.content).toMatch(/- one/);
    expect(result.content).not.toContain('<article>');
    expect(result.content).not.toContain('<script>');
    expect(result.content).not.toContain('Related posts');
  });
});

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    'localhost',
    'sub.localhost',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('flags %s as private', (address) => {
    expect(isPrivateIp(address), address).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1', // just outside the 172.16/12 private range
    '11.0.0.1',
    'example.com',
    '2001:4860:4860::8888',
  ])('does not flag %s as private', (address) => {
    expect(isPrivateIp(address), address).toBe(false);
  });
});

describe('LocalFetchURLProvider SSRF guard', () => {
  it('rejects private IPv4 literals without calling fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = providerWith(fetchImpl);

    await expect(provider.fetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /private host/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects localhost without calling fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = providerWith(fetchImpl);

    await expect(provider.fetch('http://localhost:8080/admin')).rejects.toThrow(/private host/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) schemes', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = providerWith(fetchImpl);

    await expect(provider.fetch('file:///etc/passwd')).rejects.toThrow(/scheme/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects URLs with embedded credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = providerWith(fetchImpl);

    await expect(provider.fetch('http://user:pass@example.com/')).rejects.toThrow(/credentials/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks a redirect to a private address (redirect-hop re-validation)', async () => {
    // First hop: a safe 302 redirect; second hop target is private.
    const redirectResponse = new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/secret' },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(redirectResponse);
    const provider = providerWith(fetchImpl);

    await expect(provider.fetch('https://example.com/redirect')).rejects.toThrow(
      /private host/,
    );
    // Only the first (safe) hop should have been fetched.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('follows a safe redirect and returns content', async () => {
    const redirectResponse = new Response(null, {
      status: 302,
      headers: { location: 'https://example.org/real' },
    });
    const finalResponse = htmlResponse('final content', 'text/plain');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirectResponse)
      .mockResolvedValueOnce(finalResponse);
    const provider = providerWith(fetchImpl);

    const result = await provider.fetch('https://example.com/redirect');

    expect(result).toEqual({ content: 'final content', kind: 'passthrough' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('caps redirect hops', async () => {
    const loopResponse = new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/loop' },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(loopResponse);
    const provider = new LocalFetchURLProvider({ fetchImpl, resolveDns: false, maxRedirects: 2 });

    await expect(provider.fetch('https://example.com/loop')).rejects.toThrow(/redirects/);
  });
});

