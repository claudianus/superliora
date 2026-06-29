#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..');
const WORKSPACE_ROOT = resolve(APP_ROOT, '../..');
const LAUNCH_CWD = process.env.KIMI_CODE_DEV_CWD || WORKSPACE_ROOT;

const cliArgs = process.argv.slice(2);
if (cliArgs[0] === '--') cliArgs.shift();

const child = spawn(
  process.execPath,
  [
    require.resolve('tsx/cli'),
    '--tsconfig',
    resolve(APP_ROOT, 'tsconfig.dev.json'),
    '--import',
    resolve(APP_ROOT, '../../build/register-raw-text-loader.mjs'),
    resolve(APP_ROOT, 'src/main.ts'),
    ...cliArgs,
  ],
  {
    cwd: LAUNCH_CWD,
    env: process.env,
    stdio: 'inherit',
  },
);

child.on('error', (error) => {
  console.error(`Failed to start Kimi Code dev CLI: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});
