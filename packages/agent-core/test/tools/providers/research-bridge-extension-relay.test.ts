/**
 * Covers: extension relay forward path on --serve (mock TCP relay client).
 */

import { createServer, type Server } from 'node:net';
import { connect, type Socket } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CHROME_EXT_URL_ENV,
  ChromeExtensionSearchChannel,
} from '../../../src/tools/providers/research-search-chrome-ext';
import {
  createExtensionRelayState,
  relayPortFromEnv,
  readNativeMessageAsync,
  writeNativeMessage,
  // @ts-expect-error native host is JS without a declaration file
} from '../../../scripts/research-bridge-native-host.mjs';

const agentCoreRoot = join(import.meta.dirname, '../../..');
const nativeHostScript = join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs');

function connectRelay(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
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

describe('research-bridge extension relay', () => {
  it('forwards search to attached relay socket and resolves results', async () => {
    const relay = createExtensionRelayState({ timeoutMs: 2_000 });
    const server = createServer((socket) => {
      relay.attachRelaySocket(socket);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const connected = new Promise<void>((resolve) => {
      server.once('connection', () => resolve());
    });
    const client = await connectRelay(address.port);
    await connected;

    const readPromise = (async () => {
      const message = await readNativeMessageAsync(client);
      expect(message?.type).toBe('search');
      writeNativeMessage(client, {
        type: 'search-result',
        id: message?.id,
        results: [
          {
            title: 'Relay hit',
            url: 'https://example.test/relay',
            snippet: 'Forwarded from mock extension',
          },
        ],
      });
    })();

    const results = await relay.forwardSearchToExtension('relay query', 3);
    await readPromise;
    expect(results).toEqual([
      {
        title: 'Relay hit',
        url: 'https://example.test/relay',
        snippet: 'Forwarded from mock extension',
      },
    ]);

    client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('resolveAllowedOrigins prefers --allowed-origin over --extension-id', async () => {
    const { resolveAllowedOrigins } = await import(
      // @ts-expect-error native host is JS without a declaration file
      '../../../scripts/research-bridge-native-host.mjs'
    );
    expect(
      resolveAllowedOrigins([
        '--write-manifest',
        '/tmp/x.json',
        '--extension-id',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '--allowed-origin',
        'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
      ]),
    ).toEqual(['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/']);
    expect(
      resolveAllowedOrigins(['--write-manifest', '/tmp/x.json', '--extension-id', 'abcd']),
    ).toEqual(['chrome-extension://abcd/']);
  });
});

describe('research-bridge --serve extension forward', () => {
  let child: ChildProcess | undefined;

  afterEach(async () => {
    const proc = child;
    child = undefined;
    await stopChild(proc);
  });

  it('returns extension relay results when mock client is connected', async () => {
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

    await output.waitFor('research-bridge serve ok', 5_000, 'serve startup timeout');

    // TCP accept is the attach signal. The host logs "extension relay connected"
    // in the same accept callback, so waiting on that string after connect races.
    const relayClient = await connectRelay(relayPort);

    const relayReady = (async () => {
      for (;;) {
        const message = await readNativeMessageAsync(relayClient);
        if (message === null) break;
        if (message.type === 'register') continue;
        if (message.type === 'search') {
          writeNativeMessage(relayClient, {
            type: 'search-result',
            id: message.id,
            results: [
              {
                title: `Ext: ${message.query}`,
                url: 'https://example.test/ext/1',
                snippet: 'Mock extension history hit',
              },
            ],
          });
          return;
        }
      }
    })();

    await new Promise((resolve) => setImmediate(resolve));

    const channel = new ChromeExtensionSearchChannel({
      env: {
        SUPERLIORA_CHROME_RESEARCH_BRIDGE: '1',
        [CHROME_EXT_URL_ENV]: serveUrl,
      } as NodeJS.ProcessEnv,
    });
    const results = await channel.search('logged-in history', 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toContain('Ext: logged-in history');
    expect(results[0]?.url).toContain('example.test/ext');

    relayClient.destroy();
    await relayReady.catch(() => undefined);
  });

  it('relayPortFromEnv honors explicit SUPERLIORA_RESEARCH_BRIDGE_RELAY_PORT', () => {
    expect(
      relayPortFromEnv({
        SUPERLIORA_CHROME_EXT_URL: 'http://127.0.0.1:32123/search',
        SUPERLIORA_RESEARCH_BRIDGE_RELAY_PORT: '40001',
      } as NodeJS.ProcessEnv),
    ).toBe(40_001);
  });
});
