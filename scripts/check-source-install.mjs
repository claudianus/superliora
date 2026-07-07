#!/usr/bin/env node
import { spawn } from 'node:child_process';

const steps = [
  {
    title: 'build workspace packages (includes @superliora/sdk build:dts)',
    command: 'corepack',
    args: ['pnpm', 'run', 'build:packages'],
  },
  {
    title: 'reject mistyped workspace imports',
    command: 'corepack',
    args: ['pnpm', 'run', 'check:imports'],
  },
  {
    title: 'build liora CLI bundle',
    command: 'corepack',
    args: ['pnpm', '-C', 'apps/liora', 'run', 'build'],
  },
  {
    title: 'smoke test bundled liora CLI',
    command: 'corepack',
    args: ['pnpm', '-C', 'apps/liora', 'run', 'smoke'],
  },
];

for (const step of steps) {
  process.stdout.write(`check:source-install ${step.title}\n`);
  await run(step.command, step.args);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
      reject(new Error(`check:source-install failed during "${command} ${args.join(' ')}" (${detail})`));
    });
  });
}
