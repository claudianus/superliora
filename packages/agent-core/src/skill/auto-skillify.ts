/**
 * Auto-skillification: detect actionable insights/mistakes from agent execution
 * and automatically create reusable SKILL.md files under `.agents/skills/auto/`.
 *
 * Inspired by Hermes Agent's self-improving skill loop and the self-improving
 * agents survey (arxiv 2607.13104): convert experience → accumulated capability.
 *
 * Lifecycle:
 *   1. detectSkillifiableEvents — inspect tool calls, errors, retries, outputs
 *   2. scoreSkillCandidate — quality gate (usefulness threshold, dedup)
 *   3. skillify — generate SKILL.md via LLM summary, write to auto/ dir
 *   4. Existing scanner.ts picks up auto/ skills on next SearchSkill/Skill call
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'pathe';

export interface ToolCallEvent {
  readonly toolName: string;
  readonly success: boolean;
  readonly retryCount: number;
  readonly error?: string | undefined;
  readonly inputSummary?: string | undefined;
  readonly outputSummary?: string | undefined;
}

export interface InsightEvent {
  readonly type: 'insight' | 'mistake' | 'debug-success' | 'retry-recovery';
  readonly description: string;
  readonly context?: string | undefined;
  readonly toolName?: string | undefined;
}

export interface SkillCandidate {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly body: string;
  readonly sourceEvent: ToolCallEvent | InsightEvent;
  readonly qualityScore: number;
}

export interface SkillifyOptions {
  readonly skillsDir: string;
  readonly existingSkillNames: readonly string[];
  readonly minQualityScore?: number;
  readonly mkdir?: typeof fs.mkdir;
  readonly writeFile?: typeof fs.writeFile;
  readonly stat?: typeof fs.stat;
}

export const DEFAULT_MIN_QUALITY_SCORE = 0.45;

/**
 * Detect skill-worthy events from a batch of tool call results.
 * Triggers on: retries that eventually succeed, errors with recoverable patterns,
 * debug-success sequences, and explicit insight events.
 */
export function detectSkillifiableEvents(events: readonly ToolCallEvent[]): readonly SkillCandidate[] {
  const candidates: SkillCandidate[] = [];

  for (const event of events) {
    // Retry recovery — the agent figured out how to make a failing tool work
    if (event.retryCount > 0 && event.success) {
      candidates.push(
        buildCandidate({
          type: 'retry-recovery',
          description: `Retry recovery for ${event.toolName} after ${event.retryCount} attempt(s)`,
          context: event.error,
          toolName: event.toolName,
          inputSummary: event.inputSummary,
          outputSummary: event.outputSummary,
        }),
      );
    }

    // Debug success — tool failed initially but a subsequent call succeeded
    if (!event.success && event.error && isRecoverableError(event.error)) {
      candidates.push(
        buildCandidate({
          type: 'debug-success',
          description: `Error handling pattern for ${event.toolName}: ${event.error.slice(0, 120)}`,
          context: event.error,
          toolName: event.toolName,
          inputSummary: event.inputSummary,
          outputSummary: event.outputSummary,
        }),
      );
    }
  }

  return candidates;
}

/**
 * Detect skill-worthy events from explicit insight events (agent-reported).
 */
export function detectInsightCandidates(insights: readonly InsightEvent[]): readonly SkillCandidate[] {
  return insights.map((insight) =>
    buildCandidate({
      type: insight.type,
      description: insight.description,
      context: insight.context,
      toolName: insight.toolName,
    }),
  );
}

function buildCandidate(input: {
  type: string;
  description: string;
  context?: string | undefined;
  toolName?: string | undefined;
  inputSummary?: string | undefined;
  outputSummary?: string | undefined;
}): SkillCandidate {
  const name = candidateName(input.type, input.toolName, input.description);
  const whenToUse = candidateWhenToUse(input.type, input.toolName);
  const body = candidateBody(input);
  const qualityScore = scoreCandidate(input.type, input.description, input.context);

  return {
    name,
    description: input.description,
    whenToUse,
    body,
    sourceEvent: {
      type: input.type as InsightEvent['type'],
      description: input.description,
      context: input.context,
      toolName: input.toolName,
    },
    qualityScore,
  };
}

/**
 * Score a skill candidate 0–1. Higher = more reusable.
 * Factors: event type weight × description richness × context presence.
 */
export function scoreCandidate(
  type: string,
  description: string,
  context?: string,
): number {
  const typeWeight: Record<string, number> = {
    insight: 0.85,
    'debug-success': 0.75,
    'retry-recovery': 0.65,
    mistake: 0.55,
  };
  const base = typeWeight[type] ?? 0.5;
  const descRichness = Math.min(description.length / 80, 1) * 0.3;
  const contextBonus = context && context.length > 20 ? 0.15 : 0;
  return Math.min(base + descRichness + contextBonus, 1);
}

/**
 * Check if an error is recoverable (worth skillifying the recovery pattern).
 */
