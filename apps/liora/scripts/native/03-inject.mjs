import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { fail, run, tryRun } from './exec.mjs';
import {
  appRoot,
  nativeBinDir,
  nativeBinPath,
  nativeBlobPath,
  SEA_SENTINEL_FUSE,
  targetTriple,
} from './paths.mjs';

function postjectPath() {
  const command = process.platform === 'win32' ? 'postject.cmd' : 'postject';
  return resolve(appRoot, 'node_modules/.bin', command);
}

async function ensureBlobExists() {
  try {
    await stat(nativeBlobPath());
  } catch {
    fail(`SEA blob not found at ${nativeBlobPath()}. Run 02-sea-blob.mjs first.`);
  }
}

async function copyNodeExecutable(target) {
  await mkdir(nativeBinDir(target), { recursive: true });
  const out = nativeBinPath(target);
  await copyFile(process.execPath, out);
  if (process.platform !== 'win32') {
    await run('chmod', ['755', out]);
  }
}

async function copyPersonasBesideBinary(target) {
  const out = nativeBinPath(target);
  const dest = resolve(dirname(out), 'catalog-personas.json');
  const candidates = [
    resolve(appRoot, 'dist', 'catalog-personas.json'),
    resolve(appRoot, '../..', 'packages/agent-core/src/expert-agents/catalog-personas.json'),
  ];
  for (const source of candidates) {
    try {
      await stat(source);
      await copyFile(source, dest);
      console.log(`Copied expert personas beside native binary: ${dest}`);
      return;
    } catch {
      // try next candidate
    }
  }
  fail(
    `Expert personas missing for native inject. Expected one of:\n${candidates.map((p) => `  - ${p}`).join('\n')}`,
  );
}

async function removeSignatureIfNeeded(target) {
  const out = nativeBinPath(target);
  if (process.platform === 'darwin') {
    await tryRun('codesign', ['--remove-signature', out]);
  }
  if (process.platform === 'win32') {
    await tryRun('signtool', ['remove', '/s', out]);
  }
}

async function injectSeaBlob(target) {
  const out = nativeBinPath(target);
  const args = [out, 'NODE_SEA_BLOB', nativeBlobPath(), '--sentinel-fuse', SEA_SENTINEL_FUSE];
  if (process.platform === 'darwin') {
    args.push('--macho-segment-name', 'NODE_SEA');
  }
  await run(postjectPath(), args);
}

export async function runInjectStep() {
  const target = targetTriple();
  await ensureBlobExists();
  await copyNodeExecutable(target);
  await copyPersonasBesideBinary(target);
  await removeSignatureIfNeeded(target);
  await injectSeaBlob(target);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runInjectStep();
}
