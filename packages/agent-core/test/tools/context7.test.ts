/**
 * Covers: Context7ResolveTool, Context7DocsTool.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Context7Provider } from '../../src/tools/providers/context7';
import { Context7Error } from '../../src/tools/providers/context7';
import {
  Context7DocsInputSchema,
  Context7DocsTool,
} from '../../src/tools/builtin/web/context7-docs';
import {
  Context7ResolveInputSchema,
  Context7ResolveTool,
} from '../../src/tools/builtin/web/context7-resolve';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function fakeProvider(overrides: Partial<Context7Provider> = {}): Context7Provider {
  return {
    searchLibrary: vi.fn(async () => []),
    searchLibraryText: vi.fn(async () => '- Title: React\n- Context7-compatible library ID: /reactjs/react.dev'),
    getContext: vi.fn(async () => []),
    getContextText: vi.fn(async () => '## Middleware\n\nUse `middleware.ts` at the project root.'),
    ...overrides,
  };
}

describe('Context7ResolveTool', () => {
  it('has name "Context7Resolve" and a non-empty description', () => {
    const tool = new Context7ResolveTool(fakeProvider());
    expect(tool.name).toBe('Context7Resolve');
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('validates input schema', () => {
    expect(
      Context7ResolveInputSchema.safeParse({
        library_name: 'next.js',
        query: 'middleware auth',
      }).success,
    ).toBe(true);
  });

  it('returns formatted library matches', async () => {
    const provider = fakeProvider();
    const tool = new Context7ResolveTool(provider);
    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_ctx7_resolve',
      signal,
      args: {
        library_name: 'react',
        query: 'hooks',
      },
    });
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('/reactjs/react.dev');
    expect(provider.searchLibraryText).toHaveBeenCalledWith('hooks', 'react', {
      toolCallId: 'call_ctx7_resolve',
    });
  });

  it('classifies authentication failures', async () => {
    const tool = new Context7ResolveTool(
      fakeProvider({
        searchLibraryText: vi.fn(async () => {
          throw new Context7Error('Unauthorized: invalid API key');
        }),
      }),
    );
    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_ctx7_auth',
      signal,
      args: {
        library_name: 'react',
        query: 'hooks',
      },
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('authentication');
  });
});

describe('Context7DocsTool', () => {
  it('has name "Context7Docs" and a non-empty description', () => {
    const tool = new Context7DocsTool(fakeProvider());
    expect(tool.name).toBe('Context7Docs');
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('validates input schema', () => {
    expect(
      Context7DocsInputSchema.safeParse({
        library_id: '/vercel/next.js',
        query: 'middleware',
      }).success,
    ).toBe(true);
  });

  it('rejects invalid library_id format before calling provider', async () => {
    const provider = fakeProvider();
    const tool = new Context7DocsTool(provider);
    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_ctx7_docs_invalid',
      signal,
      args: {
        library_id: 'vercel/next.js',
        query: 'middleware',
      },
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('Invalid library_id');
    expect(provider.getContextText).not.toHaveBeenCalled();
  });

  it('returns documentation snippets for a valid library id', async () => {
    const provider = fakeProvider();
    const tool = new Context7DocsTool(provider);
    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_ctx7_docs',
      signal,
      args: {
        library_id: '/vercel/next.js',
        query: 'middleware auth',
      },
    });
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Middleware');
    expect(provider.getContextText).toHaveBeenCalledWith(
      'middleware auth',
      '/vercel/next.js',
      { toolCallId: 'call_ctx7_docs' },
    );
  });
});
