#!/usr/bin/env node
/**
 * Ch5 Chrome extension research bridge — native-messaging host stub.
 *
 * Soft handshake only: length-prefixed JSON on stdio (Chrome Native Messaging).
 * Does not require a real Chrome install for local smoke tests.
 *
 *   node scripts/research-bridge-native-host.mjs --smoke
 *   node scripts/research-bridge-native-host.mjs --write-manifest /tmp/com.superliora.research_bridge.json
 */
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_ID = 'com.superliora.research_bridge';
const HOST_VERSION = '0.1.0-stub';
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:32123/search';
const scriptPath = fileURLToPath(import.meta.url);

function bridgeUrlFromEnv() {
  const configured = process.env.SUPERLIORA_CHROME_EXT_URL?.trim();
  return configured !== undefined && configured.length > 0 ? configured : DEFAULT_BRIDGE_URL;
}

function writeNativeMessage(out, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  out.write(header);
  out.write(body);
}

async function readNativeMessage(input) {
  const header = input.read(4);
  if (header === null || header.length < 4) return null;
  const length = header.readUInt32LE(0);
  let body = Buffer.alloc(0);
  while (body.length < length) {
    const chunk = input.read(length - body.length);
    if (chunk === null) return null;
    body = Buffer.concat([body, chunk]);
  }
  return JSON.parse(body.toString('utf8'));
}

function handleMessage(message) {
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
    return {
      type: 'search-stub',
      query: typeof message.query === 'string' ? message.query : '',
      limit: typeof message.limit === 'number' ? message.limit : 5,
      results: [],
      hint: 'Ch5 native host stub — wire extension POST bridge for live hits.',
    };
  }
  return {
    type: 'error',
    error: 'unsupported_message',
    supported: ['ping', 'handshake', 'search'],
  };
}

async function runStdioHost() {
  process.stdin.on('readable', async () => {
    const message = await readNativeMessage(process.stdin);
    if (message === null) return;
    writeNativeMessage(process.stdout, handleMessage(message));
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

function writeManifest(targetPath) {
  const absTarget = resolve(targetPath);
  mkdirSync(dirname(absTarget), { recursive: true });
  const manifest = {
    name: HOST_ID,
    description: 'SuperLiora Deep Research Ch5 bridge (stub native host)',
    path: scriptPath,
    type: 'stdio',
    allowed_origins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],
  };
  writeFileSync(absTarget, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote native messaging manifest: ${absTarget}\n`);
}

function usage() {
  process.stderr.write(
    [
      'Usage:',
      '  node scripts/research-bridge-native-host.mjs            # stdio native host',
      '  node scripts/research-bridge-native-host.mjs --smoke    # local handshake smoke',
      '  node scripts/research-bridge-native-host.mjs --write-manifest <path>',
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
  const writeIdx = args.indexOf('--write-manifest');
  if (writeIdx !== -1) {
    const target = args[writeIdx + 1];
    if (target === undefined || target.length === 0) {
      usage();
      process.exitCode = 1;
      return;
    }
    writeManifest(target);
    return;
  }
  if (!process.stdin.isTTY) {
    await runStdioHost();
    return;
  }
  usage();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
