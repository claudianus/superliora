#!/usr/bin/env node
/**
 * Ch5 Chrome extension research bridge — native-messaging host + loopback serve.
 *
 * Soft handshake only: length-prefixed JSON on stdio (Chrome Native Messaging).
 * Does not require a real Chrome install for local smoke tests.
 *
 *   node scripts/research-bridge-native-host.mjs --smoke
 *   node scripts/research-bridge-native-host.mjs --serve
 *   node scripts/research-bridge-native-host.mjs --write-manifest /tmp/com.superliora.research_bridge.json
 */
import { connect, createServer as createNetServer } from 'node:net';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import {
  handleLoopbackSearchRequest,
  stubSearchResults,
} from './research-bridge-search-stub.mjs';

const HOST_ID = 'com.superliora.research_bridge';
const HOST_VERSION = '0.1.0-stub';
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:32123/search';
const DEFAULT_RELAY_PORT = 32_124;
const EXTENSION_SEARCH_TIMEOUT_MS = 5_000;
const scriptPath = import.meta.filename;

/** @typedef {{ title: string; url: string; snippet: string }} SearchHit */

export function bridgeUrlFromEnv(env = process.env) {
  const configured = env.SUPERLIORA_CHROME_EXT_URL?.trim();
  return configured !== undefined && configured.length > 0 ? configured : DEFAULT_BRIDGE_URL;
}

export function parseBridgeListenTarget(urlStr) {
  const url = new URL(urlStr);
  return {
    hostname: url.hostname || '127.0.0.1',
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    pathname: url.pathname || '/search',
  };
}

export function relayPortFromEnv(env = process.env) {
  const configured = env.SUPERLIORA_RESEARCH_BRIDGE_RELAY_PORT?.trim();
  if (configured !== undefined && configured.length > 0) {
    const parsed = Number(configured);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const target = parseBridgeListenTarget(bridgeUrlFromEnv(env));
  return target.port + 1;
}

export function writeNativeMessage(out, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  out.write(Buffer.concat([header, body]));
}

export async function readNativeMessage(input) {
  const header = input.read(4);
  if (header === null || header.length < 4) return null;
  const length = header.readUInt32LE(0);
  if (length <= 0 || length > 1024 * 1024) return null;
  let body = Buffer.alloc(0);
  while (body.length < length) {
    const chunk = input.read(length - body.length);
    if (chunk === null) return null;
    body = Buffer.concat([body, chunk]);
  }
  return JSON.parse(body.toString('utf8'));
}

/** @type {WeakMap<object, { buffer: Buffer }>} */
const readStateByStream = new WeakMap();

function readStateFor(input) {
  let state = readStateByStream.get(input);
  if (state === undefined) {
    state = { buffer: Buffer.alloc(0) };
    readStateByStream.set(input, state);
  }
  return state;
}

export async function readNativeMessageAsync(input) {
  const state = readStateFor(input);
  while (!input.destroyed) {
    const chunk = input.read();
    if (chunk !== null) {
      state.buffer = Buffer.concat([state.buffer, chunk]);
    }

    if (state.buffer.length >= 4) {
      const length = state.buffer.readUInt32LE(0);
      if (length <= 0 || length > 1024 * 1024) {
        state.buffer = Buffer.alloc(0);
        continue;
      }
      if (state.buffer.length >= 4 + length) {
        const body = state.buffer.subarray(4, 4 + length);
        state.buffer = state.buffer.subarray(4 + length);
        return JSON.parse(body.toString('utf8'));
      }
    }

    await new Promise((resolve) => {
      if (typeof input.readableLength === 'number' && input.readableLength > 0) {
        resolve(undefined);
        return;
      }
      input.once('readable', resolve);
    });
  }
  return null;
}

export function handleMessage(message) {
  const type = message?.type;
  if (type === 'ping' || type === 'handshake') {
    return {
      type: 'pong',
      host: HOST_ID,
      version: HOST_VERSION,
      bridgeUrl: bridgeUrlFromEnv(),
      handshake: 'ok',
    };
  }
  if (type === 'search') {
    const query = typeof message.query === 'string' ? message.query : '';
    const limit = typeof message.limit === 'number' ? message.limit : 5;
    return {
      type: 'search-stub',
      query,
      limit,
      results: stubSearchResults(query, limit),
    };
  }
  return {
    type: 'error',
    error: 'unsupported_message',
    supported: ['ping', 'handshake', 'search'],
  };
}

export function createExtensionRelayState(options = {}) {
  const timeoutMs = options.timeoutMs ?? EXTENSION_SEARCH_TIMEOUT_MS;
  /** @type {import('node:net').Socket | null} */
  let extensionRelay = null;
  /** @type {Map<string, { resolve: (results: SearchHit[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>} */
  const pending = new Map();

  function clearPending(reason) {
    for (const [id, entry] of pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      pending.delete(id);
    }
  }

  function attachRelaySocket(socket) {
    extensionRelay = socket;
    /** @type {Buffer} */
    let buffer = Buffer.alloc(0);

    const pumpRelayReadable = () => {
      while (true) {
        const chunk = socket.read();
        if (chunk === null) return;
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
          const length = buffer.readUInt32LE(0);
          if (length <= 0 || length > 1024 * 1024) {
            buffer = Buffer.alloc(0);
            break;
          }
          if (buffer.length < 4 + length) return;
          const body = buffer.subarray(4, 4 + length);
          buffer = buffer.subarray(4 + length);
          let message;
          try {
            message = JSON.parse(body.toString('utf8'));
          } catch {
            continue;
          }
          if (message?.type === 'search-result' && typeof message.id === 'string') {
            const entry = pending.get(message.id);
            if (entry !== undefined) {
              clearTimeout(entry.timer);
              pending.delete(message.id);
              const rows = Array.isArray(message.results) ? message.results : [];
              entry.resolve(normalizeSearchHits(rows));
            }
          }
        }
      }
    };

    socket.on('readable', pumpRelayReadable);
    socket.on('close', () => {
      if (extensionRelay === socket) extensionRelay = null;
      clearPending('extension relay disconnected');
    });
    socket.on('error', () => {
      if (extensionRelay === socket) extensionRelay = null;
      clearPending('extension relay error');
    });
  }

  function isExtensionConnected() {
    return extensionRelay !== null && !extensionRelay.destroyed;
  }

  /**
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<SearchHit[] | null>}
   */
  async function forwardSearchToExtension(query, limit) {
    if (!isExtensionConnected() || extensionRelay === null) return null;
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('extension search timeout'));
      }, timeoutMs);
      pending.set(id, {
        resolve: (results) =>{  resolve(results); },
        reject,
        timer,
      });
      writeNativeMessage(extensionRelay, { type: 'search', id, query, limit });
    });
  }

  return {
    attachRelaySocket,
    forwardSearchToExtension,
    isExtensionConnected,
  };
}

