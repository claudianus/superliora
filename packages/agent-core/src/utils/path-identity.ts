// Path identity: when do two spellings name the same file?
//
// Path case sensitivity is a property of the filesystem, not of the OS, and
// inferring it from `process.platform` is wrong in both directions. A Linux
// container on a case-insensitive mount reports `linux` yet folds case, so
// raw comparison drops the match; an NFS export mounted case-sensitively on
// macOS reports `darwin` yet does not, so folding merges two distinct
// directories and the agent watches the wrong one.
//
// The question is answered by asking the filesystem, once, and caching it. The
// probe is lazy rather than module-scope: this is imported through service
// barrels, and touching the filesystem at import time would run under whatever
// module mocks the importing test installed.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let foldCase: boolean | undefined;

/** True when the filesystem this process runs on compares paths case-insensitively. */
export function isCaseInsensitiveFs(): boolean {
  if (foldCase !== undefined) return foldCase;
  const probeDir = join(tmpdir(), `.liora-case-probe-${process.pid}`);
  try {
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, 'CaseProbe'), 'x');
    foldCase = existsSync(join(probeDir, 'caseprobe'));
  } catch {
    // No writable temp dir, or no native support. Assume the conservative
    // answer: distinct spellings are distinct paths.
    foldCase = false;
  } finally {
    try {
      rmSync(probeDir, { recursive: true, force: true });
    } catch {
      // A leftover probe directory is harmless.
    }
  }
  return foldCase;
}

/** Separator-normalised spelling, folded when the filesystem folds case. */
export function foldPathForIdentity(path: string): string {
  const unified = path.replaceAll('\\', '/');
  return isCaseInsensitiveFs() ? unified.toLowerCase() : unified;
}

/** Do two spellings name the same path on this filesystem? */
export function pathsIdentical(left: string, right: string): boolean {
  return foldPathForIdentity(left) === foldPathForIdentity(right);
}
