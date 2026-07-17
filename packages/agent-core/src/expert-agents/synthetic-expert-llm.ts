import { createUserMessage } from '@superliora/kosong';
import type { ChatProvider } from '@superliora/kosong';

import {
  extractJsonFromText,
  extractTextFromLLMResponse,
} from '../agent/plan/ultra-plan-llm-json';
import type { Agent } from '../agent';
import { enrichExpertForCatalog } from './expert-persona';
import { globalExpertSearchEngine } from './search';
import { registerSyntheticExpert } from './synthetic-expert-registry';
import type { ExpertCatalogEntry } from './types';

export interface SyntheticExpertLlmDeps {
  readonly generate: Agent['generate'];
  readonly provider: ChatProvider;
}

export interface SynthesizeExpertsInput {
  readonly taskDescription: string;
  readonly count?: number;
  readonly intensity?: 'balanced' | 'premium' | 'max';
  readonly signal?: AbortSignal;
  /** Optional uncovered coverage lanes to staff. */
  readonly coverageLanes?: readonly string[];
}

const MAX_TASK_CHARS = 3_000;
const MAX_PERSONA_CHARS = 4_500;

const DIVISION_META: Record<
  string,
  { readonly label: string; readonly icon: string; readonly color: string }
> = {
  engineering: { label: 'Engineering', icon: '⚙️', color: '#3B82F6' },
  design: { label: 'Design', icon: '🎨', color: '#EC4899' },
  testing: { label: 'Testing', icon: '🧪', color: '#10B981' },
  security: { label: 'Security', icon: '🔒', color: '#EF4444' },
  product: { label: 'Product', icon: '📋', color: '#8B5CF6' },
  academic: { label: 'Academic', icon: '📚', color: '#6366F1' },
  specialized: { label: 'Specialized', icon: '✦', color: '#F59E0B' },
};

const SYNTHETIC_SYSTEM = `You design elite specialist agent personas for SuperLiora UltraSwarm.

The static expert catalog had no suitable match (or coverage was empty). Invent the highest-quality specialists for THIS task only.

Return ONLY compact JSON:
{
  "experts": [
    {
      "slug": "short-kebab-id",
      "name": "Title Case Specialist Name",
      "emoji": "single emoji",
      "color": "#RRGGBB",
      "division": "engineering|design|testing|security|product|academic|specialized",
      "description": "one crisp sentence of mandate",
      "vibe": "3-6 word craft vibe",
      "tags": ["tag1","tag2","tag3"],
      "capabilities": ["capability 1","capability 2","capability 3"],
      "when_to_use": "one sentence trigger",
      "coverage_lane": "architecture_implementation|product_requirements|testing_evidence|ux_visual_content|security_privacy|performance_reliability|domain_subject_matter",
      "persona_markdown": "# Name\\n\\nFull elite system persona in Markdown (English). Include: identity, non-negotiable quality bar, method, anti-patterns, definition of done. 800-1800 words worth of dense craft guidance, not fluff."
    }
  ]
}

Rules:
- Optimize for real task outcomes: correctness, verification, maintainability, and domain depth.
- Persona must sound like a principal practitioner, not a generic assistant.
- No filler (seamless/robust/leverage/delve). Concrete verbs and checks.
- Prefer fewer stronger specialists over many weak ones.
- slug: lowercase kebab, ascii, unique within the array.
- persona_markdown must be substantial and immediately usable as a system prompt body.
- Match division/coverage_lane to the specialist's real job.
- Any user language is fine for the task; write persona_markdown in English for runtime stability.`;

/**
 * Ask the active model to invent high-quality synthetic experts for a task
 * that the static catalog cannot staff well. Registers them for spawn lookup.
 */
export async function synthesizeExpertsWithLlm(
  deps: SyntheticExpertLlmDeps,
  input: SynthesizeExpertsInput,
): Promise<readonly ExpertCatalogEntry[]> {
  const task = input.taskDescription.trim();
  if (task.length === 0) return [];

  const count = Math.max(1, Math.min(input.count ?? defaultCount(input.intensity), 4));
  const clipped = task.length <= MAX_TASK_CHARS ? task : `${task.slice(0, MAX_TASK_CHARS)}…`;
  const lanes =
    input.coverageLanes !== undefined && input.coverageLanes.length > 0
      ? input.coverageLanes.join(', ')
      : '(infer from task)';

  try {
    const response = await deps.generate(
      deps.provider,
      SYNTHETIC_SYSTEM,
      [],
      [
        createUserMessage(
          [
            `Task:\n${clipped}`,
            '',
            `Desired specialist count: ${String(count)}`,
            `Coverage lanes to prefer: ${lanes}`,
            `Intensity: ${input.intensity ?? 'balanced'}`,
            '',
            'Invent the best possible specialists for this task. JSON only.',
          ].join('\n'),
        ),
      ],
      undefined,
      {
        signal: input.signal,
        // Keep synthetic generation lean — no tools, short completion.
      },
    );

    const text = extractTextFromLLMResponse(response);
    const experts = parseSyntheticExpertsResponse(text, count);
    for (const expert of experts) {
      registerSyntheticExpert(expert);
      await registerWithSearchEngine(expert);
    }
    return experts;
  } catch {
    const fallback = [buildDeterministicSyntheticExpert(task, input.coverageLanes?.[0])];
    for (const expert of fallback) {
      registerSyntheticExpert(expert);
      await registerWithSearchEngine(expert);
    }
    return fallback;
  }
}

