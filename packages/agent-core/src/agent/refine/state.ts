/**
 * Harness state ledger for the refine pipeline (continual-harness port).
 *
 * The ledger owns `prompt` and `subagent` entries only — durable notes the
 * injector renders into context and reusable subagent task specs. `memory`
 * and `skill` edits write through to their real stores (MemoryStore CRUD,
 * SKILL.md files); those kinds appear here only as refinement events with
 * before/after snapshots so rollback can restore them.
 */

export const HARNESS_STATE_SCHEMA = 1;

/** Refinement events kept per scope; older ones are dropped (rollback only
 * guarantees the latest event per target, so deep history buys nothing). */
export const MAX_REFINEMENT_EVENTS = 50;

export type HarnessScope = 'local' | 'global';
export type HarnessEntryKind = 'prompt' | 'subagent';
export type HarnessEditKind = HarnessEntryKind | 'memory' | 'skill';

/** Gate-outcome tally for the measured-refinement loop (terminal outcomes only). */
export interface HarnessEntryScore {
  confirmed: number;
  failed: number;
}

export interface HarnessEntry {
  readonly id: string;
  readonly kind: HarnessEntryKind;
  readonly title: string;
  readonly content: string;
  /** Workspace path for `subagent` entries; empty string for `prompt`. */
  readonly path: string;
  readonly scope: HarnessScope;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Present once the entry has been scored by at least one gate outcome. */
  readonly score?: HarnessEntryScore;
}

export interface HarnessRefinementEvent {
  readonly id: string;
  readonly at: number;
  readonly scope: HarnessScope;
  readonly kind: HarnessEditKind;
  /** Entry id, memory record id, or skill name depending on `kind`. */
  readonly targetId: string;
  readonly summary: string;
  status: 'applied' | 'rolled_back' | 'failed';
  /**
   * Kind-specific restore snapshots. `undefined` before = the target was
   * created by this event; `undefined` after = the event deleted it.
   * - prompt/subagent: HarnessEntry
   * - memory: { record: MemoryRecord-like } (full record for restore)
   * - skill: { name, description, whenToUse?, body } (SKILL.md render input)
   */
  readonly before?: unknown;
  readonly after?: unknown;
  error?: string;
}

export interface HarnessState {
  readonly schema: number;
  entries: HarnessEntry[];
  refinements: HarnessRefinementEvent[];
}

export function emptyHarnessState(): HarnessState {
  return { schema: HARNESS_STATE_SCHEMA, entries: [], refinements: [] };
}

export function findEntry(
  state: HarnessState,
  kind: HarnessEntryKind,
  id: string,
): HarnessEntry | undefined {
  return state.entries.find((entry) => entry.kind === kind && entry.id === id);
}

export function upsertEntry(state: HarnessState, entry: HarnessEntry): void {
  const index = state.entries.findIndex(
    (existing) => existing.kind === entry.kind && existing.id === entry.id,
  );
  if (index >= 0) {
    state.entries[index] = entry;
  } else {
    state.entries.push(entry);
  }
}

export function removeEntry(state: HarnessState, kind: HarnessEntryKind, id: string): boolean {
  const index = state.entries.findIndex(
    (entry) => entry.kind === kind && entry.id === id,
  );
  if (index < 0) return false;
  state.entries.splice(index, 1);
  return true;
}

export function appendRefinementEvent(state: HarnessState, event: HarnessRefinementEvent): void {
  state.refinements.push(event);
  if (state.refinements.length > MAX_REFINEMENT_EVENTS) {
    state.refinements.splice(0, state.refinements.length - MAX_REFINEMENT_EVENTS);
  }
}

/**
 * A rollback is only safe when no later applied event touched the same
 * target — rolling back an older edit would silently drop the newer one.
 */
export function findRollbackableEvent(
  state: HarnessState,
  refinementId: string,
): { event: HarnessRefinementEvent; blockedBy?: HarnessRefinementEvent } | undefined {
  const index = state.refinements.findIndex((event) => event.id === refinementId);
  if (index < 0) return undefined;
  const event = state.refinements[index]!;
  const newer = state.refinements
    .slice(index + 1)
    .find(
      (candidate) =>
        candidate.status === 'applied' &&
        candidate.kind === event.kind &&
        candidate.targetId === event.targetId,
    );
  return { event, blockedBy: newer };
}

/** Deterministic content fingerprint so the injector re-injects only on change. */
export function harnessContentHash(state: HarnessState): string {
  let hash = 0;
  for (const entry of state.entries) {
    const text = `${entry.kind}:${entry.id}:${String(entry.version)}:${entry.content}`;
    for (let index = 0; index < text.length; index++) {
      hash = (hash * 31 + text.charCodeAt(index)) | 0;
    }
  }
  return hash.toString(16);
}

const PROMPT_NOTE_MAX_CHARS = 2_000;
const ROSTER_SPEC_MAX_CHARS = 1_200;

/** Render the prompt-notes section injected into context (prime's formatHarnessStateForPrompt). */
export function renderHarnessPromptSection(state: HarnessState): string | undefined {
  const notes = state.entries.filter((entry) => entry.kind === 'prompt');
  if (notes.length === 0) return undefined;
  const lines = ['## Harness notes', ''];
  for (const note of notes) {
    const content =
      note.content.length <= PROMPT_NOTE_MAX_CHARS
        ? note.content
        : `${note.content.slice(0, PROMPT_NOTE_MAX_CHARS)}\n…[note truncated]`;
    lines.push(`### ${note.title} (${note.scope}, v${String(note.version)})`, '', content, '');
  }
  lines.push(
    'These notes were written by previous refine runs. Follow them; update them via the Refine tool when they go stale.',
  );
  return lines.join('\n');
}

/** Render the subagent roster section (reusable delegation specs). */
export function renderHarnessRosterSection(state: HarnessState): string | undefined {
  const specs = state.entries.filter((entry) => entry.kind === 'subagent');
  if (specs.length === 0) return undefined;
  const lines = ['## Harness subagent roster', ''];
  for (const spec of specs) {
    const content =
      spec.content.length <= ROSTER_SPEC_MAX_CHARS
        ? spec.content
        : `${spec.content.slice(0, ROSTER_SPEC_MAX_CHARS)}\n…[spec truncated]`;
    lines.push(
      `### ${spec.title} (${spec.scope}, v${String(spec.version)})`,
      spec.path.length > 0 ? `workspace: ${spec.path}` : '',
      '',
      content,
      '',
    );
  }
  lines.push(
    'Reuse these specs when delegating matching work: spawn a subagent whose prompt follows the spec instead of re-deriving it.',
  );
  return lines.join('\n');
}
