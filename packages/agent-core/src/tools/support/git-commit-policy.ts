/**
 * Shared SuperLiora git commit policy: author identity + conventional message.
 *
 * Used by job worktree snapshots and any host commit helper. Pure validation —
 * never shells out. Prefer repo/user git config; fall back to the bot identity.
 */

/** Documented bot identity when git user.name / user.email are unset. */
export const SUPERLIORA_BOT_AUTHOR = {
  name: 'SuperLiora',
  email: 'superliora@localhost',
} as const;

/** Allowed conventional-commit types (lowercase). */
export const CONVENTIONAL_COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

export type ConventionalCommitType = (typeof CONVENTIONAL_COMMIT_TYPES)[number];

const TYPE_SET = new Set<string>(CONVENTIONAL_COMMIT_TYPES);

/** Subjects that carry no signal — reject or rewrite. */
const BANNED_SUBJECTS = new Set([
  'update',
  'updates',
  'wip',
  'fix',
  'fixes',
  'misc',
  'stuff',
  'changes',
  'change',
  'tmp',
  'temp',
  'test',
  'asdf',
  'foo',
  'bar',
  'commit',
]);

const CONVENTIONAL_SUBJECT =
  /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9._/-]+)\))?(?<breaking>!)?: (?<subject>.+)$/u;

export interface GitAuthorIdentity {
  readonly name: string;
  readonly email: string;
  /** True when name/email came from SuperLiora bot defaults. */
  readonly isBotFallback: boolean;
}

export interface CommitMessageValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** Normalized message when ok, or a best-effort rewrite when autoFix is true. */
  readonly message?: string;
}

export interface ResolveAuthorInput {
  readonly name?: string | null;
  readonly email?: string | null;
}

/** Prefer configured git identity; otherwise the documented SuperLiora bot. */
export function resolveCommitAuthor(input: ResolveAuthorInput = {}): GitAuthorIdentity {
  const name = input.name?.trim() ?? '';
  const email = input.email?.trim() ?? '';
  if (name.length > 0 && email.length > 0) {
    return { name, email, isBotFallback: false };
  }
  return {
    name: name.length > 0 ? name : SUPERLIORA_BOT_AUTHOR.name,
    email: email.length > 0 ? email : SUPERLIORA_BOT_AUTHOR.email,
    isBotFallback: true,
  };
}

/** `-c user.name=… -c user.email=…` args when identity must be forced inline. */
export function commitIdentityArgs(author: GitAuthorIdentity): readonly string[] {
  return [`-c`, `user.name=${author.name}`, `-c`, `user.email=${author.email}`];
}

function firstLine(message: string): string {
  return message.replace(/\r\n/gu, '\n').split('\n')[0]?.trim() ?? '';
}

function isJobIdOnly(subject: string): boolean {
  return /^job[_-][a-z0-9]+$/iu.test(subject.trim());
}

function subjectLooksBanned(subject: string): boolean {
  const bare = subject
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (BANNED_SUBJECTS.has(bare)) return true;
  if (/^(fix|update|wip)\s+stuff$/u.test(bare)) return true;
  return false;
}

/**
 * Validate a commit message against SuperLiora conventional-commit rules.
 * - type(scope): subject  (scope optional)
 * - subject imperative, ≤72 chars, not empty / banned / job-id-only
 * - optional body after a blank line
 */
