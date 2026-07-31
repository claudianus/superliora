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
} from '../../../scripts/research-bridge-native-host.mjs';

const agentCoreRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const nativeHostScript = join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs');

function connectRelay(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.once('error', reject);
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
    if (child !== undefined && !child.killed) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child?.once('exit', () => resolve());
        setTimeout(resolve, 500);
      });
    }
    child = undefined;
  });

  it('returns extension relay results when mock client is connected', async () => {
    const port = 41_000 + Math.floor(Math.random() * 10_000);
    const serveUrl = `http://127.0.0.1:${port}/search`;
    const relayPort = port + 1;

    child = spawn(process.execPath, [nativeHostScript, '--serve'], {
      env: {
        ...process.env,
        [CHROME_EXT_URL_ENV]: serveUrl,
        SUPERLIORA_RESEARCH_BRIDGE_RELAY_PORT: String(relayPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('serve startup timeout')), 5_000);
      child?.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('research-bridge serve ok')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child?.once('error', reject);
    });

    const relayClient = await connectRelay(relayPort);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('relay connect timeout')), 2_000);
      child?.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('extension relay connected')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

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
