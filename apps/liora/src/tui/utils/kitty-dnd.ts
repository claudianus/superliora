/**
 * Kitty Drag-and-Drop Protocol Handler
 *
 * Kitty terminal supports drag-and-drop of files from file managers.
 * When files are dropped, Kitty sends the file paths via OSC 52 sequences:
 *   ESC ] 52 ; c ; <base64-encoded-paths> BEL
 *
 * The base64-encoded data contains file paths separated by newlines.
 */

import type { TUIState } from '#/tui/tui-state';

/** OSC 52 DnD sequence pattern: ESC ] 52 ; c ; <base64> BEL or ESC ] 52 ; c ; <base64> ESC \ */
const OSC52_DND_PATTERN = /\u001B\]52;c;([A-Za-z0-9+/=]+)(?:\u0007|\u001B\\)/g;

/** Partial OSC 52 prefix for buffering incomplete sequences */
const OSC52_PREFIX = '\u001B]52;c;';

export interface KittyDndInputState {
  buffer: string;
}

export type KittyDndInputResult =
  | {
      consume?: boolean;
      data?: string;
    }
  | undefined;

export function createKittyDndInputState(): KittyDndInputState {
  return { buffer: '' };
}

/**
 * Handle incoming terminal input, extracting OSC 52 DnD sequences.
 * Returns consumed/remaining data for the input listener chain.
 */
export function handleKittyDndInput(
  data: string,
  onFileDrop: (paths: readonly string[]) => void,
  inputState: KittyDndInputState = createKittyDndInputState(),
): KittyDndInputResult {
  let remaining = data;

  // If we have a buffered partial sequence, try to complete it
  if (inputState.buffer !== '') {
    const candidate = `${inputState.buffer}${data}`;
    const stripped = stripOsc52Dnd(candidate, onFileDrop);
    if (stripped !== candidate) {
      inputState.buffer = '';
      return resultFromRemaining(stripped);
    }

    // Check if buffer is getting too large (likely not a DnD sequence)
    if (candidate.length > 4096) {
      inputState.buffer = '';
      return undefined;
    }

    inputState.buffer = candidate;
    return { consume: true };
  }

  // Strip complete OSC 52 DnD sequences
  remaining = stripOsc52Dnd(remaining, onFileDrop);

  // Check for partial OSC 52 sequence at the end
  const partialStart = findPartialOsc52Start(remaining);
  if (partialStart !== -1) {
    inputState.buffer = remaining.slice(partialStart);
    return resultFromRemaining(remaining.slice(0, partialStart));
  }

  if (remaining !== data) return resultFromRemaining(remaining);

  return undefined;
}

function stripOsc52Dnd(data: string, onFileDrop: (paths: readonly string[]) => void): string {
  let remaining = data;

  for (;;) {
    const match = OSC52_DND_PATTERN.exec(remaining);
    if (match === null) return remaining;

    const base64Data = match[1];
    const paths = decodeDndPaths(base64Data);
    if (paths.length > 0) {
      onFileDrop(paths);
    }

    remaining = `${remaining.slice(0, match.index)}${remaining.slice(match.index + match[0].length)}`;
    // Reset regex lastIndex after modifying the string
    OSC52_DND_PATTERN.lastIndex = 0;
  }
}

function decodeDndPaths(base64: string): readonly string[] {
  try {
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    // Paths are separated by newlines
    return decoded
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  } catch {
    return [];
  }
}

function findPartialOsc52Start(data: string): number {
  // Look for the start of an OSC 52 sequence
  const fullPrefixIndex = data.indexOf(OSC52_PREFIX);
  if (fullPrefixIndex !== -1) return fullPrefixIndex;

  // Check for partial prefix at the end of the data
  for (let i = 0; i < data.length; i++) {
    const suffix = data.slice(i);
    if (OSC52_PREFIX.startsWith(suffix) && suffix.length > 1) {
      return i;
    }
  }

  return -1;
}

function resultFromRemaining(data: string): KittyDndInputResult {
  if (data.length === 0) return { consume: true };
  return { data };
}

/**
 * Install Kitty DnD tracking on the TUI state.
 * Returns a dispose function.
 */
export function installKittyDndTracking(
  state: Pick<TUIState, 'terminal' | 'ui'>,
  onFileDrop: (paths: readonly string[]) => void,
): () => void {
  const inputState = createKittyDndInputState();
  const disposeInputListener = state.ui.addInputListener((data) =>
    handleKittyDndInput(data, onFileDrop, inputState),
  );

  return () => {
    disposeInputListener();
  };
}
