import type { TUIEditorInputMode } from '#/tui/components/editor/editor-contract';

/** One stashed prompt draft: the raw editor text plus the mode it was typed in. */
export interface PromptStashEntry {
  readonly text: string;
  readonly mode: TUIEditorInputMode;
}

/**
 * In-memory LIFO stash of prompt drafts (Ctrl-X stashes the current draft;
 * Ctrl-X on an empty editor pops the most recent one). Entries are stored
 * as-is — callers decide what counts as stashable.
 *
 * Entries are also mirrored to session disk via `prompt-input-state-store`
 * so a hard kill can restore them on resume.
 */
export class PromptStash {
  private readonly entries: PromptStashEntry[] = [];

  /** Push a draft onto the stash; returns the new stash size. */
  push(entry: PromptStashEntry): number {
    this.entries.push(entry);
    return this.entries.length;
  }

  /** Pop the most recently stashed draft, or `undefined` when empty. */
  pop(): PromptStashEntry | undefined {
    return this.entries.pop();
  }

  get size(): number {
    return this.entries.length;
  }

  /** Snapshot oldest→newest for durable persistence. */
  toArray(): readonly PromptStashEntry[] {
    return this.entries.slice();
  }

  /** Replace the in-memory stack (used when restoring a session). */
  replaceAll(entries: readonly PromptStashEntry[]): void {
    this.entries.length = 0;
    this.entries.push(...entries);
  }

  clear(): void {
    this.entries.length = 0;
  }
}
