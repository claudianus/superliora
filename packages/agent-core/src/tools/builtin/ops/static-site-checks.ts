/**
 * Static-site verification contract.
 *
 * Pure HTML/CSS/JS deliverables have no package.json scripts, so the
 * script-based project gates (test/typecheck/lint) never run and the job
 * ledger would record "unverified (checks did not run)" forever — even when
 * the work is verifiable. A static site can still prove the two things that
 * matter about it: every changed file exists, and every changed JS file
 * parses (`node --check`).
 */

import type { Readable } from 'node:stream';

import type { Kaos, KaosProcess } from '@superliora/kaos';
import { extname, join } from 'pathe';

const STATIC_SITE_EXTENSIONS = new Set([
  '.css',
  '.cjs',
  '.gif',
  '.htm',
  '.html',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.map',
  '.md',
  '.mjs',
  '.png',
  '.svg',
  '.txt',
  '.webmanifest',
  '.webp',
]);

const STATIC_JS_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);

const NODE_CHECK_TIMEOUT_MS = 30_000;
/** Bound on JS files syntax-checked in one run; rest are skipped, not failed. */
export const MAX_STATIC_JS_CHECKS = 50;

/** True when every changed file is a static-site artifact (no build toolchain). */
export function isStaticSiteChangeSet(filesChanged: readonly string[]): boolean {
  if (filesChanged.length === 0) return false;
  return filesChanged.every((file) => STATIC_SITE_EXTENSIONS.has(extname(file).toLowerCase()));
}

export interface StaticSiteCheckFailure {
  readonly file: string;
  readonly detail: string;
}

export interface StaticSiteCheckOutcome {
  readonly ok: boolean;
  readonly jsChecked: number;
  readonly missingFiles: readonly string[];
  readonly failures: readonly StaticSiteCheckFailure[];
}

/**
 * Verify a static-site change set under `cwd`. `filesChanged` entries are
 * relative to `cwd` (as produced by git diff/status).
 *
 * ponytail: a file that no longer exists counts as missing (failure), so a
 * change set that legitimately deletes a file fails the gate. Deletion intent
 * is not read from git status; restore the file or merge manually in that
 * rare case.
 */
export async function runStaticSiteChecks(
  kaos: Kaos,
  cwd: string,
  filesChanged: readonly string[],
): Promise<StaticSiteCheckOutcome> {
  const missingFiles: string[] = [];
  const failures: StaticSiteCheckFailure[] = [];
  let jsChecked = 0;
  for (const file of filesChanged) {
    const stat = await kaos.stat(join(cwd, file)).catch(() => undefined);
    if (stat === undefined) {
      missingFiles.push(file);
      continue;
    }
    if (!STATIC_JS_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    if (jsChecked >= MAX_STATIC_JS_CHECKS) continue;
    jsChecked += 1;
    const failure = await execNodeCheck(kaos, cwd, file);
    if (failure !== undefined) failures.push({ file, detail: failure });
  }
  return {
    ok: missingFiles.length === 0 && failures.length === 0,
    jsChecked,
    missingFiles,
    failures,
  };
}

/** Returns undefined when `node --check <file>` passes, else a short detail. */
async function execNodeCheck(kaos: Kaos, cwd: string, file: string): Promise<string | undefined> {
  let proc: KaosProcess;
  try {
    proc = await kaos.withCwd(cwd).exec('node', '--check', file);
  } catch (error) {
    return `node --check failed to start: ${error instanceof Error ? error.message : String(error)}`;
  }
  try {
    proc.stdin.end();
  } catch {
    /* stdin already closed */
  }
  const timer = setTimeout(() => {
    void proc.kill('SIGTERM');
  }, NODE_CHECK_TIMEOUT_MS);
  try {
    const [exitCode, stderr] = await Promise.all([proc.wait(), collectText(proc.stderr)]);
    if (exitCode === 0) return undefined;
    const detail = stderr.trim();
    return detail.length > 0 ? detail.slice(0, 500) : `node --check exited ${String(exitCode)}`;
  } finally {
    clearTimeout(timer);
    try {
      await proc.dispose();
    } catch {
      /* best-effort */
    }
  }
}

async function collectText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer));
    }
  } catch {
    /* stream closed mid-read — return what we have */
  }
  return Buffer.concat(chunks).toString('utf8');
}
