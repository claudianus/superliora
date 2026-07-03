import type { BrowserUseRuntime, ComputerUseRuntime } from '@moonshot-ai/gui-use';
import { describe, expect, it, vi } from 'vitest';

import {
  BrowserActInputSchema,
  BrowserActTool,
  BrowserObserveInputSchema,
  BrowserObserveTool,
  BrowserStatusInputSchema,
  BrowserStatusTool,
  ComputerActInputSchema,
  ComputerActTool,
  ComputerCaptureInputSchema,
  ComputerCaptureTool,
} from '../../src/tools/builtin';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function context<Input>(args: Input, toolCallId = 'call_1') {
  return { turnId: '0', toolCallId, args, signal };
}

function fakeBrowserRuntime(overrides: Partial<BrowserUseRuntime> = {}): BrowserUseRuntime {
  return {
    status: vi.fn().mockResolvedValue({
      platform: 'darwin',
      installed: true,
      ready: true,
      version: 'cloakbrowser 0.4.5',
    }),
    observe: vi.fn().mockResolvedValue({
      ok: true,
      url: 'https://example.test/',
      title: 'Example',
      snapshot: '@e1 button "Go"',
      refs: [{ ref: '@e1', selector: 'button', role: 'button', name: 'Go', tag: 'button' }],
    }),
    screenshot: vi.fn(),
    act: vi.fn().mockResolvedValue({ ok: true, actions: [] }),
    console: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function fakeComputerRuntime(overrides: Partial<ComputerUseRuntime> = {}): ComputerUseRuntime {
  return {
    capture: vi.fn().mockResolvedValue({
      ok: true,
      mode: 'som',
      app: 'Finder',
      image: { base64: 'iVBORw0KGgo=', mimeType: 'image/png' },
      elements: [{ index: 1, role: 'button', name: 'Open' }],
    }),
    act: vi.fn().mockResolvedValue({ ok: true, actions: [] }),
    status: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe('browser-use builtin tools', () => {
  it('checks and prepares the bundled browser runtime before manual installs', async () => {
    const status = vi.fn().mockResolvedValue({
      platform: 'darwin',
      installed: true,
      ready: true,
      version: 'cloakbrowser 0.4.5',
    });
    const runtime = fakeBrowserRuntime({ status });
    const tool = new BrowserStatusTool(runtime);

    expect(BrowserStatusInputSchema.safeParse({ install_if_missing: true }).success).toBe(true);

    const result = await executeTool(tool, context({ install_if_missing: true }));

    expect(status).toHaveBeenCalledWith({ installIfMissing: true }, signal);
    expect(result.output).toContain('cloakbrowser 0.4.5');
    expect(result.isError).toBeFalsy();
  });

  it('maps observe schema to the browser runtime and returns refs', async () => {
    const runtime = fakeBrowserRuntime();
    const tool = new BrowserObserveTool(runtime);

    expect(BrowserObserveInputSchema.safeParse({
      url: 'https://example.test',
      include_screenshot: true,
    }).success).toBe(true);

    const result = await executeTool(tool, context({
      url: 'https://example.test',
      include_screenshot: true,
    }));

    expect(runtime.observe).toHaveBeenCalledWith({
      url: 'https://example.test',
      full: undefined,
      includeScreenshot: true,
    }, signal);
    expect(result.output).toContain('@e1');
  });

  it('executes batched actions and forwards capture_after', async () => {
    const act = vi.fn().mockResolvedValue({ ok: true, actions: [{ ok: true, action: 'click_ref' }] });
    const runtime = fakeBrowserRuntime({ act });
    const tool = new BrowserActTool(runtime);

    expect(BrowserActInputSchema.safeParse({
      actions: [{ type: 'click_ref', ref: '@e1' }],
      capture_after: true,
    }).success).toBe(true);

    const result = await executeTool(tool, context({
      actions: [{ type: 'click_ref', ref: '@e1' }],
      capture_after: true,
    }));

    expect(act).toHaveBeenCalledWith({
      actions: [{ type: 'click_ref', ref: '@e1' }],
      captureAfter: true,
    }, signal);
    expect(result.isError).toBeFalsy();
  });
});

describe('computer-use builtin tools', () => {
  it('returns SOM capture image and structured element text', async () => {
    const runtime = fakeComputerRuntime();
    const tool = new ComputerCaptureTool(runtime);

    expect(ComputerCaptureInputSchema.safeParse({ mode: 'som', max_elements: 10 }).success).toBe(true);

    const result = await executeTool(tool, context({ mode: 'som', max_elements: 10 }));

    expect(runtime.capture).toHaveBeenCalledWith({
      mode: 'som',
      app: undefined,
      maxElements: 10,
    }, signal);
    expect(Array.isArray(result.output)).toBe(true);
    expect(JSON.stringify(result.output)).toContain('\\"index\\": 1');
  });

  it('blocks destructive computer actions before reaching the runtime', async () => {
    const act = vi.fn();
    const runtime = fakeComputerRuntime({ act });
    const tool = new ComputerActTool(runtime);

    expect(ComputerActInputSchema.safeParse({
      actions: [{ type: 'type_text', text: 'sudo rm -rf /' }],
    }).success).toBe(true);

    const result = await executeTool(tool, context({
      actions: [{ type: 'type_text', text: 'sudo rm -rf /' }],
    }));

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Blocked type_text');
    expect(act).not.toHaveBeenCalled();
  });

  it('lets risky shortcuts reach the runtime so permission policy can gate them', async () => {
    const act = vi.fn().mockResolvedValue({ ok: true, actions: [{ ok: true, action: 'press_keys' }] });
    const runtime = fakeComputerRuntime({ act });
    const tool = new ComputerActTool(runtime);

    const result = await executeTool(tool, context({
      actions: [{ type: 'press_keys', keys: 'Cmd+Q' }],
    }));

    expect(result.isError).toBeFalsy();
    expect(act).toHaveBeenCalledWith({
      actions: [{ type: 'press_keys', keys: 'Cmd+Q' }],
      captureAfter: undefined,
    }, signal);
  });
});
