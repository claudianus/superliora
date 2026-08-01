import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PROMPT_INPUT_STATE_FILE,
  promptInputStatePath,
  queuedMessagesFromSnapshot,
  readPromptInputState,
  stashEntriesFromSnapshot,
  writePromptInputState,
} from '#/tui/prompt-input-state-store';
import { PromptStash } from '#/tui/utils/prompt-stash';
import {
  capturePromptInputState,
  restorePromptInputState,
  type PromptInputRuntimeHost,
} from '#/tui/utils/prompt-input-state';

const dirs: string[] = [];

function session(sessionDir?: string) {
  return {
    id: 'session-test',
    summary: sessionDir === undefined ? undefined : { sessionDir },
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'liora-prompt-input-'));
  dirs.push(dir);
  return dir;
}

describe('prompt-input-state-store', () => {
  it('returns undefined path without sessionDir', () => {
    expect(promptInputStatePath(session())).toBeUndefined();
  });

  it('round-trips queue, stash, draft, and lastUserInput', async () => {
    const dir = await tempDir();
    await writePromptInputState(session(dir), {
      messages: [
        { text: 'first queued', mode: 'prompt' },
        { text: 'ls -la', mode: 'bash', displayText: '!ls -la' },
      ],
      stash: [{ text: 'stashed draft', mode: 'prompt' }],
      draft: { text: 'typing…', mode: 'prompt' },
      lastUserInput: 'previous send',
    });

    const raw = await readFile(join(dir, PROMPT_INPUT_STATE_FILE), 'utf8');
    expect(raw).toContain('first queued');
    expect(raw).toContain('stashed draft');

    const snapshot = await readPromptInputState(session(dir));
    expect(queuedMessagesFromSnapshot(snapshot)).toEqual([
      { text: 'first queued', mode: 'prompt' },
      { text: 'ls -la', mode: 'bash', displayText: '!ls -la' },
    ]);
    expect(stashEntriesFromSnapshot(snapshot)).toEqual([
      { text: 'stashed draft', mode: 'prompt' },
    ]);
    expect(snapshot.draft).toEqual({ text: 'typing…', mode: 'prompt' });
    expect(snapshot.lastUserInput).toBe('previous send');
  });

  it('treats corrupt files as empty instead of throwing', async () => {
    const dir = await tempDir();
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, PROMPT_INPUT_STATE_FILE), '{not-json', 'utf8');
    await expect(readPromptInputState(session(dir))).resolves.toMatchObject({
      messages: [],
      stash: [],
      draft: null,
    });
  });

  it('drops empty drafts so resume does not force a blank mode change', async () => {
    const dir = await tempDir();
    await writePromptInputState(session(dir), {
      messages: [],
      stash: [],
      draft: { text: '', mode: 'bash' },
    });
    const snapshot = await readPromptInputState(session(dir));
    expect(snapshot.draft).toBeNull();
  });
});

describe('prompt-input-state restore helpers', () => {
  function makeHost(sessionDir: string): PromptInputRuntimeHost {
    let text = '';
    let mode: 'prompt' | 'bash' = 'prompt';
    return {
      session: {
        id: 's1',
        summary: { sessionDir },
      } as PromptInputRuntimeHost['session'],
      state: {
        queuedMessages: [],
        editor: {
          getText: () => text,
          setText: (next: string) => {
            text = next;
          },
          get inputMode() {
            return mode;
          },
          set inputMode(next: 'prompt' | 'bash') {
            mode = next;
          },
        },
      },
      promptStash: new PromptStash(),
      lastUserInput: undefined,
      updateQueueDisplay: vi.fn(),
      updateEditorBorderHighlight: vi.fn(),
      handleInputModeChange: vi.fn(),
    };
  }

  it('restores queue, stash, draft, and lastUserInput into a live host', async () => {
    const dir = await tempDir();
    await writePromptInputState(session(dir), {
      messages: [{ text: 'queued after crash', mode: 'prompt' }],
      stash: [{ text: 'ctrl-x stash', mode: 'bash' }],
      draft: { text: 'half typed', mode: 'prompt' },
      lastUserInput: 'last send',
    });

    const host = makeHost(dir);
    const result = await restorePromptInputState(host);

    expect(result).toEqual({
      restoredQueue: 1,
      restoredStash: 1,
      restoredDraft: true,
    });
    expect(host.state.queuedMessages).toEqual([{ text: 'queued after crash', mode: 'prompt' }]);
    expect(host.promptStash.toArray()).toEqual([{ text: 'ctrl-x stash', mode: 'bash' }]);
    expect(host.state.editor.getText()).toBe('half typed');
    expect(host.lastUserInput).toBe('last send');
    expect(host.updateQueueDisplay).toHaveBeenCalled();
  });

  it('does not clobber a non-empty editor draft during slow resume', async () => {
    const dir = await tempDir();
    await writePromptInputState(session(dir), {
      messages: [],
      stash: [],
      draft: { text: 'from disk', mode: 'prompt' },
    });
    const host = makeHost(dir);
    host.state.editor.setText('already typing');
    const result = await restorePromptInputState(host);
    expect(result.restoredDraft).toBe(false);
    expect(host.state.editor.getText()).toBe('already typing');
  });

  it('capturePromptInputState snapshots live editor + queue', () => {
    const host = makeHost('/tmp/unused');
    host.state.queuedMessages = [{ text: 'q1' }];
    host.promptStash.push({ text: 's1', mode: 'prompt' });
    host.state.editor.setText('drafting');
    host.lastUserInput = 'sent';
    expect(capturePromptInputState(host)).toEqual({
      messages: [{ text: 'q1' }],
      stash: [{ text: 's1', mode: 'prompt' }],
      draft: { text: 'drafting', mode: 'prompt' },
      lastUserInput: 'sent',
    });
  });
});
