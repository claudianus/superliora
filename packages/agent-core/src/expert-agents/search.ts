import MiniSearch from 'minisearch';

import {
  expertPassageText,
  hashPassageCorpus,
  HybridRetriever,
  loadPassageIndex,
  resolveEmbeddingProvider,
  resolvePassageIndexPath,
  type EmbeddingProvider,
  type LoadedPassageIndex,
} from '../retrieval';
import { EXPERT_CATALOG_EXTENSIONS } from './catalog-extensions';
import { EXPERT_CATALOG_META } from './catalog-meta';
import { enrichExpertForCatalog } from './expert-persona';
import {
  applyStaffingDiversity,
  rewriteExpertSearchQuery,
} from './staffing-diversity';
import { scoreBoost as staffingOutcomeScoreBoost } from './staffing-outcome';
import { inferExpertTaskProfile, type ExpertTaskProfile } from './task-profile';
import type { ExpertCatalogEntry, ExpertSearchResult } from './types';

const ALL_EXPERTS: readonly ExpertCatalogEntry[] = [...EXPERT_CATALOG_META, ...EXPERT_CATALOG_EXTENSIONS];

export interface ExpertSearchOptions {
  readonly query: string;
  readonly topK?: number;
  readonly division?: string;
  readonly filter?: (expert: ExpertCatalogEntry) => boolean;
  /** When false, skip dense hybrid (sparse MiniSearch only). Default true. */
  readonly useEmbedding?: boolean;
  readonly preferredDivisions?: readonly string[];
  readonly excludedDivisions?: readonly string[];
  readonly taskDescription?: string;
  readonly minScore?: number;
  readonly signal?: AbortSignal;
}

export class ExpertSearchEngine {
  private readonly index: MiniSearch<ExpertCatalogEntry>;
  private readonly expertById: Map<string, ExpertCatalogEntry>;
  private readonly passages = new Map<string, string>();
  private initialized = false;
  private initPromise?: Promise<void>;
  private embedder?: EmbeddingProvider;
  private retriever?: HybridRetriever;
  private vectorIndex?: LoadedPassageIndex;
  private lastDegraded = false;
  private lastModelId = 'none';

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

  /** Whether the last search used a degraded (non-neural) embedder or sparse-only. */
  get degraded(): boolean {
    return this.lastDegraded;
  }

