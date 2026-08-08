/**
 * Prefer GitHub Release SEA zip + manifest.json.
 */

import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { downloadToFile, fetchJson } from './download.mjs';
import {
  DEFAULT_MANIFEST_URL,
  defaultHome,
  releaseTarget,
} from './platform.mjs';

/**
 * @returns {Promise<{ version: string, binaryPath: string, target: string }>}
 */
export async function installPrebuilt(options) {
  const manifestUrl = options.manifestUrl ?? DEFAULT_MANIFEST_URL;
  const target = options.target ?? releaseTarget();
  const binDir = options.binDir;
  const commandName = options.commandName ?? 'liora';
  const cacheDir = options.cacheDir ?? join(defaultHome(), '.superliora', 'cache', 'releases');

  const manifest = await fetchJson(manifestUrl);
  const entry = manifest?.platforms?.[target];
  if (!entry?.filename || !entry?.checksum) {
    throw new Error(`No prebuilt asset for target ${target} in ${manifestUrl}`);
  }

  const baseUrl = manifestUrl.replace(/\/manifest\.json$/i, '');
  const zipUrl = `${baseUrl}/${entry.filename}`;
  const zipPath = join(cacheDir, entry.filename);
  await mkdir(cacheDir, { recursive: true });
  await downloadToFile(zipUrl, zipPath, { expectedSha256: entry.checksum });

  const extractDir = join(cacheDir, `extract-${target}-${manifest.version ?? 'latest'}`);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  extractArchive(zipPath, extractDir);

  const execName = process.platform === 'win32' ? 'liora.exe' : 'liora';
  const extractedBinary = join(extractDir, execName);
  if (!existsSync(extractedBinary)) {
    throw new Error(`Prebuilt zip missing ${execName}`);
  }

  await mkdir(binDir, { recursive: true });
  const destName = process.platform === 'win32' ? `${commandName}.exe` : commandName;
  const destPath = join(binDir, destName);
  await copyFile(extractedBinary, destPath);
  if (process.platform !== 'win32') await chmod(destPath, 0o755);

  // Personas beside binary (SEA hydrate).
  const personasSrc = join(extractDir, 'catalog-personas.json');
  if (existsSync(personasSrc)) {
    await copyFile(personasSrc, join(binDir, 'catalog-personas.json'));
  }

  // Windows also write .cmd shim pointing at exe for PATH friends.
  if (process.platform === 'win32') {
    const cmdPath = join(binDir, `${commandName}.cmd`);
    await writeFile(
      cmdPath,
      `@echo off\r\nrem Managed by superliora install-superliora.mjs (SEA)\r\n"%~dp0${destName}" %*\r\n`,
      'utf8',
    );
  }

  return {
    version: String(manifest.version ?? ''),
    binaryPath: destPath,
    target,
    binDir,
  };
}

function extractArchive(zipPath, destDir) {
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destDir.replaceAll("'", "''")}' -Force`,
      ],
      { encoding: 'utf8' },
    );
    if (ps.status !== 0) {
      throw new Error(`Expand-Archive failed: ${ps.stderr || ps.stdout}`);
    }
    return;
  }
  const unzip = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { encoding: 'utf8' });
  if (unzip.status === 0) return;
  // macOS / some linux: tar can read zip
  const tar = spawnSync('tar', ['-xf', zipPath, '-C', destDir], { encoding: 'utf8' });
  if (tar.status !== 0) {
    throw new Error(`Failed to extract ${zipPath}: ${unzip.stderr || tar.stderr}`);
  }
}

export async function tryInstallPrebuilt(options) {
  try {
    const result = await installPrebuilt(options);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
