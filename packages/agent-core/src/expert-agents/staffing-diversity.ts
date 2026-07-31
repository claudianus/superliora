/**
 * Staffing 2.0 helpers: query rewrite for Hangul/technical tokens and
 * post-search diversity so swarm rosters do not collapse into near-duplicate experts.
 */

import type { ExpertCatalogEntry, ExpertSearchResult } from './types';

/** Default cap for how many experts may share one division in a shortlist. */
export const DEFAULT_MAX_PER_DIVISION = 2;

/**
 * How many leading id path segments form the "prefix" for near-duplicate detection.
 * `engineering-frontend-developer` → `engineering-frontend`.
 */
export const DEFAULT_ID_PREFIX_SEGMENTS = 2;

export interface StaffingDiversityOptions {
  /** Max experts kept for the same division. Default 2. */
  readonly maxPerDivision?: number;
  /** Leading id segments used for near-duplicate grouping. Default 2. */
  readonly idPrefixSegments?: number;
  /**
   * When true, still fill remaining slots from skipped candidates if the
   * diverse shortlist is shorter than `limit`. Default true.
   */
  readonly fillRemainder?: boolean;
}

export interface RewriteExpertSearchQueryOptions {
  /**
   * When Hangul is present, append mapped English technical tokens.
   * Default true.
   */
  readonly appendEnglishTokens?: boolean;
  /**
   * Drop common non-technical Korean filler particles/phrases.
   * Default true.
   */
  readonly stripNoise?: boolean;
}

/** Small Hangul → English technical token map (high-signal only). */
const HANGUL_TECH_TOKEN_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/터미널|터미날/g, 'terminal'],
  [/대시보드/g, 'dashboard'],
  [/렌더러|렌더링/g, 'renderer'],
  [/컴포넌트/g, 'component'],
  [/타입스크립트|타입\s*스크립트/g, 'TypeScript'],
  [/자바스크립트|자바\s*스크립트/g, 'JavaScript'],
  [/프론트엔드|프론트/g, 'frontend'],
  [/백엔드/g, 'backend'],
  [/에이전트/g, 'agent'],
  [/스웜|울트라스웜/g, 'swarm'],
  [/토론|디베이트/g, 'debate'],
  [/전문가/g, 'expert'],
  [/테스트|유닛테스트/g, 'test'],
  [/검증|확인/g, 'verification'],
  [/리팩터|리팩토링/g, 'refactor'],
  [/버그|오류/g, 'bug'],
  [/성능/g, 'performance'],
  [/보안/g, 'security'],
  [/인증/g, 'auth'],
  [/권한/g, 'permission'],
  [/디자인|UI|유아이/g, 'UI design'],
  [/화면|인터페이스/g, 'interface'],
  [/도구|툴/g, 'tool'],
  [/파일/g, 'file'],
  [/코드/g, 'code'],
  [/구현/g, 'implementation'],
  [/아키텍처|설계/g, 'architecture'],
  [/리뷰|검토/g, 'review'],
  [/개선/g, 'improve'],
  [/수정/g, 'fix'],
];

/** Korean conversational noise that rarely helps lexical expert search. */
const HANGUL_NOISE_PATTERNS: readonly RegExp[] = [
  // No \b — Hangul does not form JS word boundaries the way Latin does.
  /(?:좀|제발|해주세요|해 주세요|해줘|부탁(?:드려요|합니다)?|가능할까(?:요)?|가능할까요|인가요|일까요|주세요|요)(?=\s|$|[.!?…,，。])/g,
  /(?:해주세요|해 주세요|해줘)/g,
  /(?:을|를|이|가|은|는|으로|로|에서|에게|한테|께)\s*/g,
];

const HANGUL_CHAR = /[\uAC00-\uD7A3]/;

/**
 * True when the string contains Hangul syllables.
 */
export function containsHangul(text: string): boolean {
  return HANGUL_CHAR.test(text);
}

/**
 * Rewrite a staffing search query:
 * - If Hangul is present, append English technical tokens from a small map.
 * - Optionally strip non-technical Korean noise particles.
 * Keeps the original text so domain phrases are not lost.
 */
export function rewriteExpertSearchQuery(
  query: string,
  options: RewriteExpertSearchQueryOptions = {},
): string {
  const appendEnglishTokens = options.appendEnglishTokens !== false;
  const stripNoise = options.stripNoise !== false;
  const trimmed = query.trim();
  if (trimmed.length === 0) return trimmed;

  let working = trimmed;
  if (stripNoise && containsHangul(working)) {
    for (const pattern of HANGUL_NOISE_PATTERNS) {
      working = working.replace(pattern, ' ');
    }
    working = working.replaceAll(/\s+/g, ' ').trim();
    if (working.length === 0) working = trimmed;
  }

  if (!appendEnglishTokens || !containsHangul(trimmed)) {
    return working;
  }

  const tokens = new Set<string>();
  for (const [pattern, token] of HANGUL_TECH_TOKEN_MAP) {
    if (pattern.test(trimmed)) {
      tokens.add(token);
    }
    // Reset lastIndex for global regexes reused across queries.
    pattern.lastIndex = 0;
  }

  if (tokens.size === 0) return working;
  const appendix = Array.from(tokens).join(' ');
  // Avoid duplicating tokens already present in Latin form.
  const lower = working.toLowerCase();
  const missing = appendix
    .split(/\s+/)
    .filter((token) => token.length > 0 && !lower.includes(token.toLowerCase()));
  if (missing.length === 0) return working;
  return `${working} ${missing.join(' ')}`.trim();
}

