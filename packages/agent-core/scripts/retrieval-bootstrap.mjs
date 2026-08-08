#!/usr/bin/env node
/**
 * Install-time retrieval warm-up:
 * 1) Ensure @huggingface/transformers can load Granite-97M ONNX (downloads under
 *    ~/.superliora/models/transformers on first run)
 * 2) Precompute expert + skill passage indexes via retrieval-build
 *
 *   node --import tsx scripts/retrieval-bootstrap.mjs
 *   SUPERLIORA_SKIP_RETRIEVAL=1 …   # no-op success
 *
 * Exit 1 on soft failure so install.sh can warn without aborting (set -e callers
 * should use `|| log warning`).
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function main() {
  if (process.env.SUPERLIORA_SKIP_RETRIEVAL === '1') {
    console.log('retrieval-bootstrap: skipped (SUPERLIORA_SKIP_RETRIEVAL=1)');
    return;
  }

  // Prefer real local ONNX even when CI=1 (install warm must not take the hash path).
  process.env.SUPERLIORA_RETRIEVAL_EMBEDDER = 'transformers';

  const { createTransformersEmbedder, DEFAULT_LOCAL_EMBED_MODEL, resetEmbeddingProviderCacheForTests } =
    await import(pathToFileURL(join(root, 'src/retrieval/index.ts')).href);

  resetEmbeddingProviderCacheForTests();
  console.log(`retrieval-bootstrap: loading ${DEFAULT_LOCAL_EMBED_MODEL}…`);
  const embedder = await createTransformersEmbedder();
  if (embedder === undefined) {
    throw new Error(
      'Failed to load @huggingface/transformers / Granite-97M ONNX. Check network and onnxruntime-node native build.',
    );
  }
  await embedder.embed(['superliora retrieval warmup']);
  console.log(`retrieval-bootstrap: model ready (${embedder.modelId})`);

  await runNode(['--import', 'tsx', join(__dirname, 'retrieval-build.mjs')]);
  console.log('retrieval-bootstrap: passage indexes written');
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`retrieval-build exited ${String(code)}`));
    });
  });
}

main().catch((error) => {
  console.error(`retrieval-bootstrap: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