/** @param {unknown[]} rows */
export function normalizeSearchHits(rows) {
  return rows
    .filter(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        typeof row.title === 'string' &&
        typeof row.url === 'string' &&
        typeof row.snippet === 'string',
    )
    .map((row) => ({
      title: row.title.trim(),
      url: row.url.trim(),
      snippet: row.snippet.trim(),
    }))
    .filter((row) => row.title.length > 0 && row.url.length > 0);
}

async function runStdioHost() {
  const relayPort = relayPortFromEnv();
  /** @type {import('node:net').Socket | null} */
  let relaySocket = null;

  const connectRelay = () => {
    const socket = connect({ host: '127.0.0.1', port: relayPort });
    socket.on('connect', () => {
      relaySocket = socket;
      writeNativeMessage(socket, { type: 'register', host: HOST_ID });
    });
    socket.on('close', () => {
      if (relaySocket === socket) relaySocket = null;
      setTimeout(connectRelay, 500);
    });
    socket.on('error', () => {
      socket.destroy();
    });
    socket.on('readable', () => {
      void (async () => {
        const message = await readNativeMessageAsync(socket);
        if (message === null) return;
        if (message.type === 'search') {
          writeNativeMessage(process.stdout, {
            type: 'search',
            query: typeof message.query === 'string' ? message.query : '',
            limit: typeof message.limit === 'number' ? message.limit : 5,
            id: typeof message.id === 'string' ? message.id : undefined,
          });
        }
      })();
    });
  };
  connectRelay();

  process.stdin.on('readable', () => {
    void (async () => {
      const message = await readNativeMessage(process.stdin);
      if (message === null) return;

      if (message.type === 'search-result' && relaySocket !== null && !relaySocket.destroyed) {
        writeNativeMessage(relaySocket, message);
        return;
      }

      writeNativeMessage(process.stdout, handleMessage(message));
    })();
  });
}

async function smokeHandshake() {
  const ping = { type: 'ping' };
  const pong = handleMessage(ping);
  if (pong.handshake !== 'ok' || pong.host !== HOST_ID) {
    throw new Error('handshake failed');
  }
  process.stdout.write(`research-bridge-native-host smoke ok (${HOST_VERSION})\n`);
}

