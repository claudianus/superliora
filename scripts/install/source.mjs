/**
 * Source checkout / archive + pnpm build fallback.
 *
 * The managed install dir (~/.superliora/source) is replaced atomically.
 * A failed clone must never remain at that path as a detectible checkout.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { hasUsableGitObjectStore, isHealthySourceCheckout, summarizeGitFailure } from './checkout-health.mjs';
import { downloadToFile } from './download.mjs';
import { ensurePnpm } from './ensure-pnpm.mjs';
import { spawnInstall } from './spawn.mjs';
import {
  DEFAULT_REF,
  DEFAULT_REPO,
  githubArchiveUrl,
  githubArchiveZipUrl,
  resolveInstallHome,
} from './platform.mjs';

const MIN_FREE_BYTES = 512 * 1024 * 1024;

/**
 * @returns {Promise<{ installDir: string, method: 'git'|'archive' }>}
 */
export async function fetchSource(options) {
  const repoUrl = options.repoUrl ?? DEFAULT_REPO;
  const ref = options.ref ?? DEFAULT_REF;
  const installDir = options.installDir;
  const force = Boolean(options.force);
  const stagingDir = `${installDir}.partial`;

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(dirname(installDir), { recursive: true });
  await assertEnoughDisk(dirname(installDir));

  if (
    existsSync(installDir)
    && existsSync(join(installDir, '.git'))
    && !hasUsableGitObjectStore(installDir)
  ) {
    await rm(installDir, { recursive: true, force: true });
  } else if (
    existsSync(installDir)
    && !existsSync(join(installDir, '.git'))
    && !existsSync(join(installDir, 'package.json'))
  ) {
    if (!force) {
      throw new Error(`${installDir} exists but is not a SuperLiora checkout; pass --force`);
    }
    await rm(installDir, { recursive: true, force: true });
  }

  let gitError = null;
  if (hasGit() && (hasUsableGitObjectStore(installDir) || !existsSync(installDir))) {
    try {
      await syncGit(repoUrl, ref, installDir, stagingDir, force);
      return { installDir, method: 'git' };
    } catch (error) {
      gitError = error;
      await rm(stagingDir, { recursive: true, force: true });
    }
  }

  try {
    await fetchArchive(repoUrl, ref, installDir, force);
    return { installDir, method: 'archive' };
  } catch (archiveError) {
    const gitDetail = gitError instanceof Error ? summarizeGitFailure(gitError.message) : '';
    const archiveDetail = archiveError instanceof Error ? archiveError.message : String(archiveError);
    throw new Error(gitDetail ? `${gitDetail} · ${archiveDetail}` : archiveDetail, { cause: archiveError });
  }
}

export async function buildSource(installDir, resolved) {
  const pnpm = resolved ?? (await ensurePnpm({ cwd: installDir }));
  if (!pnpm?.cmd) {
    throw new Error('pnpm bootstrap failed; SuperLiora could not install pnpm automatically');
  }
  runOrThrow(pnpm.cmd, [...pnpm.prefix ?? [], 'install', '--frozen-lockfile'], installDir);
  runOrWarn(
    pnpm.cmd,
    [...pnpm.prefix ?? [], 'run', 'build:skill-catalog'],
    installDir,
    'skill catalog fetch failed; SearchSkill falls back to builtin skills (retry: pnpm run build:skill-catalog)',
  );
  runOrThrow(pnpm.cmd, [...pnpm.prefix ?? [], 'run', 'build:packages'], installDir);
  runOrThrow(pnpm.cmd, [...pnpm.prefix ?? [], '-C', 'apps/liora', 'run', 'build'], installDir);
}

function runOrWarn(cmd, args, cwd, warning) {
  const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
  const result = spawnInstall(cmd, args, { cwd, env, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) {
    process.stderr.write(`warning: ${warning}\n`);
  }
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

function withLongpaths(args) {
  if (args[0] === '-C') {
    return [args[0], args[1], '-c', 'core.longpaths=true', ...args.slice(2)];
  }
  return ['-c', 'core.longpaths=true', ...args];
}

async function syncGit(repoUrl, ref, installDir, stagingDir, force) {
  if (hasUsableGitObjectStore(installDir)) {
    runGit(['-C', installDir, 'remote', 'set-url', 'origin', repoUrl]);
    runGit(['-C', installDir, 'fetch', '--depth', '1', 'origin', ref]);
    runGit(['-C', installDir, '-c', 'advice.detachedHead=false', 'checkout', '--force', '-B', ref, 'FETCH_HEAD']);
    runGit(['-C', installDir, 'reset', '--hard', 'FETCH_HEAD']);
    runGit(['-C', installDir, 'config', 'core.longpaths', 'true']);
    if (!isHealthySourceCheckout(installDir)) {
      throw new Error('source checkout is incomplete after fetch');
    }
    return;
  }
  if (existsSync(installDir)) {
    if (!force && existsSync(join(installDir, 'package.json'))) {
      throw new Error(`${installDir} exists; pass --force`);
    }
    await rm(installDir, { recursive: true, force: true });
  }
  await mkdir(dirname(installDir), { recursive: true });
  await rm(stagingDir, { recursive: true, force: true });
  try {
    runGit(['clone', '--depth', '1', repoUrl, stagingDir]);
    runGit(['-C', stagingDir, 'fetch', '--depth', '1', 'origin', ref]);
    runGit(['-C', stagingDir, '-c', 'advice.detachedHead=false', 'checkout', '--force', '-B', ref, 'FETCH_HEAD']);
    runGit(['-C', stagingDir, 'config', 'core.longpaths', 'true']);
    if (!isHealthySourceCheckout(stagingDir)) {
      throw new Error('source checkout is incomplete after clone');
    }
    await rm(installDir, { recursive: true, force: true });
    await rename(stagingDir, installDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function runGit(args) {
  const argv = withLongpaths(args);
  const result = spawnSync('git', argv, { encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    const detail = summarizeGitFailure(`${result.stderr ?? ''}\n${result.stdout ?? ''}`);
    throw new Error(detail || `git ${args.join(' ')} failed`);
  }
}

async function assertEnoughDisk(dir) {
  try {
    const stats = await statfs(dir);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (Number.isFinite(free) && free >= 0 && free < MIN_FREE_BYTES) {
      throw new Error(
        `not enough free disk space to install from source (${Math.floor(free / 1024 / 1024)} MiB free; need at least 512 MiB)`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('not enough free disk')) {
      throw error;
    }
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
  const cache = join(resolveInstallHome(), 'cache', 'source');
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
  const { readdir } = await import('node:fs/promises');
  const kids = await readdir(extractTmp);
  if (kids.length !== 1) {
    throw new Error(`Unexpected archive layout under ${extractTmp}`);
  }
  await mkdir(dirname(installDir), { recursive: true });
  await rm(installDir, { recursive: true, force: true });
  await rename(join(extractTmp, kids[0]), installDir);
}


