import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PluginLspRuntime } from '../../src/plugin/lsp-runtime';

const FAKE_LSP_SOURCE = String.raw`
let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const total = headerEnd + 4 + length;
    if (buffer.length < total) return;
    const body = JSON.parse(buffer.subarray(headerEnd + 4, total).toString('utf8'));
    buffer = buffer.subarray(total);
    handle(body);
  }
});
function write(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  process.stdout.write('Content-Length: ' + String(body.length) + '\r\n\r\n');
  process.stdout.write(body);
}
function handle(msg) {
  if (msg.method === 'initialize') {
    write({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
    return;
  }
  if (msg.method === 'textDocument/didOpen') {
    const uri = msg.params.textDocument.uri;
    write({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        diagnostics: [{
          severity: 1,
          message: 'boom',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        }],
      },
    });
  }
}
`;

describe('PluginLspRuntime', () => {
  it('collects publishDiagnostics from a fake stdio server', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lsp-runtime-'));
    const serverPath = path.join(dir, 'fake-lsp.mjs');
    await writeFile(serverPath, FAKE_LSP_SOURCE, 'utf8');

    const runtime = new PluginLspRuntime(
      [
        {
          name: 'fake',
          command: process.execPath,
          args: [serverPath],
          extensionToLanguage: { '.ts': 'typescript' },
        },
      ],
      dir,
    );
    try {
      const text = await runtime.collectForFile(path.join(dir, 'a.ts'), 'const x = 1');
      expect(text).toContain('boom');
      expect(text).toContain('fake');
    } finally {
      await runtime.dispose();
    }
  });

  it('degrades when the binary is missing', async () => {
    const runtime = new PluginLspRuntime(
      [
        {
          name: 'missing',
          command: 'definitely-not-an-lsp-binary-xyz',
          args: [],
          extensionToLanguage: { '.ts': 'typescript' },
        },
      ],
      tmpdir(),
    );
    try {
      await expect(runtime.collectForFile('/tmp/a.ts', 'x')).resolves.toBeUndefined();
    } finally {
      await runtime.dispose();
    }
  }, 10_000);
});
