import MiniSearch from 'minisearch';
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

  constructor() {
    this.index = createIndex();
  }

  initialize(skills: readonly SkillDefinition[]): void {
    this.index = createIndex();
    this.skillById.clear();
    const docs = skills.map((skill) => {
      const id = skillKey(skill);
      this.skillById.set(id, skill);
      return toSearchDocument(id, skill);
    });
    this.index.addAll(docs);
  }

  search(options: SkillSearchOptions): SkillSearchHit[] {
    const query = options.query.trim();
    if (query.length === 0) return [];
    const topK = options.topK ?? 5;
    let results = this.index.search(query).map((result) => {
      const skill = this.skillById.get(result.id);
      if (skill === undefined) return undefined;
      if (options.filter !== undefined && !options.filter(skill)) return undefined;
      return summarizeSkillSearchHit(skill, result.score, matchReason(result.terms));
    }).filter((result): result is SkillSearchHit => result !== undefined);

    // Prefer exact/prefix name hits, then token-exact short skill names
    // (e.g. query "Word docx report" must surface skill "docx" first).
    const exact = [
      ...exactNameHits(query, this.skillById, options.filter),
      ...tokenExactNameHits(query, this.skillById, options.filter),
    ];
    if (exact.length > 0) {
      const seen = new Set(exact.map((hit) => hit.name.toLowerCase()));
      results = [
        ...exact,
        ...results.filter((hit) => !seen.has(hit.name.toLowerCase())),
      ];
    }
    return results.slice(0, topK);
  }
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

/** Token-level exact name boost for short skill ids inside multi-word queries. */
function tokenExactNameHits(
  query: string,
  skills: ReadonlyMap<string, SkillDefinition>,
  filter: ((skill: SkillDefinition) => boolean) | undefined,
): SkillSearchHit[] {
  const tokens = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9.+_-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && token.length <= 24),
  );
  if (tokens.size === 0) return [];
  const hits: SkillSearchHit[] = [];
  for (const skill of skills.values()) {
    if (filter !== undefined && !filter(skill)) continue;
    const normalizedName = skill.name.toLowerCase();
    if (!tokens.has(normalizedName)) continue;
    // Prefer short primary skill names (docx/pptx/xlsx/pdf) over long aliases.
    const lengthBoost = Math.max(0, 24 - normalizedName.length);
    hits.push(
      summarizeSkillSearchHit(skill, 100_000 + lengthBoost, `token name:${normalizedName}`),
    );
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
