/**
 * Covers: Ch5 loopback search stub + ChromeExtensionSearchChannel fetch path.
 */

import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CHROME_EXT_BRIDGE_ENV,
  CHROME_EXT_URL_ENV,
  ChromeExtensionSearchChannel,
} from '../../../src/tools/providers/research-search-chrome-ext';
import {
  handleLoopbackSearchRequest,
  stubSearchResults,
  // @ts-expect-error search stub is JS without a declaration file
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

function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('expected TCP address')));
        return;
      }
      const { port } = address;
      probe.close((error) => {
        if (error !== undefined) reject(error);
        else resolve(port);
      });
    });
  });
}

function attachOutputBuffer(proc: ChildProcess): {
  waitFor(needle: string, timeoutMs: number, label: string): Promise<void>;
} {
  let buf = '';
  const append = (chunk: Buffer) => {
    buf += chunk.toString();
  };
  proc.stdout?.on('data', append);
  proc.stderr?.on('data', append);
  return {
    waitFor(needle, timeoutMs, label) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          proc.stdout?.off('data', onData);
          proc.stderr?.off('data', onData);
          fn();
        };
        const onData = () => {
          if (buf.includes(needle)) finish(() => resolve());
        };
        const timeout = setTimeout(() => {
          finish(() => reject(new Error(`${label}\noutput:\n${buf}`)));
        }, timeoutMs);
        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
        proc.once('error', (error) => {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        });
        proc.once('exit', (code, signal) => {
          finish(() => reject(new Error(`${label}: child exited ${code ?? signal}\noutput:\n${buf}`)));
        });
        onData();
      });
    },
  };
}

async function stopChild(proc: ChildProcess | undefined): Promise<void> {
  if (proc === undefined || proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    proc.once('exit', done);
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!settled) proc.kill('SIGKILL');
      setTimeout(done, 200);
    }, 200);
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
    const proc = child;
    child = undefined;
    await stopChild(proc);
  });

  it('serves POST /search with fixture results', async () => {
    const port = await reserveFreePort();
    const relayPort = await reserveFreePort();
    const serveUrl = `http://127.0.0.1:${port}/search`;

    child = spawn(process.execPath, [nativeHostScript, '--serve'], {
      env: {
        ...process.env,
        [CHROME_EXT_URL_ENV]: serveUrl,
        SUPERLIORA_RESEARCH_BRIDGE_RELAY_PORT: String(relayPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = attachOutputBuffer(child);

    await output.waitFor('research-bridge serve ok', 8_000, 'serve startup timeout');

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
