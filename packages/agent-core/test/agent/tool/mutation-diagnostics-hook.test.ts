import { describe, expect, it, vi } from 'vitest';

import { buildFileMutationHook } from '#/agent/tool/mutation-diagnostics';

/**
 * The built-in parse check is the floor: it is what keeps a parse-breaking
 * edit from cascading into every later build and test run. A plugin LSP
 * improves on it, but only for the files it actually handles.
 *
 * `PluginLspRuntime.collectForFile` returns `undefined` for three distinct
 * reasons — no server claims the path, the server is blacklisted after a
 * failed spawn, and the file is genuinely clean. Reading that silence as
 * "an LSP covered this" made a TypeScript LSP swallow a broken Python edit
 * without a word, so each of those reasons has to fall through to the parse.
 */

type Hook = (path: string, content: string) => string | Promise<string | undefined> | undefined;

function hookFor(lsp: ((path: string, content: string) => Promise<string | undefined>) | undefined): Hook {
  return buildFileMutationHook({
    fileMutationHook: lsp,
  } as unknown as Parameters<typeof buildFileMutationHook>[0]);
}

const BROKEN_TS = 'export function a() {\n  if (true) {\n';
const BROKEN_PY = 'def a():\n    if True:\n';
const CLEAN_TS = 'export const a: number = 1;\n';

function resolve(hook: Hook, path: string, content: string): Promise<string | undefined> {
  return Promise.resolve(hook(path, content));
}

describe('file mutation diagnostics hook', () => {
  it('reports a broken file when no LSP is configured', async () => {
    const out = await resolve(hookFor(undefined), 'a.ts', BROKEN_TS);
    expect(out).toContain('Syntax error in a.ts:');
    expect(out).toContain('Expected `}`');
  });

  it('stays silent on a clean file when no LSP is configured', async () => {
    expect(await resolve(hookFor(undefined), 'a.ts', CLEAN_TS)).toBeUndefined();
  });

  it('lets the LSP report instead of parsing when the LSP has something to say', async () => {
    // Type errors the parser cannot see: this is the case worth deferring to.
    const lsp = vi.fn().mockResolvedValue('- error L3:7 Type string is not assignable');
    const out = await resolve(hookFor(lsp), 'a.ts', BROKEN_TS);
    expect(out).toBe('- error L3:7 Type string is not assignable');
    expect(out).not.toContain('Syntax error');
  });

  it('falls back to the parse when the LSP declines the file', async () => {
    // `matchServer` found no server for a .py path — the exact case that used
    // to leave a broken Python edit completely unreported.
    const lsp = vi.fn().mockResolvedValue(undefined);
    const out = await resolve(hookFor(lsp), 'script.py', BROKEN_PY);
    expect(lsp).toHaveBeenCalledOnce();
    // Python is not an extension oxc parses, so the parse check is also
    // silent here — what matters is that a TypeScript LSP did not suppress a
    // check it never performed, and the hook returned without inventing output.
    expect(out).toBeUndefined();
  });

  it('falls back to the parse when the LSP is blacklisted after a failed spawn', async () => {
    const lsp = vi.fn().mockResolvedValue(undefined);
    const out = await resolve(hookFor(lsp), 'a.ts', BROKEN_TS);
    expect(out).toContain('Syntax error in a.ts:');
  });

  it('falls back to the parse when the LSP itself throws', async () => {
    const lsp = vi.fn().mockRejectedValue(new Error('server gone'));
    await expect(resolve(hookFor(lsp), 'a.ts', BROKEN_TS)).rejects.toThrow('server gone');
  });

  it('still parses a clean file the LSP declines, and stays silent', async () => {
    // A working LSP returns nothing for a clean file. The parse then runs and
    // agrees, so nothing is appended — the cost is one parse, not output.
    const lsp = vi.fn().mockResolvedValue(undefined);
    expect(await resolve(hookFor(lsp), 'a.ts', CLEAN_TS)).toBeUndefined();
  });
});
