/**
 * Capture / restore helpers that bridge TUI runtime state with the durable
 * `prompt-input-state-store` under each session directory.
 */

import type { Session } from '@superliora/sdk';

import {
  persistPromptInputState,
  queuedMessagesFromSnapshot,
  readPromptInputState,
  schedulePersistPromptInputDraft,
  stashEntriesFromSnapshot,
  type PersistablePromptInputState,
} from '../prompt-input-state-store';
import type { QueuedMessage } from '../types';
import type { PromptStash } from './prompt-stash';

export interface PromptInputRuntimeHost {
  session: Session | undefined;
  state: {
    queuedMessages: QueuedMessage[];
    editor: {
      getText(): string;
      setText(text: string): void;
      inputMode: 'prompt' | 'bash';
      onInputModeChange?: (mode: 'prompt' | 'bash') => void;
    };
  };
  readonly promptStash: PromptStash;
  lastUserInput: string | undefined;
  updateQueueDisplay(): void;
  updateEditorBorderHighlight?(text?: string): void;
  handleInputModeChange?(mode: 'prompt' | 'bash'): void;
}

export function capturePromptInputState(host: PromptInputRuntimeHost): PersistablePromptInputState {
  const text = host.state.editor.getText();
  const mode = host.state.editor.inputMode === 'bash' ? 'bash' : 'prompt';
  return {
    messages: host.state.queuedMessages,
    stash: host.promptStash.toArray(),
    draft: text.length > 0 ? { text, mode } : null,
    lastUserInput: host.lastUserInput,
  };
}

/** Persist queue + stash + draft + lastUserInput immediately. */
export function flushPromptInputState(host: PromptInputRuntimeHost): void {
  persistPromptInputState(host.session, capturePromptInputState(host));
}

/** Debounced draft-only write path for keystrokes. */
export function schedulePromptInputDraftPersist(host: PromptInputRuntimeHost): void {
  schedulePersistPromptInputDraft(host.session, capturePromptInputState(host));
}

/**
 * Load durable prompt-input state into the live TUI after a session is
 * attached or resumed. Empty files are a no-op.
 */
export async function restorePromptInputState(host: PromptInputRuntimeHost): Promise<{
  readonly restoredQueue: number;
  readonly restoredStash: number;
  readonly restoredDraft: boolean;
}> {
  const session = host.session;
  if (session === undefined) {
    return { restoredQueue: 0, restoredStash: 0, restoredDraft: false };
  }

  const snapshot = await readPromptInputState(session);
  const messages = queuedMessagesFromSnapshot(snapshot);
  const stash = stashEntriesFromSnapshot(snapshot);

  host.state.queuedMessages = messages;
  host.promptStash.replaceAll(stash);

  if (snapshot.lastUserInput !== undefined && snapshot.lastUserInput.length > 0) {
    host.lastUserInput = snapshot.lastUserInput;
  }

  let restoredDraft = false;
  const draft = snapshot.draft;
  // Only restore the draft when the editor is still empty so we do not clobber
  // text the user already typed during a slow resume overlay.
  if (draft !== null && host.state.editor.getText().length === 0) {
    const mode = draft.mode === 'bash' ? 'bash' : 'prompt';
    if (host.state.editor.inputMode !== mode) {
      host.state.editor.inputMode = mode;
      host.state.editor.onInputModeChange?.(mode);
      host.handleInputModeChange?.(mode);
    }
    host.state.editor.setText(draft.text);
    host.updateEditorBorderHighlight?.(draft.text);
    restoredDraft = true;
  }

  host.updateQueueDisplay();
  return {
    restoredQueue: messages.length,
    restoredStash: stash.length,
    restoredDraft,
  };
}
