/**
 * Per-Job coding vs general track.
 *
 * Gates (worktree / verify / changeset / gate brief) key off `JobRecord.taskTrack`.
 * Classification is a conservative allowlist: ambiguous text stays coding.
 * No session-level toggle and no LLM round-trip.
 */

import { isPlaceholderBriefLine } from './job-brief';
import type { JobDeliveryMode, JobKind, JobRecord } from './job-store-key';

export type JobTaskTrack = 'coding' | 'general';

export type GeneralVerdictField = 'passed' | 'failed';

export interface ClassifyJobTaskTrackInput {
  readonly title?: string;
  readonly prompt?: string;
  readonly ownershipPaths?: readonly string[];
  readonly contextPaths?: readonly string[];
  readonly kind?: JobKind;
  readonly deliveryMode?: JobDeliveryMode;
  readonly greenfieldChain?: boolean;
  /** Hidden JobCreate override. Invalid values are ignored. */
  readonly explicit?: string;
  /** Affinity / continue_from inheritance. Explicit still wins. */
  readonly inherited?: JobTaskTrack;
}

export interface GeneralVerdict {
  readonly generalVerdict: GeneralVerdictField;
  readonly proof: string;
}

const REPO_PATH =
  /(?:^|[\s"'`(])(?:packages|apps|src|lib|test|tests|docs)\/|(?:^|[\s"'`(])[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|kt|swift|cs|rb|php|vue|svelte|css|scss)\b/i;

const CODING_SIGNAL =
  /\b(fix|refactor|implement|tests?\b|pull request|\bpr\b|changeset|lint|typeerrors?|type error|compile|coverage|버그|리팩터|리팩토링|테스트|커밋|타입에러|타입 에러|레포|저장소|repo|repository|workspace|monorepo)\b/i;

const PKG_MANAGER_INSTALL =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|remove|rm)\b/i;

const GENERAL_INSTALL = /설치해(?:\s*줘)?|설치\s+해(?:\s*줘)?|\buninstall\b|\binstall\b/i;

const GENERAL_OS =
  /운영체제|os\s*설정|윈도우\s*설정|macos\s*설정|시스템\s*설정|환경\s*변수|방화벽|레지스트리|권한\s*설정|path\s*설정/i;

const GENERAL_APP = /켜줘|켜\s*줘|실행해(?:\s*줘)?|실행\s+해(?:\s*줘)?|열어줘|열어\s*줘/i;

const OUTSIDE_WORKSPACE =
  /(?:^|[\s"'`])(?:~\/|~\\|[A-Za-z]:\\+|\/Users\/|\/home\/|%APPDATA%|%LOCALAPPDATA%|%USERPROFILE%)/;

export function normalizeJobTaskTrack(value: string | undefined): JobTaskTrack | undefined {
  if (value === 'coding' || value === 'general') return value;
  return undefined;
}

/** True when coding worktree/verify/merge gates should stay off. */
export function isGeneralTaskTrack(
  job: Pick<JobRecord, 'kind' | 'taskTrack'>,
): boolean {
  if (job.kind !== 'task' && job.kind !== 'implement') return false;
  return job.taskTrack === 'general';
}

/**
 * Alias for the public test seam name used in the brief.
 * Same as {@link classifyJobTaskTrack}.
 */
export function classifyJobTrack(input: ClassifyJobTaskTrackInput): JobTaskTrack {
  return classifyJobTaskTrack(input);
}

export function classifyJobTaskTrack(input: ClassifyJobTaskTrackInput): JobTaskTrack {
  const kind = input.kind ?? 'task';
  if (kind !== 'task' && kind !== 'implement') return 'coding';
  if (input.deliveryMode === 'greenfield' || input.greenfieldChain === true) {
    return 'coding';
  }

  const explicit = normalizeJobTaskTrack(input.explicit);
  if (explicit !== undefined) return explicit;
  if (input.inherited !== undefined) return input.inherited;

  const title = input.title?.trim() ?? '';
  const prompt = input.prompt?.trim() ?? '';
  if (title.length === 0 && prompt.length === 0) return 'coding';

  const text = [title, prompt, ...(input.ownershipPaths ?? []), ...(input.contextPaths ?? [])]
    .filter((part) => part.trim().length > 0)
    .join('\n');

  if (hasCodingCollision(text)) return 'coding';
  if (hasGeneralSignal(text)) return 'general';
  return 'coding';
}

function hasCodingCollision(text: string): boolean {
  if (REPO_PATH.test(text)) return true;
  if (CODING_SIGNAL.test(text)) return true;
  if (PKG_MANAGER_INSTALL.test(text)) return true;
  return false;
}

function hasGeneralSignal(text: string): boolean {
  return (
    GENERAL_INSTALL.test(text) ||
    GENERAL_OS.test(text) ||
    GENERAL_APP.test(text) ||
    OUTSIDE_WORKSPACE.test(text)
  );
}

/**
 * Parse `{"generalVerdict":"passed"|"failed","proof":"..."}` from a worker summary.
 * Missing JSON, empty proof, or placeholder proof → undefined (not passed).
 */
export function parseGeneralVerdict(summary: string | undefined): GeneralVerdict | undefined {
  if (summary === undefined || summary.trim().length === 0) return undefined;
  const text = summary.trim();

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const parsed = tryParseGeneralVerdictObject(match[1]);
    if (parsed !== undefined) return parsed;
  }

  for (const objectText of iterBalancedJsonObjects(text)) {
    const parsed = tryParseGeneralVerdictObject(objectText);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

function tryParseGeneralVerdictObject(raw: string | undefined): GeneralVerdict | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value === null || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const verdictRaw = record['generalVerdict'] ?? record['verdict'];
    if (typeof verdictRaw !== 'string') return undefined;
    const generalVerdict = normalizeVerdict(verdictRaw);
    if (generalVerdict === undefined) return undefined;
    const proofRaw = record['proof'];
    const proof = typeof proofRaw === 'string' ? proofRaw.trim() : '';
    if (proof.length === 0 || isPlaceholderBriefLine(proof)) return undefined;
    return { generalVerdict, proof };
  } catch {
    return undefined;
  }
}

function normalizeVerdict(raw: string): GeneralVerdictField | undefined {
  const value = raw.trim().toLowerCase();
  if (value === 'pass' || value === 'passed') return 'passed';
  if (value === 'fail' || value === 'failed') return 'failed';
  return undefined;
}

function iterBalancedJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}
