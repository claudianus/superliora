import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { run } from './exec.mjs';

const requireFromScript = createRequire(import.meta.url);
const tsdownCliPath = requireFromScript.resolve('tsdown/run');
const checkBundlePath = resolve(import.meta.dirname, 'check-bundle.mjs');
const copyPersonasPath = resolve(import.meta.dirname, '..', 'copy-expert-personas.mjs');

export async function runBundleStep() {
  await run(process.execPath, [tsdownCliPath, '--config', 'tsdown.native.config.ts']);
  // Persona bodies stay external (~4MB). Copy next to apps/liora/dist before SEA
  // packaging so runtime hydrate and native sidecars can find the JSON.
  await run(process.execPath, [copyPersonasPath]);
  await run(process.execPath, [checkBundlePath]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runBundleStep();
}