async function registerWithSearchEngine(expert: ExpertCatalogEntry): Promise<void> {
  try {
    await globalExpertSearchEngine.initialize();
    if (globalExpertSearchEngine.getExpertById(expert.id) === undefined) {
      globalExpertSearchEngine.addExpert(expert);
    }
  } catch {
    // Spawn path uses synthetic registry via resolveExpertCatalogEntry.
  }
}

export function parseSyntheticExpertsResponse(
  text: string,
  maxCount: number,
): ExpertCatalogEntry[] {
  const json = extractJsonFromText(text);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const expertsRaw = (parsed as Record<string, unknown>)['experts'];
  if (!Array.isArray(expertsRaw)) return [];

  const out: ExpertCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const item of expertsRaw) {
    if (out.length >= maxCount) break;
    const expert = normalizeSyntheticExpert(item);
    if (expert === undefined) continue;
    if (seen.has(expert.id)) continue;
    seen.add(expert.id);
    out.push(enrichExpertForCatalog(expert));
  }
  return out;
}

export function buildDeterministicSyntheticExpert(
  taskDescription: string,
  preferredLane?: string,
): ExpertCatalogEntry {
  const lane = preferredLane ?? 'architecture_implementation';
  const division = divisionForLane(lane);
  const meta = DIVISION_META[division] ?? DIVISION_META['specialized']!;
  const slug = `synthetic-${slugify(taskDescription.slice(0, 40)) || 'specialist'}`;
  const name = 'Principal Task Specialist';
  const description = `Elite specialist synthesized for: ${taskDescription.slice(0, 160)}`;
  const personaText = [
    `# ${name}`,
    '',
    `You are **${name}**, a principal-level practitioner hired because the static catalog lacked a tight match.`,
    '',
    '## Mandate',
    description,
    '',
    '## Non-negotiables',
    '- Prefer evidence, tests, and concrete paths over vague advice.',
    '- Ship the smallest correct change that fully satisfies the task.',
    '- Call out risks, edge cases, and verification explicitly.',
    '- Match local repository conventions; no drive-by refactors.',
    '',
    '## Method',
    '1. Restate success criteria as true/false checks.',
    '2. Inspect the real code/surface before editing.',
    '3. Implement minimally; verify with the tightest available commands.',
    '4. Report remaining risks honestly.',
    '',
    '## Anti-patterns',
    '- Generic filler personas or empty scaffolding.',
    '- Claiming done without verification.',
    '- Expanding scope beyond the task.',
  ].join('\n');

  return enrichExpertForCatalog({
    id: slug,
    name,
    emoji: '✦',
    color: meta.color,
    division,
    divisionLabel: meta.label,
    divisionIcon: meta.icon,
    divisionColor: meta.color,
    description,
    vibe: 'precise · evidence-first · elite',
    tags: ['synthetic', 'fallback', lane],
    capabilities: ['task ownership', 'verification', 'high-quality craft'],
    whenToUse: 'When the static expert catalog has no suitable specialist for this task.',
    personaText,
  });
}

function normalizeSyntheticExpert(raw: unknown): ExpertCatalogEntry | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const slug = asNonEmptyString(r['slug']);
  const name = asNonEmptyString(r['name']);
  const description = asNonEmptyString(r['description']);
  const personaMarkdown = asNonEmptyString(r['persona_markdown']);
  if (slug === undefined || name === undefined || description === undefined || personaMarkdown === undefined) {
    return undefined;
  }

  const divisionRaw = (asNonEmptyString(r['division']) ?? 'specialized').toLowerCase();
  const division = DIVISION_META[divisionRaw] !== undefined ? divisionRaw : 'specialized';
  const meta = DIVISION_META[division]!;
  const color = asHexColor(r['color']) ?? meta.color;
  const emoji = asNonEmptyString(r['emoji']) ?? '✦';
  const vibe = asNonEmptyString(r['vibe']) ?? 'elite · precise · evidence-first';
  const whenToUse =
    asNonEmptyString(r['when_to_use']) ??
    `Engage for specialized work matching: ${description}`;
  const tags = asStringArray(r['tags'], ['synthetic', 'llm-authored']);
  const capabilities = asStringArray(r['capabilities'], ['domain expertise', 'verification']);
  const coverageLane = asNonEmptyString(r['coverage_lane']);
  const id = `synthetic-${slugify(slug)}`;
  const personaText =
    personaMarkdown.length > MAX_PERSONA_CHARS
      ? `${personaMarkdown.slice(0, MAX_PERSONA_CHARS).trimEnd()}\n…`
      : personaMarkdown;

  return {
    id,
    name: name.slice(0, 80),
    emoji: emoji.slice(0, 4),
    color,
    division,
    divisionLabel: meta.label,
    divisionIcon: meta.icon,
    divisionColor: meta.color,
    description: description.slice(0, 280),
    vibe: vibe.slice(0, 80),
    tags: coverageLane !== undefined ? [...tags, coverageLane] : tags,
    capabilities,
    whenToUse: whenToUse.slice(0, 280),
    personaText,
  };
}

function defaultCount(intensity: SynthesizeExpertsInput['intensity']): number {
  if (intensity === 'max') return 3;
  if (intensity === 'premium') return 2;
  return 1;
}

function divisionForLane(lane: string): string {
  switch (lane) {
    case 'testing_evidence':
      return 'testing';
    case 'product_requirements':
      return 'product';
    case 'ux_visual_content':
      return 'design';
    case 'security_privacy':
      return 'security';
    case 'domain_subject_matter':
      return 'academic';
    case 'performance_reliability':
    case 'architecture_implementation':
    default:
      return 'engineering';
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 8);
  return out.length > 0 ? out : fallback;
}

function asHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed : undefined;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
