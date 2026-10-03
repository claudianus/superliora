#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..');
const WORKSPACE_ROOT = resolve(APP_ROOT, '../..');
const LAUNCH_CWD = process.env.SUPERLIORA_DEV_CWD || WORKSPACE_ROOT;
const env = { ...process.env };
env.SUPERLIORA_NO_AUTO_UPDATE ??= '1';
const tsxCli = require.resolve('tsx/cli');
const cliArgs = process.argv.slice(2);
if (cliArgs[0] === '--') cliArgs.shift();
const child = spawn(
  process.execPath,
  [
    tsxCli,
    // Use the dev tsconfig whose `include` covers packages/*/src, so tsx's
    // esbuild transform sees `experimentalDecorators: true` for DI parameter
    // decorators in agent-core. Mirrors `dev:server` in package.json.
    '--tsconfig',
    resolve(APP_ROOT, 'tsconfig.dev.json'),
    '--import',
    pathToFileURL(resolve(APP_ROOT, '../../build/register-raw-text-loader.mjs')).href,
    resolve(APP_ROOT, 'src/main.ts'),
    ...cliArgs,
  ],
  {
    cwd: LAUNCH_CWD,
    env,
    stdio: 'inherit',
  },
);

child.on('error', (error) => {
  console.error(`Failed to start SuperLiora dev CLI: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});
