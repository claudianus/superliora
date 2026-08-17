/**
 * Search-source routing.
 *
 * Sync path never classifies from query keywords. Optional LLM effect
 * judgment may pick an artifact/ecosystem; fail closed leaves configured
 * sources as-is and does not rewrite the query.
 */

import { createUserMessage } from '@superliora/kosong';

import {
  clampConfidence,
  clipClassifierText,
  createClassifierTimeoutSignal,
  extractTextFromGenerateResponse,
  parseJsonResponse,
  type LlmClassifierDeps,
} from '../../utils/llm-classifier-utils';

export interface LocalSearchDirectSources {
  readonly github?: boolean;
  readonly arxiv?: boolean;
  readonly npm?: boolean;
  readonly pypi?: boolean;
  readonly crates?: boolean;
}

export interface SearchIntent {
  readonly kind: 'tech' | 'package' | 'paper' | 'news' | 'general';
  readonly packageEcosystem?: 'npm' | 'pypi' | 'crates' | undefined;
}

const SEARCH_INTENT_CONFIDENCE_FLOOR = 0.55;

const SEARCH_INTENT_SYSTEM = [
  'You judge what kind of artifact a web search is looking for. Return ONLY compact JSON:',
  '{"artifact":"package","ecosystem":"npm","confidence":0.9,"rationale":"one sentence about the sought artifact"}',
  '',
  'Decide from the information need — not by matching words in the query.',
  '',
  'artifact:',
  '- package: a library/crate to install from a package index',
  '- paper: a scholarly paper or preprint',
  '- news: a current-events headline',
  '- tech: code, API, or project documentation',
  '- general: none of the above',
  '',
  'ecosystem: npm | pypi | crates | omit unless artifact=package.',
  '',
  'Rules:',
  '- Do not classify by matching words or phrases in any language.',
  '- Ambiguous or low confidence → artifact=general and omit ecosystem.',
  '- rationale names the sought artifact, never quoted trigger words.',
].join('\n');

export function classifySearchIntent(_query: string): SearchIntent {
  return { kind: 'general' };
}

export function searchIntentFromJudgment(input: {
  readonly artifact: SearchIntent['kind'];
  readonly ecosystem?: SearchIntent['packageEcosystem'];
  readonly confidence: number;
}): SearchIntent {
  if (input.confidence < SEARCH_INTENT_CONFIDENCE_FLOOR) return { kind: 'general' };
  if (input.artifact === 'package') {
    return { kind: 'package', packageEcosystem: input.ecosystem };
  }
  return { kind: input.artifact };
}

export function parseSearchIntentJudgment(text: string): SearchIntent | undefined {
  const record = parseJsonResponse(text);
  if (record === undefined) return undefined;
  const artifact = record['artifact'];
  if (
    artifact !== 'tech' &&
    artifact !== 'package' &&
    artifact !== 'paper' &&
    artifact !== 'news' &&
    artifact !== 'general'
  ) {
    return undefined;
  }
  const confidence = clampConfidence(record['confidence']);
  if (confidence === undefined) return undefined;
  const ecosystemRaw = record['ecosystem'];
  const ecosystem =
    ecosystemRaw === 'npm' || ecosystemRaw === 'pypi' || ecosystemRaw === 'crates'
      ? ecosystemRaw
      : undefined;
  return searchIntentFromJudgment({ artifact, ecosystem, confidence });
}

export async function inferSearchIntent(
  query: string,
  deps: LlmClassifierDeps | undefined,
  options?: { readonly signal?: AbortSignal },
): Promise<SearchIntent> {
  if (deps === undefined) return { kind: 'general' };
  const trimmed = query.trim();
  if (trimmed.length === 0) return { kind: 'general' };
  try {
    const response = await deps.generate(
      deps.provider,
      SEARCH_INTENT_SYSTEM,
      [],
      [
        createUserMessage(
          [
            'Judge the sought artifact. The query is context, not a keyword checklist.',
            '',
            `query: ${clipClassifierText(trimmed)}`,
          ].join('\n'),
        ),
      ],
      undefined,
      { signal: createClassifierTimeoutSignal(8_000, options?.signal) },
    );
    return parseSearchIntentJudgment(extractTextFromGenerateResponse(response)) ?? {
      kind: 'general',
    };
  } catch {
    return { kind: 'general' };
  }
}

export function shapeQueryForIntent(query: string, _intent: SearchIntent): string {
  return query;
}

export function selectDirectSourcesForIntent(
  configured: LocalSearchDirectSources,
  intent: SearchIntent,
): LocalSearchDirectSources {
  if (intent.kind === 'package') {
    if (intent.packageEcosystem === 'npm') {
      return {
        github: configured.github !== false,
        npm: configured.npm !== false,
        pypi: false,
        crates: false,
        arxiv: false,
      };
    }
    if (intent.packageEcosystem === 'pypi') {
      return {
        github: configured.github !== false,
        npm: false,
        pypi: configured.pypi !== false,
        crates: false,
        arxiv: false,
      };
    }
    if (intent.packageEcosystem === 'crates') {
      return {
        github: configured.github !== false,
        npm: false,
        pypi: false,
        crates: configured.crates !== false,
        arxiv: false,
      };
    }
  }
  if (intent.kind === 'paper') {
    return {
      github: configured.github !== false,
      npm: false,
      pypi: false,
      crates: false,
      arxiv: configured.arxiv !== false,
    };
  }
  if (intent.kind === 'news' || intent.kind === 'general') {
    return configured;
  }
  return configured;
}

export function formatSearchRouteLine(
  intent: SearchIntent,
  sources: LocalSearchDirectSources,
): string {
  const kind =
    intent.kind === 'package' && intent.packageEcosystem !== undefined
      ? `package/${intent.packageEcosystem}`
      : intent.kind;
  const enabled: string[] = [];
  if (sources.github !== false) enabled.push('github');
  if (sources.npm !== false) enabled.push('npm');
  if (sources.pypi !== false) enabled.push('pypi');
  if (sources.crates !== false) enabled.push('crates');
  if (sources.arxiv !== false) enabled.push('arxiv');
  return enabled.length === 0 ? kind : `${kind} · sources ${enabled.join(', ')}`;
}

export function hasAnyDirectSource(sources: LocalSearchDirectSources): boolean {
  return (
    sources.github !== false ||
    sources.npm !== false ||
    sources.pypi !== false ||
    sources.crates !== false ||
    sources.arxiv !== false
  );
}