export function validateCommitMessage(
  raw: string,
  options: { readonly autoFix?: boolean } = {},
): CommitMessageValidation {
  const trimmed = raw.replace(/\r\n/gu, '\n').trim();
  const errors: string[] = [];
  if (trimmed.length === 0) {
    return { ok: false, errors: ['empty commit message'] };
  }

  const head = firstLine(trimmed);
  const match = CONVENTIONAL_SUBJECT.exec(head);
  if (match?.groups === undefined) {
    if (options.autoFix === true) {
      const fixed = autoFixCommitMessage(trimmed);
      const recheck = validateCommitMessage(fixed, { autoFix: false });
      if (recheck.ok) return recheck;
      return { ok: false, errors: recheck.errors, message: fixed };
    }
    return {
      ok: false,
      errors: ['subject must match type(scope): subject (conventional commits)'],
    };
  }

  const groups = match.groups;
  const type = groups['type'] ?? '';
  const subject = (groups['subject'] ?? '').trim();
  if (!TYPE_SET.has(type)) {
    errors.push(`unknown type "${type}" — use ${CONVENTIONAL_COMMIT_TYPES.join('|')}`);
  }
  if (subject.length === 0) {
    errors.push('subject is empty');
  }
  if (subject.length > 72) {
    errors.push(`subject exceeds 72 characters (${String(subject.length)})`);
  }
  if (isJobIdOnly(subject)) {
    errors.push('subject must not be only a job id');
  }
  if (subjectLooksBanned(subject)) {
    errors.push(`subject is too vague ("${subject}")`);
  }
  // Prefer imperative: reject trailing period and past-tense common traps lightly.
  if (subject.endsWith('.')) {
    errors.push('subject must not end with a period');
  }

  if (errors.length > 0) {
    if (options.autoFix === true) {
      const fixed = autoFixCommitMessage(trimmed);
      const recheck = validateCommitMessage(fixed, { autoFix: false });
      if (recheck.ok) return recheck;
      return { ok: false, errors: [...errors, ...recheck.errors], message: fixed };
    }
    return { ok: false, errors };
  }

  // Preserve body; normalize subject spacing only.
  const bodyStart = trimmed.indexOf('\n');
  const body = bodyStart === -1 ? '' : trimmed.slice(bodyStart).replace(/^\n+/u, '\n');
  const scope = groups['scope'];
  const breaking = groups['breaking'] === '!' ? '!' : '';
  const scopePart = scope !== undefined && scope.length > 0 ? `(${scope})` : '';
  const normalizedHead = `${type}${scopePart}${breaking}: ${subject}`;
  const message = body.length > 0 ? `${normalizedHead}\n${body.replace(/^\n/u, '')}` : normalizedHead;
  return { ok: true, errors: [], message };
}

/**
 * Best-effort rewrite into conventional form.
 * Snapshot/backstop callers pass a free-text title; we wrap as chore(job): …
 */
export function autoFixCommitMessage(raw: string): string {
  const normalized = raw.replace(/\r\n/gu, '\n').trim();
  if (normalized.length === 0) {
    return 'chore: apply pending workspace changes';
  }
  const head = firstLine(normalized);
  const match = CONVENTIONAL_SUBJECT.exec(head);
  if (match?.groups !== undefined) {
    const groups = match.groups;
    let subject = (groups['subject'] ?? '').trim().replace(/\.$/u, '');
    if (subject.length === 0 || isJobIdOnly(subject) || subjectLooksBanned(subject)) {
      subject = 'apply pending changes';
    }
    if (subject.length > 72) subject = `${subject.slice(0, 71)}…`;
    const rawType = groups['type'] ?? '';
    const type = TYPE_SET.has(rawType) ? rawType : 'chore';
    const scope = groups['scope'];
    const breaking = groups['breaking'] === '!' ? '!' : '';
    const scopePart = scope !== undefined && scope.length > 0 ? `(${scope})` : '';
    const bodyStart = normalized.indexOf('\n');
    const body = bodyStart === -1 ? '' : normalized.slice(bodyStart).replace(/^\n+/u, '\n');
    const fixedHead = `${type}${scopePart}${breaking}: ${subject}`;
    return body.length > 0 ? `${fixedHead}\n${body.replace(/^\n/u, '')}` : fixedHead;
  }

  // Free text → chore: <subject>
  let subject = head.replace(/\.$/u, '').trim();
  if (isJobIdOnly(subject) || subjectLooksBanned(subject)) {
    subject = `capture worktree snapshot (${subject})`;
  }
  if (subject.length > 72) subject = `${subject.slice(0, 71)}…`;
  // Avoid double "chore:" if user already typed something close.
  const bodyStart = normalized.indexOf('\n');
  const body = bodyStart === -1 ? '' : normalized.slice(bodyStart).replace(/^\n+/u, '\n');
  const fixedHead = `chore: ${subject.charAt(0).toLowerCase()}${subject.slice(1)}`;
  return body.length > 0 ? `${fixedHead}\n${body.replace(/^\n/u, '')}` : fixedHead;
}

/**
 * Build a policy-compliant job worktree snapshot message.
 * Keeps the job id in the body, never as the sole subject.
 */
export function buildJobSnapshotCommitMessage(input: {
  readonly jobId: string;
  readonly jobTitle?: string;
}): string {
  const title = input.jobTitle?.trim() ?? '';
  const subjectBase =
    title.length > 0 && !isJobIdOnly(title) && !subjectLooksBanned(title)
      ? title
      : 'snapshot uncommitted worktree changes';
  const subject =
    subjectBase.length > 56 ? `${subjectBase.slice(0, 55)}…` : subjectBase;
  const raw = `chore(job): ${subject}\n\nJob-Id: ${input.jobId}`;
  const validated = validateCommitMessage(raw, { autoFix: true });
  return validated.message ?? raw;
}
