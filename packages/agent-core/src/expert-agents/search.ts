import MiniSearch from 'minisearch';
import type { ExpertCatalogEntry, ExpertSearchResult } from './types';
import { EXPERT_CATALOG_META } from './catalog-meta';
import { EXPERT_CATALOG_EXTENSIONS } from './catalog-extensions';
import { enrichExpertForCatalog } from './expert-persona';
import { inferExpertTaskProfile, type ExpertTaskProfile } from './task-profile';

const ALL_EXPERTS: readonly ExpertCatalogEntry[] = [...EXPERT_CATALOG_META, ...EXPERT_CATALOG_EXTENSIONS];

export interface ExpertSearchOptions {
  readonly query: string;
  readonly topK?: number;
  readonly division?: string;
  readonly filter?: (expert: ExpertCatalogEntry) => boolean;
  readonly useEmbedding?: boolean; // default true if available
  readonly preferredDivisions?: readonly string[];
  readonly excludedDivisions?: readonly string[];
  readonly taskDescription?: string;
  readonly minScore?: number;
}

export class ExpertSearchEngine {
  private readonly index: MiniSearch<ExpertCatalogEntry>;
  private readonly expertById: Map<string, ExpertCatalogEntry>;
  private initialized = false;
  private embeddingCache?: Map<string, readonly number[]>;

