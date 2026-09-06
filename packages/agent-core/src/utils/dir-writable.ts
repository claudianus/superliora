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
  try {
    const probe = mkdtempSync(join(dir, 'writable-probe-'));
    rmSync(probe, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
