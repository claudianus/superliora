import MiniSearch from 'minisearch';

import {
  HybridRetriever,
  hashPassageCorpus,
  loadPassageIndex,
  resolveEmbeddingProvider,
  resolvePassageIndexPath,
  skillDefinitionPassageId,
  skillPassageText,
  type EmbeddingProvider,
  type LoadedPassageIndex,
} from '../retrieval';
import type { SkillDefinition, SkillSearchHit } from './types';
import {
  skillCategory,
  skillRisk,
  summarizeSkillSearchHit,
} from './types';

export interface SkillSearchOptions {
  readonly query: string;
  readonly topK?: number;
  readonly filter?: (skill: SkillDefinition) => boolean;
  readonly useEmbedding?: boolean;
  readonly signal?: AbortSignal;
}

interface SkillSearchDocument {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly type: string;
  readonly source: string;
  readonly path: string;
  readonly arguments: string;
  readonly headings: string;
  readonly resources: string;
  readonly category: string;
  readonly risk: string;
}

export class SkillSearchEngine {
  private index: MiniSearch<SkillSearchDocument>;
  private readonly skillById = new Map<string, SkillDefinition>();
  private readonly passages = new Map<string, string>();
  private embedder?: EmbeddingProvider;
  private retriever?: HybridRetriever;
  private vectorIndex?: LoadedPassageIndex;
  private ready: Promise<void> | undefined;
  private lastDegraded = false;
  private lastModelId = 'none';

  constructor() {
    this.index = createIndex();
  }

  get degraded(): boolean {
    return this.lastDegraded;
  }

  get embedModelId(): string {
    return this.lastModelId;
  }

  initialize(skills: readonly SkillDefinition[]): void {
    this.index = createIndex();
    this.skillById.clear();
    this.passages.clear();
    const docs = skills.map((skill) => {
      const id = skillKey(skill);
      this.skillById.set(id, skill);
      this.passages.set(
        id,
        skillPassageText({
          name: skill.name,
          description: skill.description,
          whenToUse: metadataString(skill, 'whenToUse'),
          headings: skill.headings?.join(' ') ?? '',
        }),
      );
      return toSearchDocument(id, skill);
    });
    this.index.addAll(docs);
    this.ready = undefined;
    this.retriever = undefined;
    this.embedder = undefined;
    this.vectorIndex = undefined;
  }

  private async ensureRetriever(): Promise<HybridRetriever> {
    if (this.retriever !== undefined) return this.retriever;
    if (this.ready === undefined) {
      this.ready = (async () => {
        this.embedder = await resolveEmbeddingProvider();
        this.retriever = new HybridRetriever(this.embedder);
        this.lastModelId = this.embedder.modelId;
        this.lastDegraded = this.embedder.degraded === true;
        this.vectorIndex = remapSkillPassageIndex(
          loadPassageIndex(resolvePassageIndexPath('skill')),
          this.embedder.modelId,
          this.skillById,
          this.passages,
        );
      })();
    }
    await this.ready;
    return this.retriever!;
  }

  async search(options: SkillSearchOptions): Promise<SkillSearchHit[]> {
    const query = options.query.trim();
    if (query.length === 0) return [];
    const topK = options.topK ?? 5;

    const sparseMapped = this.index.search(query).map((result) => {
      const skill = this.skillById.get(result.id);
      if (skill === undefined) return undefined;
      if (options.filter !== undefined && !options.filter(skill)) return undefined;
      return {
        id: result.id,
        skill,
        score: result.score,
        matchReason: matchReason(result.terms),
      };
    }).filter(
      (result): result is { id: string; skill: SkillDefinition; score: number; matchReason: string } =>
        result !== undefined,
    );

    const exact = exactNameHits(query, this.skillById, options.filter);
    if (exact.length > 0) {
      // Exact / prefix name hits stay above hybrid ranking.
      const seen = new Set(exact.map((hit) => hit.name.toLowerCase()));
      const rest = await this.hybridRank(query, sparseMapped, topK, options);
      return [
        ...exact,
        ...rest.filter((hit) => !seen.has(hit.name.toLowerCase())),
      ].slice(0, topK);
    }

    if (options.useEmbedding === false) {
      this.lastDegraded = true;
      return sparseMapped
        .map((row) => summarizeSkillSearchHit(row.skill, row.score, row.matchReason))
        .slice(0, topK);
    }

    // No sparse hits → do not dense-rank the whole corpus (feature-hash/ONNX
    // will always invent a top-1 on tiny registries). Empty means empty.
    if (sparseMapped.length === 0) {
      this.lastDegraded = true;
      return [];
    }

    return this.hybridRank(query, sparseMapped, topK, options);
  }

