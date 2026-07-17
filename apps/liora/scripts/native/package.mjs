import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { ZipFile } from 'yazl';

import { appRoot, executableName, nativeArtifactsDir, nativeBinPath, targetTriple } from './paths.mjs';

const target = targetTriple();
const execName = executableName();
const sourceBinary = nativeBinPath(target);
const artifactsDir = nativeArtifactsDir();
const personasBesideBinary = resolve(dirname(sourceBinary), 'catalog-personas.json');
const personasFromCliDist = resolve(appRoot, 'dist', 'catalog-personas.json');

// Flat-name archive for GH Release (GitHub Release assets do not support subdirectories).
const artifactName = `liora-${target}.zip`;
const artifactPath = resolve(artifactsDir, artifactName);
const checksumPath = `${artifactPath}.sha256`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function sha256(path) {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

try {
  await stat(sourceBinary);
} catch {
  fail(`Native executable not found at ${sourceBinary}. Run build:native:sea first.`);
}

let personasPath;
try {
  await stat(personasBesideBinary);
  personasPath = personasBesideBinary;
} catch {
  try {
    await stat(personasFromCliDist);
    personasPath = personasFromCliDist;
  } catch {
    fail(
      `Expert personas not found next to the native binary (${personasBesideBinary}) or CLI dist (${personasFromCliDist}). Run copy-expert-personas / native inject first.`,
    );
  }
}

await mkdir(artifactsDir, { recursive: true });

const zip = new ZipFile();
zip.addFile(sourceBinary, execName, { mode: 0o100755 });
// Ship personas beside the binary so SEA hydrate can load them via execPath dirname.
zip.addFile(personasPath, 'catalog-personas.json');
zip.end();
await pipeline(zip.outputStream, createWriteStream(artifactPath));

const digest = await sha256(artifactPath);
await writeFile(checksumPath, `${digest}  ${basename(artifactPath)}\n`);

console.log(`Wrote native artifact: ${artifactPath}`);
console.log(`Wrote artifact checksum: ${checksumPath}`);
console.log(`Included expert personas: ${personasPath}`);
