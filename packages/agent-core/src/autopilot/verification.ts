const META = /["'`$;|&<>*?()\n\r]|\bon\b/i;
export type VerificationCommand = string | { readonly command: string; readonly shell?: boolean };
export interface VerificationResult { readonly passed: boolean; readonly output: string; readonly failedCommand?: string; }
export function parseVerificationCommand(c: VerificationCommand): { readonly tokens: readonly string[]; readonly useShell: boolean } | null {
  if (typeof c === 'object') { if (c.shell === true) return { tokens: ['-c', c.command], useShell: true }; const t = tok(c.command); return t ? { tokens: t, useShell: false } : null; }
  const t = tok(c); return t ? { tokens: t, useShell: false } : null;
}
export function findUnsafeVerificationCommand(cs: readonly VerificationCommand[]): VerificationCommand | undefined { for (const c of cs) if (parseVerificationCommand(c) === null) return c; return undefined; }
function tok(c: string): readonly string[] | null { const ts = c.trim().split(/\s+/).filter((t) => t); if (!ts.length) return null; for (const t of ts) if (META.test(t)) return null; return ts; }
