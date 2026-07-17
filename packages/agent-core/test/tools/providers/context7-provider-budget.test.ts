/**
 * Context7 provider token budgets — resolve/doc caps for long-session thrash control.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchLibrary = vi.fn();
const getContext = vi.fn();

vi.mock('@upstash/context7-sdk', () => ({
  Context7: class {
    searchLibrary = searchLibrary;
    getContext = getContext;
  },
  Context7Error: class Context7Error extends Error {
    name = 'Context7Error';
  },
}));

import { SdkContext7Provider } from '../../../src/tools/providers/context7';

describe('SdkContext7Provider budgets', () => {
  beforeEach(() => {
    searchLibrary.mockReset();
    getContext.mockReset();
  });

  it('caps library matches at 8 and renders compact resolve text', async () => {
    searchLibrary.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `/org/lib${i}`,
        name: `Lib${i}`,
        description: `desc ${i}`,
        totalSnippets: i,
        trustScore: 1,
        benchmarkScore: 1,
        versions: ['1.0.0'],
      })),
    );
    const provider = new SdkContext7Provider({ apiKey: 'test-key' });
    const matches = await provider.searchLibrary('hooks', 'react');
    expect(matches).toHaveLength(8);
    const text = await provider.searchLibraryText('hooks', 'react');
    expect(text).toContain('Context7-compatible library ID: /org/lib0');
    expect(text).toContain('/org/lib7');
    expect(text).not.toContain('/org/lib8');
  });

  it('caps documentation content and aggregate text budget', async () => {
    getContext.mockResolvedValue([
      {
        title: 'Huge',
        content: 'x'.repeat(6_000),
        source: 'https://example.com/docs',
      },
      {
        title: 'More',
        content: 'y'.repeat(6_000),
        source: 'https://example.com/more',
      },
      // 10 more would be capped by match count; keep 2 for content truncation focus
    ]);
    const provider = new SdkContext7Provider({ apiKey: 'test-key' });
    const docs = await provider.getContext('middleware', '/vercel/next.js');
    expect(docs[0]?.content.length).toBeLessThanOrEqual(4_001);
    expect(docs[0]?.content.endsWith('…')).toBe(true);
    const text = await provider.getContextText('middleware', '/vercel/next.js');
    expect(text.length).toBeLessThanOrEqual(12_200);
    expect(text).toContain('Huge');
  });
});
