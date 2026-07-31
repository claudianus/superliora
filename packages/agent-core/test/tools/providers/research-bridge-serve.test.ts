/**
 * Covers: Ch5 loopback search stub + ChromeExtensionSearchChannel fetch path.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CHROME_EXT_BRIDGE_ENV,
  CHROME_EXT_URL_ENV,
  ChromeExtensionSearchChannel,
} from '../../../src/tools/providers/research-search-chrome-ext';
import {
  handleLoopbackSearchRequest,
  stubSearchResults,
} from '../../../scripts/research-bridge-search-stub.mjs';

const agentCoreRoot = join(import.meta.dirname, '../../..');
const nativeHostScript = join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs');

function listenStubServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleLoopbackSearchRequest(req, res);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/search`,
      });
    });
  });
}

describe('research-bridge loopback stub', () => {
  it('returns deterministic non-empty hits for a query', () => {
    const results = stubSearchResults('superliora cascade', 3);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      title: expect.stringContaining('superliora cascade'),
      url: expect.stringContaining('example.test/ch5/'),
      snippet: expect.stringContaining('Deterministic Ch5 fixture'),
    });
  });

  it('returns [] for blank query', () => {
    expect(stubSearchResults('   ', 5)).toEqual([]);
  });

  it('ChromeExtensionSearchChannel fetches non-empty results via loopback handler', async () => {
    const { server, url } = await listenStubServer();
    try {
      const env = {
        [CHROME_EXT_BRIDGE_ENV]: '1',
        [CHROME_EXT_URL_ENV]: url,
      } as NodeJS.ProcessEnv;
      const channel = new ChromeExtensionSearchChannel({ env });
      const results = await channel.search('logged-in docs', 2);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.snippet).toContain('[chrome-ext]');
      expect(results[0]?.url).toContain('example.test');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error);
          else resolve();
        });
      });
    }
  });
});

describe('research-bridge --serve', () => {
  let child: ChildProcess | undefined;

  afterEach(async () => {
    if (child !== undefined && !child.killed) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child?.once('exit', () =>{  resolve(); });
        setTimeout(resolve, 500);
      });
    }
    child = undefined;
  });

  it('serves POST /search with fixture results', async () => {
    const port = 40_000 + Math.floor(Math.random() * 10_000);
    const serveUrl = `http://127.0.0.1:${port}/search`;

    child = spawn(process.execPath, [nativeHostScript, '--serve'], {
      env: {
        ...process.env,
        [CHROME_EXT_URL_ENV]: serveUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() =>{  reject(new Error('serve startup timeout')); }, 3_000);
      child?.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('research-bridge serve ok')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child?.once('error', reject);
    });

    const env = {
      [CHROME_EXT_BRIDGE_ENV]: '1',
      [CHROME_EXT_URL_ENV]: serveUrl,
    } as NodeJS.ProcessEnv;
    const channel = new ChromeExtensionSearchChannel({ env });
    const results = await channel.search('extension bridge', 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toContain('extension bridge');
  });
});
