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
}