/**
 * Extract a coarse id prefix used to detect near-duplicate specialists
 * (e.g. engineering-frontend-* share a prefix).
 */
export function expertIdPrefix(id: string, segments: number = DEFAULT_ID_PREFIX_SEGMENTS): string {
  const parts = id.split('-').filter((part) => part.length > 0);
  if (parts.length === 0) return id;
  return parts.slice(0, Math.max(1, segments)).join('-');
}

/**
 * Diversify MiniSearch (or fused) top results:
 * - Cap experts per division (default 2)
 * - Prefer not selecting two experts with the same id prefix
 *
 * Preserves score order among kept candidates. When `fillRemainder` is true
 * (default), skipped candidates may re-enter if the shortlist is under `limit`.
 */
export function applyStaffingDiversity(
  results: readonly ExpertSearchResult[],
  limit: number,
  options: StaffingDiversityOptions = {},
): ExpertSearchResult[] {
  if (limit <= 0 || results.length === 0) return [];

  const maxPerDivision = options.maxPerDivision ?? DEFAULT_MAX_PER_DIVISION;
  const idPrefixSegments = options.idPrefixSegments ?? DEFAULT_ID_PREFIX_SEGMENTS;
  const fillRemainder = options.fillRemainder !== false;

  const selected: ExpertSearchResult[] = [];
  const skipped: ExpertSearchResult[] = [];
  const divisionCounts = new Map<string, number>();
  const usedPrefixes = new Set<string>();
  const usedIds = new Set<string>();

  for (const result of results) {
    if (selected.length >= limit) break;
    const id = result.expert.id;
    if (usedIds.has(id)) continue;

    const division = result.expert.division;
    const divisionCount = divisionCounts.get(division) ?? 0;
    const prefix = expertIdPrefix(id, idPrefixSegments);

    const divisionOk = divisionCount < maxPerDivision;
    const prefixOk = !usedPrefixes.has(prefix);

    if (divisionOk && prefixOk) {
      selected.push(result);
      usedIds.add(id);
      divisionCounts.set(division, divisionCount + 1);
      usedPrefixes.add(prefix);
    } else {
      skipped.push(result);
    }
  }

  if (fillRemainder && selected.length < limit) {
    for (const result of skipped) {
      if (selected.length >= limit) break;
      const id = result.expert.id;
      if (usedIds.has(id)) continue;
      // Soft fill: still honor division cap if possible; only break cap when
      // nothing else is available and we still need seats.
      const division = result.expert.division;
      const divisionCount = divisionCounts.get(division) ?? 0;
      if (divisionCount >= maxPerDivision && selected.length + (skipped.length - skipped.indexOf(result)) > limit) {
        // Prefer other divisions still under cap when available later in skip list.
        const hasUnderCapLater = skipped
          .slice(skipped.indexOf(result) + 1)
          .some((candidate) => {
            if (usedIds.has(candidate.expert.id)) return false;
            const count = divisionCounts.get(candidate.expert.division) ?? 0;
            return count < maxPerDivision;
          });
        if (hasUnderCapLater) continue;
      }
      selected.push(result);
      usedIds.add(id);
      divisionCounts.set(division, divisionCount + 1);
      usedPrefixes.add(expertIdPrefix(id, idPrefixSegments));
    }
  }

  return selected.slice(0, limit);
}

/**
 * Build a short selection reason including score and division for TUI/ledger.
 */
export function formatSelectionReason(input: {
  readonly expert: Pick<ExpertCatalogEntry, 'division' | 'divisionLabel' | 'description' | 'tags'>;
  readonly score: number;
  readonly coverageLane?: string;
}): string {
  const scoreText = Number.isFinite(input.score) ? input.score.toFixed(3) : 'n/a';
  const division = input.expert.divisionLabel || input.expert.division;
  const lane = input.coverageLane !== undefined && input.coverageLane.length > 0
    ? ` · lane ${input.coverageLane}`
    : '';
  const detail = input.expert.description.trim();
  if (detail.length > 0) {
    const short = detail.length > 120 ? `${detail.slice(0, 117)}…` : detail;
    return `score ${scoreText} · ${division}${lane}: ${short}`;
  }
  const tags = input.expert.tags.slice(0, 5).join(', ');
  if (tags.length > 0) {
    return `score ${scoreText} · ${division}${lane}: ${tags}`;
  }
  return `score ${scoreText} · selected for ${division} coverage${lane}`;
}
