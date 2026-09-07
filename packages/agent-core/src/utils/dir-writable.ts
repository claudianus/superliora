/**
 * Real write probe for a directory.
 *
 * `accessSync(dir, W_OK)` reports false on ACL-restricted or network-mounted
 * volumes (redirected homes on other drives are common) that accept writes
 * fine — which used to push repo-index / codemap sqlite files into the OS
 * temp dir on the small system drive, unbounded and never GC'd. Probe with an
 * actual scratch create+remove instead.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function isDirWritable(dir: string): boolean {
  let probe: string;
  try {
    probe = mkdtempSync(join(dir, 'writable-probe-'));
  } catch {
    return false;
  }
  // Creation succeeding is the verdict; removal is cleanup, not a second
  // gate. An AV hold or immutable-flag race on the just-created probe must
  // not read as "unwritable" — that would re-park sqlite on the OS temp,
  // the exact failure this probe replaced. A leftover probe dir is cheap.
  try {
    rmSync(probe, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
  return true;
}
