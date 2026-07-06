#!/usr/bin/env node
/**
 * Build script: aggregates Agent Skills from multiple open-source catalogs
 * into packages/agent-core/src/skill/catalog/
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkillCatalog } from './lib/skill-catalog-sources.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'packages/agent-core/src/skill/catalog');
const includeExternal = process.argv.includes('--include-external');

buildSkillCatalog(outDir, { includeExternal })
  .then((manifest) => {
    console.log(`Wrote ${manifest.counts.written} skills to ${outDir}`);
    console.log('Counts:', manifest.counts);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
