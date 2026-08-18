import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveNativeRendererTraceExportPath } from '#/tui/controllers/diagnostics/native-renderer-diagnostics';

describe('resolveNativeRendererTraceExportPath', () => {
  it('defaults to the home log dir instead of the workspace', () => {
    const logDir = join('/tmp', 'home', 'logs');
    const resolved = resolveNativeRendererTraceExportPath({
      workDir: join('/tmp', 'workspace'),
      logDir,
      now: 1_700_000_000_000,
    });
    expect(resolved).toEqual({
      ok: true,
      outputPath: join(logDir, 'renderer-trace-1700000000000.json'),
    });
  });

  it('keeps an explicit workspace-relative path', () => {
    const workDir = resolve('/tmp', 'workspace');
    const resolved = resolveNativeRendererTraceExportPath({
      workDir,
      path: join('out', 'trace.json'),
    });
    expect(resolved).toEqual({
      ok: true,
      outputPath: resolve(workDir, 'out', 'trace.json'),
    });
  });

  it('rejects a path outside the workspace', () => {
    expect(
      resolveNativeRendererTraceExportPath({
        workDir: resolve('/tmp', 'workspace'),
        path: join('..', 'escape.json'),
      }),
    ).toEqual({ ok: false });
  });
});