  private async hybridRank(
    query: string,
    sparseMapped: readonly {
      id: string;
      skill: SkillDefinition;
      score: number;
      matchReason: string;
    }[],
    topK: number,
    options: SkillSearchOptions,
  ): Promise<SkillSearchHit[]> {
    const retriever = await this.ensureRetriever();
    const hybrid = await retriever.search({
      query,
      sparseHits: sparseMapped.map((row) => ({ id: row.id, score: row.score })),
      passages: this.passages,
      vectors: this.vectorIndex?.vectors,
      topK,
      signal: options.signal,
    });
    this.lastDegraded = hybrid.degraded;
    this.lastModelId = hybrid.modelId;

    const byId = new Map(sparseMapped.map((row) => [row.id, row]));
    const hits: SkillSearchHit[] = [];
    for (const hit of hybrid.hits) {
      const row = byId.get(hit.id);
      const skill = row?.skill ?? this.skillById.get(hit.id);
      if (skill === undefined) continue;
      if (options.filter !== undefined && !options.filter(skill)) continue;
      const reason =
        hit.matchReason === 'sparse'
          ? (row?.matchReason ?? 'matched indexed metadata')
          : `hybrid:${hit.matchReason}`;
      hits.push(summarizeSkillSearchHit(skill, hit.score, reason));
    }
    if (hits.length > 0) return hits.slice(0, topK);
    return sparseMapped
      .map((row) => summarizeSkillSearchHit(row.skill, row.score, row.matchReason))
      .slice(0, topK);
  }
}

function remapSkillPassageIndex(
  loaded: LoadedPassageIndex | undefined,
  modelId: string,
  skills: ReadonlyMap<string, SkillDefinition>,
  passages: ReadonlyMap<string, string>,
): LoadedPassageIndex | undefined {
  if (loaded === undefined || loaded.modelId !== modelId) return undefined;
  // Cache is keyed by catalogId; runtime MiniSearch ids are skillKey — remap.
  const vectors = new Map<string, Float32Array>();
  for (const [skillKey, skill] of skills) {
    const catalogId = skillDefinitionPassageId(skill);
    const vector =
      (catalogId !== undefined ? loaded.vectors.get(catalogId) : undefined) ??
      loaded.vectors.get(skillKey);
    if (vector !== undefined) vectors.set(skillKey, vector);
  }
  if (vectors.size === 0) return undefined;
  return {
    modelId: loaded.modelId,
    dimensions: loaded.dimensions,
    // Prefer live corpus hash so stale catalog rebuilds drop the cache.
    contentHash: hashPassageCorpus(passages),
    vectors,
  };
}

function createIndex(): MiniSearch<SkillSearchDocument> {
  return new MiniSearch<SkillSearchDocument>({
    fields: [
      'name',
      'description',
      'whenToUse',
      'type',
      'arguments',
      'headings',
      'resources',
      'category',
      'risk',
    ],
    storeFields: ['name'],
    searchOptions: {
      boost: { name: 5, description: 3, whenToUse: 3, headings: 2, resources: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
  });
}

function toSearchDocument(id: string, skill: SkillDefinition): SkillSearchDocument {
  return {
    id,
    name: skill.name,
    description: skill.description,
    whenToUse: metadataString(skill, 'whenToUse'),
    type: skill.metadata.type ?? '',
    source: skill.source,
    path: skill.path,
    arguments: skillArguments(skill),
    headings: skill.headings?.join(' ') ?? '',
    resources: skill.resources?.join(' ') ?? '',
    category: skillCategory(skill) ?? '',
    risk: skillRisk(skill) ?? '',
  };
}

function exactNameHits(
  query: string,
  skills: ReadonlyMap<string, SkillDefinition>,
  filter: ((skill: SkillDefinition) => boolean) | undefined,
): SkillSearchHit[] {
  const normalizedQuery = query.toLowerCase();
  const hits: SkillSearchHit[] = [];
  for (const skill of skills.values()) {
    if (filter !== undefined && !filter(skill)) continue;
    const normalizedName = skill.name.toLowerCase();
    if (normalizedName === normalizedQuery) {
      hits.push(summarizeSkillSearchHit(skill, 1_000_000, 'exact name'));
    } else if (normalizedName.startsWith(normalizedQuery)) {
      hits.push(summarizeSkillSearchHit(skill, 10_000, 'name prefix'));
    }
  }
  return hits.toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function skillKey(skill: SkillDefinition): string {
  return `${skill.source}\0${skill.path}\0${skill.name}`;
}

function metadataString(skill: SkillDefinition, key: string): string {
  const value = skill.metadata[key];
  return typeof value === 'string' ? value : '';
}

function skillArguments(skill: SkillDefinition): string {
  const value = skill.metadata.arguments;
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter((item): item is string => typeof item === 'string').join(' ');
}

function matchReason(terms: readonly string[] | undefined): string {
  if (terms === undefined || terms.length === 0) return 'matched indexed metadata';
  return `matched ${terms.slice(0, 5).join(', ')}`;
}
