/**
 * Prefer GitHub Release SEA zip + manifest.json.
 */

import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { downloadToFile, fetchJson } from './download.mjs';
import {
  DEFAULT_MANIFEST_URL,
  commandFileName,
  defaultHome,
  manifestUrlForVersion,
  releaseTarget,
  seaBinaryName,
} from './platform.mjs';
import { spawnInstall, spawnOutputText } from './spawn.mjs';
import { renderWindowsSeaCmd } from './wrappers.mjs';

/**
 * @returns {Promise<{ version: string, binaryPath: string, target: string, binDir: string }>}
 */
export async function installPrebuilt(options) {
  const expectedVersion =
    typeof options.expectedVersion === 'string' && options.expectedVersion.trim().length > 0
      ? options.expectedVersion.trim().replace(/^v/, '')
      : null;
  const manifestUrl =
    options.manifestUrl ??
    (expectedVersion !== null ? manifestUrlForVersion(expectedVersion) : DEFAULT_MANIFEST_URL);
  const target = options.target ?? releaseTarget();
  const binDir = options.binDir;
  const commandName = options.commandName ?? 'liora';
  const cacheDir = options.cacheDir ?? join(defaultHome(), '.superliora', 'cache', 'releases');
  const skipVerify = options.skipVerify === true;

  const manifest = await fetchJson(manifestUrl);
  const entry = manifest?.platforms?.[target];
  if (!entry?.filename || !entry?.checksum) {
    throw new Error(`No prebuilt asset for target ${target} in ${manifestUrl}`);
  }

  const installedVersion = String(manifest.version ?? '').replace(/^v/, '');
  if (expectedVersion !== null && installedVersion && installedVersion !== expectedVersion) {
    throw new Error(
      `Release manifest version ${installedVersion} does not match requested ${expectedVersion}`,
    );
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

  const execName = seaBinaryName('liora');
  const extractedBinary = join(extractDir, execName);
  if (!existsSync(extractedBinary)) {
    throw new Error(`Prebuilt zip missing ${execName}`);
  }

  await mkdir(binDir, { recursive: true });
  const destName = seaBinaryName(commandName);
  const destPath = join(binDir, destName);

  await installBinaryAtomically(extractedBinary, destPath);

  // Personas beside binary (SEA hydrate).
  const personasSrc = join(extractDir, 'catalog-personas.json');
  if (existsSync(personasSrc)) {
    await copyFile(personasSrc, join(binDir, 'catalog-personas.json'));
  }

  // Windows also write .cmd shim pointing at exe for PATH friends.
  if (process.platform === 'win32') {
    const cmdPath = join(binDir, commandFileName(commandName, 'win32'));
    await writeFile(cmdPath, renderWindowsSeaCmd(destName), 'utf8');
    // A leftover source-install .ps1 wins over .cmd/.exe in PowerShell and
    // then dies on the default ExecutionPolicy.
    await unlink(join(binDir, `${commandName}.ps1`)).catch(() => {});
  }

  const verifyPath =
    process.platform === 'win32' ? join(binDir, commandFileName(commandName, 'win32')) : destPath;
  if (!skipVerify) {
    const verifyAgainst = expectedVersion ?? (installedVersion.length > 0 ? installedVersion : null);
    try {
      await verifyInstalledVersion(verifyPath, verifyAgainst);
    } catch (error) {
      await restoreBinaryBackup(destPath).catch(() => {});
      throw error;
    }
  }

  await unlink(`${destPath}.bak`).catch(() => {});

  return {
    version: installedVersion || String(manifest.version ?? ''),
    binaryPath: destPath,
    target,
    binDir,
  };
}

/**
 * Copy → tmp, park existing at .bak, rename tmp into place.
 * On Linux this avoids ETXTBSY from writing over a running SEA binary.
 */
export async function installBinaryAtomically(sourcePath, destPath) {
  const tmpPath = `${destPath}.tmp`;
  const bakPath = `${destPath}.bak`;
  await rm(tmpPath, { force: true }).catch(() => {});
  await copyFile(sourcePath, tmpPath);
  if (process.platform !== 'win32') await chmod(tmpPath, 0o755);

  if (existsSync(destPath)) {
    await rm(bakPath, { force: true }).catch(() => {});
    try {
      await rename(destPath, bakPath);
    } catch {
      // Windows may refuse rename of a locked exe — copy then overwrite via rename of tmp.
      await copyFile(destPath, bakPath);
      await unlink(destPath).catch(() => {});
    }
  }

  try {
    await rename(tmpPath, destPath);
  } catch (error) {
    await restoreBinaryBackup(destPath).catch(() => {});
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
  if (process.platform !== 'win32') await chmod(destPath, 0o755);
}

export async function restoreBinaryBackup(destPath) {
  const bakPath = `${destPath}.bak`;
  if (!existsSync(bakPath)) return false;
  await rm(destPath, { force: true }).catch(() => {});
  await rename(bakPath, destPath);
  return true;
}

async function verifyInstalledVersion(binaryPath, expectedVersion) {
  if (!expectedVersion) return;
  const result = spawnInstall(binaryPath, ['--version'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) {
    throw new Error(`Post-install version check failed to run: ${result.error.message}`);
  }
  const output = spawnOutputText(result);
  if (result.status !== 0) {
    throw new Error(
      `Post-install version check exited ${String(result.status)}: ${output}`.trim(),
    );
  }
  const want = expectedVersion.replace(/^v/, '');
  if (!output.includes(want)) {
    throw new Error(
      `Installed binary version mismatch (want ${want}, got ${JSON.stringify(output.trim())})`,
    );
  }
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
