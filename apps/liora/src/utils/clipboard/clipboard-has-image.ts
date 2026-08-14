import { isFileLikeNativeFormat, isWSL, safeAvailableFormats } from './clipboard-common';
import { clipboard, type ClipboardModule } from './clipboard-native';
import { probeClipboardImageViaPowerShell } from './clipboard-image';

async function hasImageViaNative(clip: ClipboardModule | null): Promise<boolean> {
  if (clip === null) return false;

  // Finder exposes file icons/thumbnails as image data when a non-image file
  // is copied. Treat file-like clipboard contents as "not a pasteable image"
  // to match the read path in clipboard-image.ts.
  const formats = safeAvailableFormats(clip);
  if (formats.some(isFileLikeNativeFormat)) return false;

  try {
    if (clip.hasImage()) return true;
  } catch {
    // Fall through — Windows hosts sometimes throw or false-negative while
    // image bytes are still readable via getImageBinary / PowerShell.
  }

  // Prefer a cheap binary probe over trusting hasImage alone. Empty/throwing
  // getImageBinary keeps the probe false without treating text as media.
  try {
    const data = await clip.getImageBinary();
    return data.length > 0;
  } catch {
    return false;
  }
}

export async function clipboardHasImage(options?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  clipboard?: ClipboardModule | null;
  /** Injected for unit tests; production uses PowerShell ContainsImage. */
  powerShellProbe?: () => boolean;
}): Promise<boolean> {
  const env = options?.env ?? process.env;
  const platform = options?.platform ?? process.platform;
  const clip = options?.clipboard ?? clipboard;

  if (env['TERMUX_VERSION'] !== undefined) return false;

  // The focus-driven clipboard-image hint does not probe on plain Linux.
  // Spawning wl-paste / xclip on Wayland perturbs seat focus and re-triggers
  // the terminal's focus event, creating a focus feedback loop (issue #1090).
  // WSL is the exception: the Windows clipboard is the source of truth and is
  // reached through PowerShell, which does not touch the Linux seat.
  //
  // Image *paste* is unaffected on all platforms: it reads the clipboard
  // through readClipboardMedia() on the explicit paste path, not here.
  const wsl = platform === 'linux' && isWSL(env);
  if (platform !== 'darwin' && platform !== 'win32' && !wsl) return false;

  if (platform === 'darwin') {
    return hasImageViaNative(clip);
  }

  // win32 / WSL: native first, then PowerShell when native is false-negative.
  if (await hasImageViaNative(clip)) return true;

  const probe =
    options?.powerShellProbe ??
    (() => probeClipboardImageViaPowerShell({ env }));
  try {
    return probe();
  } catch {
    return false;
  }
}
