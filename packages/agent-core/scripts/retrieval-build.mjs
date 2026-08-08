#!/usr/bin/env node
/**
 * Precompute expert + skill passage embeddings for hybrid SearchExpert/SearchSkill.
 *
 *   node scripts/retrieval-build.mjs
 *   SUPERLIORA_RETRIEVAL_EMBEDDER=hash node scripts/retrieval-build.mjs   # offline/fast
 *
 * Writes ~/.superliora/retrieval/{expert,skill}-passages.v1.json (or SUPERLIORA_HOME).
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function buildExpertPassages(retrieval) {
  const { EXPERT_CATALOG_META } = await import(
    pathToFileURL(join(root, 'src/expert-agents/catalog-meta.ts')).href
  );
  const { EXPERT_CATALOG_EXTENSIONS } = await import(
    pathToFileURL(join(root, 'src/expert-agents/catalog-extensions.ts')).href
  );
  const { enrichExpertForCatalog } = await import(
    pathToFileURL(join(root, 'src/expert-agents/expert-persona.ts')).href
  );

  const passages = new Map();
  for (const expert of [...EXPERT_CATALOG_META, ...EXPERT_CATALOG_EXTENSIONS]) {
    const enriched = enrichExpertForCatalog(expert);
    passages.set(
      expert.id,
      retrieval.expertPassageText({
        name: enriched.name,
        description: enriched.description,
        whenToUse: enriched.whenToUse,
        tags: enriched.tags,
        capabilities: enriched.capabilities,
        vibe: enriched.vibe,
      }),
    );
  }
  return passages;
}

async function buildSkillPassages(retrieval) {
  const indexPath = join(root, 'src/skill/catalog-search-index.json');
  const raw = await readFile(indexPath, 'utf8');
  const index = JSON.parse(raw);
  const passages = new Map();
  for (const entry of index.skills ?? []) {
    if (typeof entry?.name !== 'string' || entry.name.length === 0) continue;
    const id = retrieval.skillCatalogPassageId(entry);
    passages.set(
      id,
      retrieval.skillPassageText({
        name: entry.name,
        description: typeof entry.description === 'string' ? entry.description : '',
        whenToUse: typeof entry.whenToUse === 'string' ? entry.whenToUse : '',
      }),
    );
  }
  return passages;
}

async function writeKind(kind, passages, embedder, retrieval) {
  console.log(
    `retrieval-build[${kind}]: model=${embedder.modelId} degraded=${String(embedder.degraded === true)} count=${String(passages.size)}`,
  );
  const index = await retrieval.buildPassageIndex(passages, embedder);
  const path = retrieval.resolvePassageIndexPath(kind);
  retrieval.savePassageIndex(path, index);
  console.log(
    `retrieval-build[${kind}]: wrote ${path} vectors=${String(index.vectors.size)} hash=${index.contentHash}`,
  );
}

async function main() {
  const retrieval = await import(pathToFileURL(join(root, 'src/retrieval/index.ts')).href);
  const embedder = await retrieval.resolveEmbeddingProvider();

  const expertPassages = await buildExpertPassages(retrieval);
  await writeKind('expert', expertPassages, embedder, retrieval);

  const skillPassages = await buildSkillPassages(retrieval);
  if (skillPassages.size === 0) {
    console.warn('retrieval-build[skill]: skipped (empty catalog-search-index)');
    return;
  }
  await writeKind('skill', skillPassages, embedder, retrieval);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
