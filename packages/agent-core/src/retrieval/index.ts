export { cosineSimilarity, l2Normalize, rankByCosine } from './cosine';
export { createFeatureHashEmbedder } from './feature-hash-embedder';
export { HybridRetriever } from './hybrid-retriever';
export {
  buildPassageIndex,
  expertPassageText,
  hashPassageCorpus,
  loadPassageIndex,
  resolvePassageIndexPath,
  savePassageIndex,
  skillCatalogPassageId,
  skillDefinitionPassageId,
  skillPassageText,
  type LoadedPassageIndex,
  type PassageIndexFile,
} from './passage-index';
export {
  resetEmbeddingProviderCacheForTests,
  resolveEmbeddingProvider,
} from './resolve-embedder';
export { fuseSparseDenseRrf } from './rrf';
export { createTransformersEmbedder } from './transformers-embedder';
export {
  DEFAULT_EMBED_DIM,
  DEFAULT_LOCAL_EMBED_MODEL,
  RETRIEVAL_SCHEMA_VERSION,
  type DenseHit,
  type EmbeddingProvider,
  type HybridHit,
  type HybridSearchInput,
  type HybridSearchResult,
  type PassageRecord,
  type SparseHit,
} from './types';
