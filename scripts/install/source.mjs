/**
 * Source checkout / archive + pnpm build fallback.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { downloadToFile } from './download.mjs';
import { ensurePnpm } from './ensure-pnpm.mjs';
import { spawnInstall } from './spawn.mjs';
import {
  DEFAULT_REF,
  DEFAULT_REPO,
  githubArchiveUrl,
  githubArchiveZipUrl,
} from './platform.mjs';

/**
 * @returns {Promise<{ installDir: string, method: 'git'|'archive' }>}
 */
export async function fetchSource(options) {
  const repoUrl = options.repoUrl ?? DEFAULT_REPO;
  const ref = options.ref ?? DEFAULT_REF;
  const installDir = options.installDir;
  const force = Boolean(options.force);

  if (existsSync(installDir) && !existsSync(join(installDir, '.git')) && !existsSync(join(installDir, 'package.json'))) {
    if (!force) {
      throw new Error(`${installDir} exists but is not a SuperLiora checkout; pass --force`);
    }
    await rm(installDir, { recursive: true, force: true });
  }

  if (hasGit() && (existsSync(join(installDir, '.git')) || !existsSync(installDir))) {
    await syncGit(repoUrl, ref, installDir, force);
    return { installDir, method: 'git' };
  }

  await fetchArchive(repoUrl, ref, installDir, force);
  return { installDir, method: 'archive' };
}

export async function buildSource(installDir, resolved) {
  const pnpm = resolved ?? (await ensurePnpm({ cwd: installDir }));
  if (!pnpm?.cmd) {
    throw new Error('pnpm bootstrap failed; SuperLiora could not install pnpm automatically');
  }
  runOrThrow(pnpm.cmd, [...pnpm.prefix ?? [], 'install', '--frozen-lockfile'], installDir);
  runOrThrow(pnpm.cmd, [...pnpm.prefix ?? [], 'run', 'build:packages'], installDir);
  runOrThrow(pnpm.cmd, [...pnpm.prefix ?? [], '-C', 'apps/liora', 'run', 'build'], installDir);
}

function runOrThrow(cmd, args, cwd) {
  const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
  const result = spawnInstall(cmd, args, { cwd, env, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with code ${result.status}`);
  }
}

function hasGit() {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

async function syncGit(repoUrl, ref, installDir, force) {
  if (existsSync(join(installDir, '.git'))) {
    runGit(['-C', installDir, 'remote', 'set-url', 'origin', repoUrl]);
    runGit(['-C', installDir, 'fetch', '--depth', '1', 'origin', ref]);
    runGit(['-C', installDir, '-c', 'advice.detachedHead=false', 'checkout', '--force', '-B', ref, 'FETCH_HEAD']);
    runGit(['-C', installDir, 'reset', '--hard', 'FETCH_HEAD']);
    return;
  }
  if (existsSync(installDir)) {
    if (!force) throw new Error(`${installDir} exists; pass --force`);
    await rm(installDir, { recursive: true, force: true });
  }
  await mkdir(dirname(installDir), { recursive: true });
  runGit(['clone', '--depth', '1', repoUrl, installDir]);
  runGit(['-C', installDir, 'fetch', '--depth', '1', 'origin', ref]);
  runGit(['-C', installDir, '-c', 'advice.detachedHead=false', 'checkout', '--force', '-B', ref, 'FETCH_HEAD']);
}

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed`);
  }
}

async function fetchArchive(repoUrl, ref, installDir, force) {
  if (existsSync(installDir)) {
    if (!force && existsSync(join(installDir, 'package.json'))) {
      // Refresh by replacing
    }
    await rm(installDir, { recursive: true, force: true });
  }
  await mkdir(dirname(installDir), { recursive: true });
  const cache = join(defaultHomeSafe(), '.superliora', 'cache', 'source');
  await mkdir(cache, { recursive: true });

  if (process.platform === 'win32') {
    const zipUrl = githubArchiveZipUrl(repoUrl, ref);
    if (!zipUrl) throw new Error(`Cannot derive archive URL from ${repoUrl}`);
    const zipPath = join(cache, `source-${ref}.zip`);
    await downloadToFile(zipUrl, zipPath);
    const extractTmp = join(cache, `extract-${ref}`);
    await rm(extractTmp, { recursive: true, force: true });
    await mkdir(extractTmp, { recursive: true });
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${extractTmp.replaceAll("'", "''")}' -Force`,
      ],
      { encoding: 'utf8' },
    );
    if (ps.status !== 0) throw new Error(`archive extract failed: ${ps.stderr}`);
    await promoteSingleChild(extractTmp, installDir);
    return;
  }

  const tarUrl = githubArchiveUrl(repoUrl, ref);
  if (!tarUrl) throw new Error(`Cannot derive archive URL from ${repoUrl}`);
  const tarPath = join(cache, `source-${ref}.tar.gz`);
  await downloadToFile(tarUrl, tarPath);
  const extractTmp = join(cache, `extract-${ref}`);
  await rm(extractTmp, { recursive: true, force: true });
  await mkdir(extractTmp, { recursive: true });
  const tar = spawnSync('tar', ['-xzf', tarPath, '-C', extractTmp], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(`tar extract failed: ${tar.stderr}`);
  await promoteSingleChild(extractTmp, installDir);
}

async function promoteSingleChild(extractTmp, installDir) {
  const { readdir, rename } = await import('node:fs/promises');
  const kids = await readdir(extractTmp);
  if (kids.length !== 1) {
    throw new Error(`Unexpected archive layout under ${extractTmp}`);
  }
  await mkdir(dirname(installDir), { recursive: true });
  await rm(installDir, { recursive: true, force: true });
  await rename(join(extractTmp, kids[0]), installDir);
}

function defaultHomeSafe() {
  return process.env.HOME ?? process.env.USERPROFILE ?? '.';
}