  constructor() {
    this.index = new MiniSearch({
      fields: ['name', 'description', 'vibe', 'tags', 'capabilities', 'division', 'divisionLabel'],
      storeFields: ['id'],
      searchOptions: {
        boost: { name: 3, description: 2, tags: 2, vibe: 1.5, capabilities: 1.5, division: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
    this.expertById = new Map();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const docs = ALL_EXPERTS.map((expert) => {
      const enriched = enrichExpertForCatalog(expert);
      return {
        ...enriched,
        tags: enriched.tags.join(' '),
        capabilities: enriched.capabilities.join(' '),
      };
    });
    this.index.addAll(docs as unknown as ExpertCatalogEntry[]);
    for (const expert of ALL_EXPERTS) {
      this.expertById.set(expert.id, expert);
    }
    // Cache embeddings for fast cosine similarity
    this.embeddingCache = new Map();
    for (const expert of ALL_EXPERTS) {
      if (expert.embedding !== undefined && expert.embedding.length > 0) {
        this.embeddingCache.set(expert.id, expert.embedding);
      }
    }
    this.initialized = true;
  }

  search(options: ExpertSearchOptions): ExpertSearchResult[] {
    if (!this.initialized) {
      throw new Error('ExpertSearchEngine not initialized. Call initialize() first.');
    }
    const topK = options.topK ?? 5;
    const minScore = options.minScore ?? 0.04;
    const taskProfile = resolveTaskProfile(options);
    const useEmbedding = options.useEmbedding !== false && this.embeddingCache !== undefined && this.embeddingCache.size > 0;

    // 1. Sparse search (MiniSearch)
    const miniResults = this.index.search(options.query, {
      fuzzy: options.query.trim().length <= 3 ? 0.05 : 0.2,
    }).map((r) => {
      const expert = this.expertById.get(r.id);
      if (expert === undefined) return undefined;
      return { expert, score: r.score };
    }).filter((r): r is ExpertSearchResult => r !== undefined);

    // Exact expert-id / short-name tokens in multi-word queries (required_experts discovery).
    const exactTokenHits = exactExpertTokenHits(options.query, this.expertById);
    const miniWithExact =
      exactTokenHits.length === 0
        ? miniResults
        : [
            ...exactTokenHits,
            ...miniResults.filter(
              (hit) => !exactTokenHits.some((exact) => exact.expert.id === hit.expert.id),
            ),
          ];

    // 2. Dense search (cosine similarity on embeddings) if available
    let denseResults: ExpertSearchResult[] = [];
    if (useEmbedding) {
      denseResults = this.denseSearch(options.query, topK * 2, taskProfile);
    }

    // 3. RRF fusion
    const fused = this.rrfFusion(miniWithExact, denseResults, topK * 3);

    // 4. Apply filters and task-aware reranking
    let results = fused
      .map((result) => ({
        ...result,
        score: applyTaskProfileScore(result, taskProfile, options),
      }))
      .filter((result) => result.score >= minScore)
      .sort((a, b) => b.score - a.score);
    if (options.division !== undefined) {
      results = results.filter((r) => r.expert.division === options.division);
    }
    if (options.filter !== undefined) {
      results = results.filter((r) => options.filter!(r.expert));
    }
    if (taskProfile.excludedDivisions.length > 0) {
      results = results.filter((r) => !taskProfile.excludedDivisions.includes(r.expert.division));
    }
    return results.slice(0, topK);
  }

  private denseSearch(query: string, topK: number, taskProfile: ExpertTaskProfile): ExpertSearchResult[] {
    if (!this.embeddingCache || this.embeddingCache.size === 0) return [];

    // For dense search without a query embedding model, we use a simple approach:
    // compute a pseudo-embedding from the query by averaging keyword-matched expert embeddings
    // This is a lightweight fallback when no query embedding is available at search time.
    const queryTerms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
    if (queryTerms.length === 0) return [];

    const scores = new Map<string, number>();
    for (const id of this.embeddingCache.keys()) {
      const expert = this.expertById.get(id);
      if (expert === undefined) continue;
      if (taskProfile.excludedDivisions.includes(expert.division)) continue;
      const text = `${expert.name} ${expert.description} ${expert.vibe} ${expert.tags.join(' ')} ${expert.capabilities.join(' ')}`.toLowerCase();
      const matches = queryTerms.filter((term) => text.includes(term)).length;
      if (matches > 0) {
        scores.set(id, matches / queryTerms.length);
      }
    }

    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    return sorted.map(([id, score]) => {
      const expert = this.expertById.get(id)!;
      return { expert, score };
    });
  }

  private rrfFusion(
    sparse: ExpertSearchResult[],
    dense: ExpertSearchResult[],
    topK: number,
    k: number = 60,
  ): ExpertSearchResult[] {
    const rrfScores = new Map<string, number>();
    const expertMap = new Map<string, ExpertCatalogEntry>();

    // Normalize MiniSearch scores to [0, 1]
    const maxSparseScore = sparse.length > 0 ? sparse[0]!.score : 1;

    for (let i = 0; i < sparse.length; i++) {
      const id = sparse[i]!.expert.id;
      expertMap.set(id, sparse[i]!.expert);
      const rankScore = 1.0 / (k + i + 1);
      const normScore = sparse[i]!.score / maxSparseScore;
      rrfScores.set(id, (rrfScores.get(id) ?? 0) + rankScore * 0.6 + normScore * 0.4);
    }

    for (let i = 0; i < dense.length; i++) {
      const id = dense[i]!.expert.id;
      expertMap.set(id, dense[i]!.expert);
      const rankScore = 1.0 / (k + i + 1);
      rrfScores.set(id, (rrfScores.get(id) ?? 0) + rankScore * 0.5);
    }

    const sorted = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    return sorted.map(([id, score]) => {
      const expert = expertMap.get(id);
      if (!expert) return undefined;
      return { expert, score };
    }).filter((r): r is ExpertSearchResult => r !== undefined);
  }

  addExpert(expert: ExpertCatalogEntry): void {
    if (!this.initialized) {
      throw new Error('ExpertSearchEngine not initialized. Call initialize() first.');
    }
    this.expertById.set(expert.id, expert);
    if (expert.embedding !== undefined && expert.embedding.length > 0 && this.embeddingCache !== undefined) {
      this.embeddingCache.set(expert.id, expert.embedding);
    }
    this.index.add({
      ...expert,
      tags: expert.tags.join(' '),
      capabilities: expert.capabilities.join(' '),
    } as unknown as ExpertCatalogEntry);
  }

  removeExpert(id: string): boolean {
    if (!this.initialized) return false;
    this.expertById.delete(id);
    this.embeddingCache?.delete(id);
    this.index.remove({ id } as unknown as ExpertCatalogEntry);
    return true;
  }

  getExpertById(id: string): ExpertCatalogEntry | undefined {
    return this.expertById.get(id);
  }

  getExpertsByDivision(division: string): ExpertCatalogEntry[] {
    return ALL_EXPERTS.filter((expert) => expert.division === division);
  }

  listAll(): ExpertCatalogEntry[] {
    return [...ALL_EXPERTS];
  }
}


/** Prefer exact expert ids when the full id appears as a token (required_experts discovery). */
function exactExpertTokenHits(
  query: string,
  expertById: ReadonlyMap<string, ExpertCatalogEntry>,
): ExpertSearchResult[] {
  const normalized = query.toLowerCase();
  // Multi-segment ids need contiguous token spans (e.g. design-brand-guardian).
  const hits: ExpertSearchResult[] = [];
  for (const expert of expertById.values()) {
    const id = expert.id.toLowerCase();
    if (id.length < 6) continue;
    // Word-boundary style: id must appear as its own token run in the query.
    const pattern = new RegExp(`(?:^|[^a-z0-9])${id.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`);
    if (pattern.test(normalized)) {
      hits.push({ expert, score: 1_000_000 });
    }
  }
  return hits.toSorted((a, b) => b.score - a.score || a.expert.id.localeCompare(b.expert.id));
}

function resolveTaskProfile(options: ExpertSearchOptions): ExpertTaskProfile {
  if (options.preferredDivisions !== undefined || options.excludedDivisions !== undefined) {
    return {
      technical: true,
      preferredDivisions: options.preferredDivisions ?? [],
      excludedDivisions: options.excludedDivisions ?? [],
    };
  }
  if (options.taskDescription !== undefined && options.taskDescription.length > 0) {
    return inferExpertTaskProfile(options.taskDescription);
  }
  return inferExpertTaskProfile(options.query);
}

function applyTaskProfileScore(
  result: ExpertSearchResult,
  taskProfile: ExpertTaskProfile,
  options: ExpertSearchOptions,
): number {
  let score = result.score;
  const division = result.expert.division;
  if (taskProfile.preferredDivisions.includes(division)) score *= 1.35;
  if (taskProfile.excludedDivisions.includes(division)) score *= 0.12;
  if (options.division !== undefined && division === options.division) score *= 1.2;
  return score;
}

export const globalExpertSearchEngine = new ExpertSearchEngine();