export function resolveAllowedOrigins(args) {
  const allowedOriginIdx = args.indexOf('--allowed-origin');
  if (allowedOriginIdx !== -1) {
    const value = args[allowedOriginIdx + 1];
    if (value !== undefined && value.length > 0) {
      return [value.endsWith('/') ? value : `${value}/`];
    }
  }
  const extensionIdIdx = args.indexOf('--extension-id');
  if (extensionIdIdx !== -1) {
    const extensionId = args[extensionIdIdx + 1];
    if (extensionId !== undefined && extensionId.length > 0) {
      return [`chrome-extension://${extensionId}/`];
    }
  }
  return ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'];
}

export function writeManifest(targetPath, options = {}) {
  const absTarget = resolve(targetPath);
  mkdirSync(dirname(absTarget), { recursive: true });
  const manifest = {
    name: HOST_ID,
    description: 'SuperLiora Deep Research Ch5 bridge (native host)',
    path: scriptPath,
    type: 'stdio',
    allowed_origins: options.allowedOrigins ?? [
      'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
    ],
  };
  writeFileSync(absTarget, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote native messaging manifest: ${absTarget}\n`);
}

async function probeLoopbackOnce(bridgeUrl) {
  const response = await fetch(bridgeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: '__ch5_probe__', limit: 1 }),
  });
  if (!response.ok) {
    throw new Error(`loopback HTTP ${response.status}`);
  }
  const payload = await response.json();
  const rows = payload?.results;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('loopback empty results');
  }
  const row = rows[0];
  if (
    typeof row?.title !== 'string' ||
    typeof row?.url !== 'string' ||
    typeof row?.snippet !== 'string'
  ) {
    throw new TypeError('loopback malformed result');
  }
}

async function probeLoopback() {
  const bridgeUrl = bridgeUrlFromEnv();
  await probeLoopbackOnce(bridgeUrl);
  process.stdout.write(`research-bridge loopback ok (${bridgeUrl})\n`);
}

async function runServe() {
  const bridgeUrl = bridgeUrlFromEnv();
  const target = parseBridgeListenTarget(bridgeUrl);
  const relayPort = relayPortFromEnv();
  const relay = createExtensionRelayState();

  const relayServer = createNetServer((socket) => {
    relay.attachRelaySocket(socket);
    process.stdout.write(`research-bridge extension relay connected\n`);
    socket.on('close', () => {
      process.stdout.write(`research-bridge extension relay disconnected\n`);
    });
  });

  await new Promise((resolve, reject) => {
    relayServer.once('error', reject);
    relayServer.listen(relayPort, '127.0.0.1', resolve);
  });

  /**
   * @param {string} query
   * @param {number} limit
   */
  async function resolveSearchResults(query, limit) {
    if (relay.isExtensionConnected()) {
      try {
        const forwarded = await relay.forwardSearchToExtension(query, limit);
        if (forwarded !== null && forwarded.length > 0) return forwarded;
      } catch {
        // fall through to stub
      }
    }
    return stubSearchResults(query, limit);
  }

  const server = createServer((req, res) => {
    void handleLoopbackSearchRequest(req, res, {
      pathname: target.pathname,
      searchFn: resolveSearchResults,
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(target.port, target.hostname, resolve);
  });

  process.stdout.write(
    `research-bridge serve ok (${target.hostname}:${target.port}${target.pathname}, relay ${relayPort})\n`,
  );
}

function usage() {
  process.stderr.write(
    [
      'Usage:',
      '  node scripts/research-bridge-native-host.mjs            # stdio native host',
      '  node scripts/research-bridge-native-host.mjs --smoke    # local handshake smoke',
      '  node scripts/research-bridge-native-host.mjs --serve    # loopback POST /search (+ extension relay)',
      '  node scripts/research-bridge-native-host.mjs --probe-loopback  # verify loopback URL',
      '  node scripts/research-bridge-native-host.mjs --write-manifest <path> [--extension-id <id>] [--allowed-origin chrome-extension://ID/]',
      '',
    ].join('\n'),
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }
  if (args.includes('--smoke')) {
    await smokeHandshake();
    return;
  }
  if (args.includes('--serve')) {
    await runServe();
    return;
  }
  if (args.includes('--probe-loopback')) {
    await probeLoopback();
    return;
  }
  const writeIdx = args.indexOf('--write-manifest');
  if (writeIdx !== -1) {
    const target = args[writeIdx + 1];
    if (target === undefined || target.length === 0) {
      usage();
      process.exitCode = 1;
      return;
    }
    writeManifest(target, { allowedOrigins: resolveAllowedOrigins(args) });
    return;
  }
  if (!process.stdin.isTTY) {
    await runStdioHost();
    return;
  }
  usage();
}

const isMain =
  import.meta.url === new URL(process.argv[1] ?? '', 'file:').href ||
  import.meta.filename === resolve(process.argv[1] ?? '');

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