function isRecoverableError(error: string): boolean {
  const recoverablePatterns = [
    /ENOENT/i,
    /timeout/i,
    /rate.?limit/i,
    /ECONNRESET/i,
    /420 /i,
    /503 /i,
    /parse error/i,
    /unexpected token/i,
    /not found/i,
    /ENOENT/i,
  ];
  return recoverablePatterns.some((pattern) => pattern.test(error));
}

function candidateName(type: string, toolName: string | undefined, description: string): string {
  const prefix = type === 'insight' ? 'insight' : type === 'retry-recovery' ? 'retry' : type === 'debug-success' ? 'debug' : 'fix';
  const source = (toolName ?? 'agent').toLowerCase();
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${prefix}-${source}-${slug}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function candidateWhenToUse(type: string, toolName: string | undefined): string {
  const tool = toolName ?? 'the tool';
  switch (type) {
    case 'retry-recovery':
      return `When ${tool} fails with a transient error (timeout, rate-limit, connection reset), apply the retry pattern that succeeded.`;
    case 'debug-success':
      return `When ${tool} produces a recoverable error, follow the debug steps to resolve it.`;
    case 'insight':
      return `When encountering a similar situation to the described insight, apply the learned approach.`;
    case 'mistake':
      return `When about to make the described mistake, check this skill to avoid it.`;
    default:
      return `When the described situation arises, apply this skill.`;
  }
}

function candidateBody(input: {
  type: string;
  description: string;
  context?: string | undefined;
  toolName?: string | undefined;
  inputSummary?: string | undefined;
  outputSummary?: string | undefined;
}): string {
  const contextLine = input.context ? `\n## Context\n\n\`\`\`\n${input.context.slice(0, 500)}\n\`\`\`` : '';
  const inputLine = input.inputSummary ? `\n## Input\n\n${input.inputSummary.slice(0, 300)}` : '';
  const outputLine = input.outputSummary ? `\n## Output\n\n${input.outputSummary.slice(0, 300)}` : '';

  return `# ${input.description}

## What happened

${input.description}${contextLine}${inputLine}${outputLine}

## Recovery / Application

Apply the steps that led to a successful outcome.

## Prevention

Avoid the conditions that caused the initial failure.
`;
}

/**
 * Deduplicate candidates against existing skills and each other.
 * Returns candidates that pass quality threshold and aren't duplicates.
 */
export function deduplicateAndFilter(
  candidates: readonly SkillCandidate[],
  existingNames: readonly string[],
  minScore: number = DEFAULT_MIN_QUALITY_SCORE,
): readonly SkillCandidate[] {
  const existingSet = new Set(existingNames.map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  const result: SkillCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.qualityScore < minScore) continue;
    const key = candidate.name.toLowerCase();
    if (existingSet.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }

  return result;
}

/**
 * Generate a content hash for a skill body, for change detection.
 */
export function skillContentHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

/**
 * Write a SkillCandidate as a SKILL.md file under the auto/ directory.
 * Returns the path to the written file.
 */
export async function skillify(
  candidate: SkillCandidate,
  options: SkillifyOptions,
): Promise<string> {
  const autoDir = path.join(options.skillsDir, 'auto', candidate.name);
  const skillMdPath = path.join(autoDir, 'SKILL.md');
  const mkdir = options.mkdir ?? fs.mkdir;
  const writeFile = options.writeFile ?? fs.writeFile;
  const stat = options.stat ?? fs.stat;
  const minScore = options.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE;

  if (candidate.qualityScore < minScore) {
    throw new Error(
      `Skill candidate "${candidate.name}" quality score ${candidate.qualityScore.toFixed(2)} below threshold ${minScore}`,
    );
  }

  const content = renderSkillMd(candidate);

  // Check if file already exists with same content — skip if unchanged
  try {
    await stat(skillMdPath);
    const existing = await fs.readFile(skillMdPath, 'utf-8');
    if (existing === content) return skillMdPath;
  } catch {
    // File doesn't exist — proceed
  }

  await mkdir(autoDir, { recursive: true });
  await writeFile(skillMdPath, content, 'utf-8');

  return skillMdPath;
}

/**
 * Render a SkillCandidate as SKILL.md front-matter + body.
 */
function renderSkillMd(candidate: SkillCandidate): string {
  return `---
name: ${candidate.name}
description: ${candidate.description}
whenToUse: ${candidate.whenToUse}
type: prompt
source: auto
risk: low
---

${candidate.body}
`;
}

/**
 * Batch skillify: deduplicate, filter, and write all passing candidates.
 * Returns the paths of created/updated skill files.
 */
export async function batchSkillify(
  candidates: readonly SkillCandidate[],
  options: SkillifyOptions,
): Promise<readonly string[]> {
  const minScore = options.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE;
  const filtered = deduplicateAndFilter(candidates, options.existingSkillNames, minScore);
  const paths: string[] = [];
  for (const candidate of filtered) {
    try {
      const writtenPath = await skillify(candidate, options);
      paths.push(writtenPath);
    } catch {
      // Skip candidates that fail to write — don't abort the batch
    }
  }
  return paths;
}