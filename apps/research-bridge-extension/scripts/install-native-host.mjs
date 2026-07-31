#!/usr/bin/env node
/**
 * Install Chrome native-messaging manifest for com.superliora.research_bridge.
 *
 * Usage:
 *   node scripts/install-native-host.mjs --extension-id <id>
 *   node scripts/install-native-host.mjs --allowed-origin chrome-extension://ID/
 *   node scripts/install-native-host.mjs --platform macos|linux
 */
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_ID = 'com.superliora.research_bridge';
const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const agentCoreRoot = join(extensionRoot, '../../packages/agent-core');
const nativeHostScript = join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs');

function parseArgs(argv) {
  const args = { platform: process.platform === 'darwin' ? 'macos' : 'linux' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--extension-id') args.extensionId = argv[++i];
    else if (arg === '--allowed-origin') args.allowedOrigin = argv[++i];
    else if (arg === '--platform') args.platform = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function manifestTarget(platform) {
  const home = homedir();
  if (platform === 'macos') {
    return join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts', `${HOST_ID}.json`);
  }
  return join(home, '.config/google-chrome/NativeMessagingHosts', `${HOST_ID}.json`);
}

function usage() {
  process.stderr.write(
    [
      'Install SuperLiora research-bridge native messaging host manifest.',
      '',
      'Usage:',
      '  pnpm -C apps/research-bridge-extension run install:native-host -- --extension-id <id>',
      '  pnpm -C apps/research-bridge-extension run install:native-host -- --allowed-origin chrome-extension://ID/',
      '',
      'Options:',
      '  --extension-id <id>           Derive allowed origin from unpacked extension ID',
      '  --allowed-origin <origin>     Explicit chrome-extension://…/ origin',
      '  --platform macos|linux        Target manifest directory (default: auto)',
      '',
    ].join('\n'),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (args.extensionId === undefined && args.allowedOrigin === undefined) {
    process.stderr.write(
      'error: provide --extension-id or --allowed-origin (load unpacked first, copy ID from chrome://extensions)\n',
    );
    process.exitCode = 1;
    return;
  }

  const target = manifestTarget(args.platform);
  const hostArgs = [nativeHostScript, '--write-manifest', target];
  if (args.allowedOrigin !== undefined) {
    hostArgs.push('--allowed-origin', args.allowedOrigin);
  } else if (args.extensionId !== undefined) {
    hostArgs.push('--extension-id', args.extensionId);
  }

  const result = spawnSync(process.execPath, hostArgs, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return;
  }

  process.stdout.write('\nNext steps:\n');
  process.stdout.write('1. Load apps/research-bridge-extension unpacked in chrome://extensions\n');
  process.stdout.write('2. Restart Chrome (or reload extension) so native host reconnects\n');
  process.stdout.write('3. Start loopback: node packages/agent-core/scripts/research-bridge-native-host.mjs --serve\n');
}

main();
