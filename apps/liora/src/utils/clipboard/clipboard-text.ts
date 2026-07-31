import { spawnSync } from 'node:child_process';

import { clipboard } from './clipboard-native';

function runClipboardCommand(command: string, args: readonly string[], input: string): void {
  const result = spawnSync(command, args, { encoding: 'utf8', input });
  if (result.error) throw result.error;
  if (result.status === 0) return;

  const detail = result.stderr.trim();
  throw new Error(
    detail.length > 0
      ? `${command} exited with code ${String(result.status)}: ${detail}`
      : `${command} exited with code ${String(result.status)}`,
  );
}

async function copyWithPlatformCommand(text: string): Promise<void> {
  const commands =
    process.platform === 'darwin'
      ? [{ command: 'pbcopy', args: [] as string[] }]
      : process.platform === 'win32'
        ? [{ command: 'clip.exe', args: [] as string[] }]
        : [
            { command: 'wl-copy', args: [] as string[] },
            { command: 'xclip', args: ['-selection', 'clipboard'] },
          ];

  let lastError: unknown;
  for (const candidate of commands) {
    try {
      runClipboardCommand(candidate.command, candidate.args, text);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('No clipboard command is available.');
}

/**
 * Read plain text from the system clipboard.
 *
 * Used as the fall-through for the image-paste shortcut (Ctrl-V / Alt-V):
 * when the clipboard holds no image the same keystroke pastes text, so the
 * binding never dead-ends. Returns `null` when the clipboard has no text or
 * every source fails.
 */
export async function readClipboardText(): Promise<string | null> {
  const clipboardModule = clipboard;
  if (clipboardModule?.getText !== undefined) {
    try {
      if (clipboardModule.hasText === undefined || clipboardModule.hasText()) {
        const text = await clipboardModule.getText();
        if (text.length > 0) return text;
      }
    } catch {
      // Fall back to platform clipboard commands below.
    }
  }

  const candidates =
    process.platform === 'darwin'
      ? [{ command: 'pbpaste', args: [] as string[] }]
      : process.platform === 'win32'
        ? [{ command: 'powershell.exe', args: ['-NoProfile', '-Command', 'Get-Clipboard'] }]
        : [
            { command: 'wl-paste', args: ['--no-newline'] },
            { command: 'xclip', args: ['-selection', 'clipboard', '-o'] },
          ];

  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate.command, candidate.args, {
        encoding: 'utf8',
        timeout: 3000,
      });
      if (result.error !== undefined || result.status !== 0) continue;
      if (result.stdout.length > 0) return result.stdout;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function copyTextToClipboard(text: string): Promise<void> {
  const clipboardModule = clipboard;
  if (clipboardModule?.setText !== undefined) {
    try {
      await clipboardModule.setText(text);
      return;
    } catch {
      // Fall back to platform clipboard commands below.
    }
  }

  try {
    await copyWithPlatformCommand(text);
  } catch {
    // Final fallback: OSC 52 (works over SSH in Kitty/WezTerm/etc.)
    copyViaOsc52(text);
  }
}

/**
 * Write text to the terminal clipboard via OSC 52 escape sequence.
 * Works in Kitty, WezTerm, Ghostty, and other modern terminals,
 * including over SSH where platform clipboard commands are unavailable.
 */
function copyViaOsc52(text: string): void {
  const encoded = Buffer.from(text, 'utf-8').toString('base64');
  // OSC 52 ; c ; <base64> ST  (ST = ESC \)
  process.stdout.write(`\x1B]52;c;${encoded}\x1B\\`);
}
