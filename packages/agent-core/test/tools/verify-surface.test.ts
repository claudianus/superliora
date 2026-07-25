import type { BrowserUseRuntime } from '@superliora/gui-use';
import { describe, expect, it, vi } from 'vitest';

import {
  VerifySurfaceInputSchema,
  VerifySurfaceTool,
} from '../../src/tools/builtin/gui/verify-surface';
import { createFakeKaos } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function context(args: Record<string, unknown> = {}) {
  return { turnId: '0', toolCallId: 'call_vs', args, signal };
}

function fakeBrowserRuntime(overrides: Partial<BrowserUseRuntime> = {}): BrowserUseRuntime {
  return {
    status: vi.fn().mockResolvedValue({
      platform: 'darwin',
      installed: true,
      ready: true,
      version: 'cloakbrowser 0.4.5',
      provider: 'cloakbrowser',
    }),
    observe: vi.fn().mockResolvedValue({
      ok: true,
      url: 'https://example.test/',
      title: 'Example',
      snapshot: '@e1 button "Go"',
      refs: [{ ref: '@e1', selector: 'button', role: 'button', name: 'Go', tag: 'button' }],
    }),
    screenshot: vi.fn().mockResolvedValue({
      base64: Buffer.from('png').toString('base64'),
      mimeType: 'image/png',
    }),
    act: vi.fn().mockResolvedValue({ ok: true, actions: [] }),
    console: vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        { type: 'log', text: 'hello' },
        { type: 'error', text: 'boom' },
      ],
    }),
    close: vi.fn(),
    ...overrides,
  };
}

describe('VerifySurfaceTool', () => {
  it('accepts optional url and flags', () => {
    expect(VerifySurfaceInputSchema.safeParse({}).success).toBe(true);
    expect(
      VerifySurfaceInputSchema.safeParse({
        url: 'https://example.test',
        full: true,
        full_page: true,
      }).success,
    ).toBe(true);
  });

  it('returns a clear error (not a fake pass) when browser runtime is missing', async () => {
    const tool = new VerifySurfaceTool(undefined);
    const result = await executeTool(tool, context({ url: 'https://example.test' }));
    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.output)) as {
      pass: boolean;
      notes: string[];
      consoleErrors: string[];
    };
    expect(payload.pass).toBe(false);
    expect(payload.consoleErrors).toEqual([]);
    expect(payload.notes.join(' ')).toMatch(/runtime is not available|not a pass/i);
  });

  it('fails when runtime status is not ready', async () => {
    const runtime = fakeBrowserRuntime({
      status: vi.fn().mockResolvedValue({
        platform: 'darwin',
        installed: false,
        ready: false,
        error: 'CloakBrowser not installed',
      }),
    });
    const tool = new VerifySurfaceTool(runtime);
    const result = await executeTool(tool, context({}));
    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.output)) as { pass: boolean; notes: string[] };
    expect(payload.pass).toBe(false);
    expect(payload.notes.join(' ')).toContain('not ready');
  });

  it('passes when observe/screenshot succeed and console has no errors', async () => {
    const runtime = fakeBrowserRuntime({
      console: vi.fn().mockResolvedValue({
        ok: true,
        messages: [{ type: 'log', text: 'fine' }],
      }),
    });
    const written: Array<{ path: string; bytes: Buffer }> = [];
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      mkdir: async () => undefined,
      writeBytes: async (path, data) => {
        written.push({ path, bytes: data });
        return data.length;
      },
    });
    const tool = new VerifySurfaceTool(runtime, { kaos, cwd: '/work' });
    const result = await executeTool(tool, context({ url: 'https://example.test' }));
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.output)) as {
      pass: boolean;
      url?: string;
      screenshotPath?: string;
      consoleErrors: string[];
    };
    expect(payload.pass).toBe(true);
    expect(payload.url).toBe('https://example.test/');
    expect(payload.consoleErrors).toEqual([]);
    expect(payload.screenshotPath).toBeDefined();
    expect(written.length).toBe(1);
    expect(runtime.status).toHaveBeenCalled();
    expect(runtime.observe).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.test' }),
      signal,
    );
  });

  it('fails when console errors are present', async () => {
    const runtime = fakeBrowserRuntime();
    const tool = new VerifySurfaceTool(runtime);
    const result = await executeTool(tool, context({}));
    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.output)) as {
      pass: boolean;
      consoleErrors: string[];
    };
    expect(payload.pass).toBe(false);
    expect(payload.consoleErrors.some((line) => line.includes('boom'))).toBe(true);
  });
});