  get embedModelId(): string {
    return this.lastModelId;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise !== undefined) return this.initPromise;
    this.initPromise = this.doInitialize();
    try {
      await this.initPromise;
    } finally {
      if (!this.initialized) {
        this.initPromise = undefined;
      }
    }
  }

  private async doInitialize(): Promise<void> {
    const docs = ALL_EXPERTS.map((expert) => {
      const enriched = enrichExpertForCatalog(expert);
      return {
        ...enriched,
        tags: enriched.tags.join(' '),
        capabilities: enriched.capabilities.join(' '),
      };
    });
    this.index.addAll(docs as unknown as ExpertCatalogEntry[]);
    this.passages.clear();
    for (const expert of ALL_EXPERTS) {
      const enriched = enrichExpertForCatalog(expert);
      this.expertById.set(expert.id, expert);
      this.passages.set(
        expert.id,
        expertPassageText({
          name: enriched.name,
          description: enriched.description,
          whenToUse: enriched.whenToUse,
          tags: enriched.tags,
          capabilities: enriched.capabilities,
          vibe: enriched.vibe,
        }),
      );
    }

    this.embedder = await resolveEmbeddingProvider();
    this.retriever = new HybridRetriever(this.embedder);
    this.lastModelId = this.embedder.modelId;
    this.lastDegraded = this.embedder.degraded === true;

    const indexPath = resolvePassageIndexPath('expert');
    const loaded = loadPassageIndex(indexPath);
    const contentHash = hashPassageCorpus(this.passages);
    if (
      loaded !== undefined &&
      loaded.modelId === this.embedder.modelId &&
      loaded.contentHash === contentHash
    ) {
      this.vectorIndex = loaded;
    } else {
      this.vectorIndex = undefined;
    }

    this.initialized = true;
  }

  async search(options: ExpertSearchOptions): Promise<ExpertSearchResult[]> {
    if (!this.initialized) {
      throw new Error('ExpertSearchEngine not initialized. Call initialize() first.');
    }
    const topK = options.topK ?? 5;
    const minScore = options.minScore ?? 0.04;
    const taskProfile = resolveTaskProfile(options);
    const query = rewriteExpertSearchQuery(options.query);
    const normalizedDivision = options.division?.trim().toLowerCase();
    const matchesExplicitFilters = (expert: ExpertCatalogEntry): boolean =>
      (normalizedDivision === undefined || expert.division.toLowerCase() === normalizedDivision) &&
      (options.filter === undefined || options.filter(expert));

    const miniResults = this.index
      .search(query, {
        fuzzy: query.trim().length <= 3 ? 0.05 : 0.2,
      })
      .map((r) => {
        const expert = this.expertById.get(r.id);
        if (expert === undefined) return undefined;
        return { expert, score: r.score };
      })
      .filter((r): r is ExpertSearchResult => r !== undefined)
      .filter(({ expert }) => matchesExplicitFilters(expert));

    const useDense = options.useEmbedding !== false && this.retriever !== undefined;
    let ranked: ExpertSearchResult[];

    if (!useDense) {
      this.lastDegraded = true;
      ranked = miniResults;
    } else {
      const hybrid = await this.retriever!.search({
        query,
        sparseHits: miniResults.map((r) => ({ id: r.expert.id, score: r.score })),
        passages: this.passages,
        vectors: this.vectorIndex?.vectors,
        topK: topK * 3,
        signal: options.signal,
      });
      this.lastDegraded = hybrid.degraded;
      this.lastModelId = hybrid.modelId;
      ranked = hybrid.hits
        .map((hit) => {
          const expert = this.expertById.get(hit.id);
          if (expert === undefined || !matchesExplicitFilters(expert)) return undefined;
          return { expert, score: hit.score };
        })
        .filter((r): r is ExpertSearchResult => r !== undefined);
      // If hybrid returned nothing useful, fall back to sparse.
      if (ranked.length === 0) ranked = miniResults;
    }

    let results = ranked
      .map((result) => ({
        ...result,
        score: applyTaskProfileScore(result, taskProfile, options, normalizedDivision),
      }))
      .filter((result) => result.score >= minScore)
      .toSorted((a, b) => b.score - a.score);
    results = results.filter(({ expert }) => matchesExplicitFilters(expert));
    if (taskProfile.excludedDivisions.length > 0) {
      results = results.filter((r) => !taskProfile.excludedDivisions.includes(r.expert.division));
    }

    const pool = results.slice(0, Math.max(topK * 3, topK));
    return applyStaffingDiversity(pool, topK);
  }

  addExpert(expert: ExpertCatalogEntry): void {
    if (!this.initialized) {
      throw new Error('ExpertSearchEngine not initialized. Call initialize() first.');
    }
    this.expertById.set(expert.id, expert);
    const enriched = enrichExpertForCatalog(expert);
    this.passages.set(
      expert.id,
      expertPassageText({
        name: enriched.name,
        description: enriched.description,
        whenToUse: enriched.whenToUse,
        tags: enriched.tags,
        capabilities: enriched.capabilities,
        vibe: enriched.vibe,
      }),
    );
    this.index.add({
      ...expert,
      tags: expert.tags.join(' '),
      capabilities: expert.capabilities.join(' '),
    } as unknown as ExpertCatalogEntry);
  }

  removeExpert(id: string): boolean {
    if (!this.initialized) return false;
    this.expertById.delete(id);
    this.passages.delete(id);
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
  normalizedDivision: string | undefined,
): number {
  let score = result.score;
  const division = result.expert.division;
  if (taskProfile.preferredDivisions.includes(division)) score *= 1.35;
  if (taskProfile.excludedDivisions.includes(division)) score *= 0.12;
  if (normalizedDivision !== undefined && division.toLowerCase() === normalizedDivision) score *= 1.2;
  score *= staffingOutcomeScoreBoost(result.expert.id);
  return score;
}

export const globalExpertSearchEngine = new ExpertSearchEngine();
