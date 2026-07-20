/**
 * Raw escape channel for kitty graphics sequences.
 *
 * The cell compositor only understands text cells, so kitty graphics control
 * sequences (image transmit/delete) must bypass it and go straight to the
 * terminal. The TUI installs a terminal writer while its event loop runs and
 * clears it on teardown; with no channel installed, callers fall back to the
 * half-block preview path.
 */

export type KittyGraphicsChannel = (sequence: string) => void;

let channel: KittyGraphicsChannel | undefined;

export function setKittyGraphicsChannel(next: KittyGraphicsChannel | undefined): void {
  channel = next;
}

export function emitKittyGraphics(sequence: string): boolean {
  if (channel === undefined) return false;
  channel(sequence);
  return true;
}
