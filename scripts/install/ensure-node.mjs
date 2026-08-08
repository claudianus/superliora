/**
 * Ensure Node.js >= min version is available (user-local under ~/.superliora/runtime/node).
 */

import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import {
  DEFAULT_NODE_MIN,
  defaultRuntimeNodeDir,
  nodeDistSlug,
  nodeDistUrl,
  versionGte,
} from './platform.mjs';

/**
 * @returns {Promise<{ nodePath: string, version: string, bootstrapped: boolean }>}
 */
export async function ensureNode(options = {}) {
  const min = options.nodeMin ?? DEFAULT_NODE_MIN;
  const runtimeRoot = options.runtimeDir ?? defaultRuntimeNodeDir();
  const existing = resolveWorkingNode(min);
  if (existing) {
    return { nodePath: existing.path, version: existing.version, bootstrapped: false };
  }

  await mkdir(runtimeRoot, { recursive: true });
  const version = min;
  const slug = nodeDistSlug(version);
  const url = nodeDistUrl(version);
  const destRoot = `${runtimeRoot}/${slug}`;
  const marker = process.platform === 'win32'
    ? `${destRoot}/node.exe`
    : `${destRoot}/bin/node`;

  if (!existsSync(marker)) {
    const archivePath = `${runtimeRoot}/${slug}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
    await downloadFile(url, archivePath);
    await rm(destRoot, { recursive: true, force: true });
    await mkdir(destRoot, { recursive: true });
    if (process.platform === 'win32') {
      await extractZip(archivePath, runtimeRoot);
      // zip contains top-level slug folder already
    } else {
      await extractTarGz(archivePath, runtimeRoot);
    }
    await rm(archivePath, { force: true });
  }

  if (!existsSync(marker)) {
    throw new Error(`Node bootstrap failed: missing ${marker}`);
  }
  if (process.platform !== 'win32') {
    await chmod(marker, 0o755);
  }

  const versionOut = spawnSync(marker, ['-p', 'process.versions.node'], { encoding: 'utf8' });
  const versionGot = (versionOut.stdout ?? '').trim();
  if (!versionGte(versionGot, min)) {
    throw new Error(`Bootstrapped Node ${versionGot} is below required ${min}`);
  }

  // Prepend for this process + children.
  const binDir = process.platform === 'win32' ? destRoot : `${destRoot}/bin`;
  process.env.PATH = `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`;

  return { nodePath: marker, version: versionGot, bootstrapped: true };
}

function resolveWorkingNode(min) {
  const candidates = [];
  if (process.execPath) candidates.push(process.execPath);
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['node'], {
    encoding: 'utf8',
  });
  if (which.status === 0) {
    for (const line of which.stdout.split(/\r?\n/)) {
      if (line.trim()) candidates.push(line.trim());
    }
  }

  for (const path of candidates) {
    const probe = spawnSync(path, ['-p', 'process.versions.node'], { encoding: 'utf8' });
    if (probe.status !== 0) continue;
    const version = (probe.stdout ?? '').trim();
    if (versionGte(version, min)) return { path, version };
  }
  return null;
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  await mkdir(dirnameSafe(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function dirnameSafe(filePath) {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx >= 0 ? filePath.slice(0, idx) : '.';
}

async function extractTarGz(archivePath, destParent) {
  // Prefer system tar — no extra deps.
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destParent], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`tar extract failed: ${result.stderr || result.stdout || result.status}`);
  }
}

async function extractZip(archivePath, destParent) {
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${destParent.replaceAll("'", "''")}' -Force`,
      ],
      { encoding: 'utf8' },
    );
    if (ps.status !== 0) {
      throw new Error(`Expand-Archive failed: ${ps.stderr || ps.stdout || ps.status}`);
    }
    return;
  }
  const result = spawnSync('unzip', ['-o', archivePath, '-d', destParent], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`unzip failed: ${result.stderr || result.stdout || result.status}`);
  }
}
