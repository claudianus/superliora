#!/usr/bin/env node
/**
 * Prove SuperLiora can host real Claude Code official plugins.
 * Runs the vitest suite against vendored anthropics/claude-plugins-official snapshots.
 *
 * Usage (from repo root or packages/agent-core):
 *   pnpm -C packages/agent-core run prove:claude-plugins
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(import.meta.dirname, '..');
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    'test/plugin/claude-official-proof.test.ts',
    'test/plugin/claude-migration-harness.test.ts',
  ],
  { cwd: pkgRoot, stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
