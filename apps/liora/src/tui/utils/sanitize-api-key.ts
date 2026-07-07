const BRACKETED_PASTE_START = '\u001B[200~';
const BRACKETED_PASTE_END = '\u001B[201~';
// oxlint-disable-next-line no-control-regex -- ESC (\x1b) strips pasted terminal control sequences
const ANSI_CSI = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export function sanitizeApiKeyValue(value: string): string {
  return value
    .replaceAll(BRACKETED_PASTE_START, '')
    .replaceAll(BRACKETED_PASTE_END, '')
    .replace(ANSI_CSI, '')
    .trim();
}
