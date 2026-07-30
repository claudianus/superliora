import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadPluginLspServers,
  renderLspDiagnosticsReminder,
} from '../../src/plugin/lsp-bridge';
import type { PluginDiagnostic } from '../../src/plugin/types';

describe('plugin lsp bridge', () => {
  it('parses .lsp.json server defs', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lsp-bridge-'));
    const lspPath = path.join(dir, '.lsp.json');
    await writeFile(
      lspPath,
      JSON.stringify({
        typescript: {
          command: 'typescript-language-server',
          args: ['--stdio'],
        },
      }),
      'utf8',
    );
    const diagnostics: PluginDiagnostic[] = [];
    const servers = await loadPluginLspServers({ lspServersPath: lspPath, diagnostics });
    expect(servers).toEqual([
      {
        name: 'typescript',
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: undefined,
      },
    ]);
    expect(diagnostics).toHaveLength(0);

    const reminder = renderLspDiagnosticsReminder({ pluginId: 'demo', servers });
    expect(reminder).toContain('typescript-language-server');
    expect(reminder).toContain('demo');
  });
});
