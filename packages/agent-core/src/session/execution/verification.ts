/**
 * Trusted-host-only local verification. This executor intentionally runs outside
 * Kaos and must never be exposed as arbitrary model-supplied commands/paths.
 * The host authorizes its predetermined policy before any native operation.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export interface VerificationHostPolicy {
  /**
   * Must enforce host-owned argv plans and repository/evidence workspace bounds.
   * Throw to deny. Never implement this from a model-supplied approval boolean.
   * No default allow policy is supplied by this module.
   */
  authorize(input: {
    readonly operation: 'seal' | 'verify';
    readonly repoPath: string;
    readonly sourceRevision: string;
    readonly requirementsHash: string;
    readonly stages: readonly VerificationStage[];
    readonly evidenceRoot?: string;
  }): void | Promise<void>;
}

export interface VerificationStage {
  readonly id: string;
  /** Executable and argv, not a shell expression. */
  readonly command: readonly string[];
  readonly scope: string;
  readonly timeoutMs: number;
}
export interface VerificationArtifact {
  readonly version: 1;
  readonly sourceRevision: string;
  readonly sourceTree: string;
  readonly requirementsHash: string;
  readonly stages: readonly VerificationStage[];
  readonly artifactHash: string;
}
interface VerificationEnvironment {
  readonly values: Readonly<Record<string, string>>;
  readonly removedKeys: readonly string[];
}
export interface VerificationStageReceipt {
  readonly stageId: string;
  readonly command: readonly string[];
  readonly scope: string;
  readonly cwd: string;
  readonly environment: VerificationEnvironment;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputTruncated: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly stdoutHash: string;
  readonly stderrHash: string;
  readonly failure?: string;
}
export interface VerificationReceipt {
  readonly version: 1;
  readonly artifactHash: string;
  readonly sourceRevision: string;
  readonly sourceTree: string;
  readonly requirementsHash: string;
  readonly status: 'passed' | 'failed' | 'stale' | 'source_changed' | 'cancelled';
  readonly stages: readonly VerificationStageReceipt[];
  readonly evidencePath: string;
  readonly failure?: string;
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Allowlist, not a copy of the operator's credentials, proxies or terminal state. */
export function verificationEnvironment(home: string, ambient: NodeJS.ProcessEnv = process.env): VerificationEnvironment {
  const values: Record<string, string> = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'PATHEXT', 'TMP', 'TEMP', 'TMPDIR']) {
    if (ambient[key] !== undefined) values[key] = ambient[key];
  }
  Object.assign(values, {
    HOME: home, USERPROFILE: home, CI: 'true', GITHUB_ACTIONS: 'true', TZ: 'UTC',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'init.defaultBranch', GIT_CONFIG_VALUE_0: 'master',
  });
  return { values, removedKeys: Object.keys(ambient).filter(key => !(key in values)).toSorted() };
}

function validateStages(stages: readonly VerificationStage[]): void {
  if (stages.length === 0 || stages.length > 16) throw new Error('Verification requires 1–16 predetermined stages');
  const ids = new Set<string>();
  for (const stage of stages) {
    if (!/^[a-zA-Z0-9_-]+$/.test(stage.id) || ids.has(stage.id)) throw new Error('Invalid or duplicate stage id');
    ids.add(stage.id);
    if (stage.command.length === 0 || stage.command.some(arg => typeof arg !== 'string' || arg.includes('\0')) || !stage.command[0]) throw new Error('Invalid command');
    if (isAbsolute(stage.scope) || stage.scope.split(/[\\/]/).includes('..')) throw new Error('Scope must stay inside the artifact');
    if (!Number.isInteger(stage.timeoutMs) || stage.timeoutMs < 1 || stage.timeoutMs > 900_000) throw new Error('Stage timeout must be 1–900000ms');
  }
}

interface CommandResult {
  /** Raw retained bytes; decoding per chunk would corrupt split UTF-8 sequences. */
  stdout: Buffer; stderr: Buffer; exitCode: number | null; signal: string | null;
  timedOut: boolean; cancelled: boolean; outputTruncated: boolean; failure?: string;
}
const PIPE_SETTLE_GRACE_MS = 2_000;
/** Bounded output and process-group timeout; no implicit retries. */
function execute(command: readonly string[], cwd: string, env: Readonly<Record<string, string>>, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise(resolveResult => {
    const result: CommandResult = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: null, signal: null, timedOut: false, cancelled: false, outputTruncated: false };
    if (signal?.aborted) { result.cancelled = true; resolveResult(result); return; }
    const child = spawn(command[0]!, command.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const retained = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const retainedBytes = { stdout: 0, stderr: 0 };
    const collect = (key: 'stdout' | 'stderr', chunk: Buffer): void => {
      const remaining = Math.max(0, 1_048_576 - retainedBytes[key]);
      if (chunk.length > remaining) result.outputTruncated = true;
      const kept = chunk.subarray(0, remaining);
      if (kept.length === 0) return;
      retained[key].push(kept);
      retainedBytes[key] += kept.length;
    };
    child.stdout.on('data', (chunk: Buffer) => { collect('stdout', chunk); });
    child.stderr.on('data', (chunk: Buffer) => { collect('stderr', chunk); });
    let termination: Promise<void> | undefined;
    let pipeSettlement: NodeJS.Timeout | undefined;
    const stop = (): void => {
      if (!child.pid || termination) return;
      // A descendant that left the process group (setsid/daemonize) can keep the
      // inherited pipes open forever, so `close` would never fire. After a kill
      // grace period, stop reading so the stage settles and a receipt is written.
      pipeSettlement = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); }, PIPE_SETTLE_GRACE_MS);
      if (process.platform === 'win32') {
        termination = new Promise<void>(settled => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { env, stdio: 'ignore' });
          killer.once('error', () => { child.kill('SIGKILL'); });
          killer.once('close', code => {
            if (code !== 0) child.kill('SIGKILL');
            settled();
          });
        });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        termination = Promise.resolve();
      }
    };
    const onAbort = (): void => { result.cancelled = true; stop(); };
    const timer = setTimeout(() => { result.timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    // Handle an abort racing spawn/listener installation.
    if (signal?.aborted) onAbort();
    child.on('error', error => { result.failure = error.message; });
    child.once('close', (code, exitSignal) => {
      timer[Symbol.dispose]();
      if (pipeSettlement) clearTimeout(pipeSettlement);
      signal?.removeEventListener('abort', onAbort);
      result.exitCode = result.failure ? null : code;
      result.signal = exitSignal;
      result.stdout = Buffer.concat(retained.stdout);
      result.stderr = Buffer.concat(retained.stderr);
      // Cancellation acknowledgement is not resource settlement. Wait for the
      // Windows tree-kill helper as well as the owned command close event.
      void (termination ?? Promise.resolve()).then(() => { resolveResult(result); });
    });
  });
}
/**
 * Repository-local config is workspace-controlled. Override settings that make
 * git run workspace programs (hooks such as post-checkout, fsmonitor) so no
 * workspace code executes outside the host-authorized stage plan. Command-line
 * `-c` takes precedence over repository config.
 */
const TRUSTED_GIT_CONFIG = ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'core.fsmonitor=false'];

/**
 * Filter drivers (smudge/clean/process) selected by .gitattributes run during
 * checkout and status. Neutralize every driver defined in workspace-controlled
 * (local or worktree) config: empty commands make git skip the conversion.
 * Drivers only in global/system config belong to the operator and stay.
 */
async function workspaceFilterOverrides(repo: string, signal?: AbortSignal): Promise<string[]> {
  const result = await execute(['git', '--no-pager', ...TRUSTED_GIT_CONFIG, '-C', repo, 'config', '--show-scope', '--get-regexp', String.raw`^filter\..*\.(smudge|clean|process|required)$`],
    repo, verificationEnvironment(repo).values, 60_000, signal);
  if (result.cancelled) throw new Error('Verification cancelled');
  // Exit 1 means no matching keys.
  if (result.exitCode === 1) return [];
  if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error(result.failure ?? (result.stderr.toString('utf8') || 'Git verification operation failed'));
  const names = new Set<string>();
  for (const line of result.stdout.toString('utf8').split('\n')) {
    const match = /^(\S+)\tfilter\.(.+)\.(?:smudge|clean|process|required)(?: |$)/.exec(line);
    if (match !== null && match[1] !== 'global' && match[1] !== 'system') names.add(match[2]!);
  }
  return [...names].flatMap(name => ['-c', `filter.${name}.smudge=`, '-c', `filter.${name}.clean=`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`]);
}

async function git(repo: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  const filters = await workspaceFilterOverrides(repo, signal);
  const result = await execute(['git', '--no-pager', ...TRUSTED_GIT_CONFIG, ...filters, '-C', repo, ...args], repo, verificationEnvironment(repo).values, 60_000, signal);
  if (result.cancelled) throw new Error('Verification cancelled');
  if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error(result.failure ?? (result.stderr.toString('utf8') || 'Git verification operation failed'));
  return result.stdout.toString('utf8').trim();
}

/** Seal only a full commit id, never HEAD/a branch or uncommitted files. */
async function resolveArtifact(input: {
  readonly signal?: AbortSignal;
  readonly repoPath: string; readonly sourceRevision: string;
  readonly requirementsHash: string; readonly stages: readonly VerificationStage[];
}): Promise<VerificationArtifact> {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.sourceRevision)) throw new Error('A full committed revision is required');
  if (!/^[a-f0-9]{64}$/.test(input.requirementsHash)) throw new Error('Requirements must be a SHA-256 digest');
  validateStages(input.stages);
  const sourceRevision = await git(input.repoPath, ['rev-parse', '--verify', `${input.sourceRevision}^{commit}`], input.signal);
  const sourceTree = await git(input.repoPath, ['rev-parse', `${sourceRevision}^{tree}`], input.signal);
  const body = { version: 1 as const, sourceRevision, sourceTree, requirementsHash: input.requirementsHash,
    stages: input.stages.map(stage => ({ id: stage.id, command: [...stage.command], scope: stage.scope, timeoutMs: stage.timeoutMs })) };
  return { ...body, artifactHash: hash(body) };
}

/** Seal the producer only when its HEAD and clean tracked/untracked tree match. */
export async function sealVerificationArtifact(input: {
  readonly hostPolicy: VerificationHostPolicy;
  readonly repoPath: string; readonly sourceRevision: string;
  readonly requirementsHash: string; readonly stages: readonly VerificationStage[];
}): Promise<VerificationArtifact> {
  const requested = { repoPath: input.repoPath, sourceRevision: input.sourceRevision,
    requirementsHash: input.requirementsHash, stages: structuredClone(input.stages) };
  await input.hostPolicy.authorize({ operation: 'seal', ...requested, stages: structuredClone(requested.stages) });
  const artifact = await resolveArtifact(requested);
  if (await git(requested.repoPath, ['rev-parse', 'HEAD']) !== artifact.sourceRevision ||
      await git(requested.repoPath, ['status', '--porcelain', '--untracked-files=all'])) {
    throw new Error('Seal requires a clean producer tree at the requested revision');
  }
  return artifact;
}

/**
 * The coordinator supplies a live requirements digest, checked before each stage
 * and publication. This function never verifies the producer's moving worktree.
 * Evidence and the detached checkout are retained for audit; caller owns retention.
 */
export async function runArtifactVerification(input: {
  readonly hostPolicy: VerificationHostPolicy;
  readonly repoPath: string; readonly artifact: VerificationArtifact;
  readonly evidenceRoot: string;
  /** Verification-owned cancellation, never the conductor inference signal. */
  readonly signal?: AbortSignal;
  readonly currentRequirementsHash: () => string | Promise<string>;
}): Promise<VerificationReceipt> {
  // Snapshot caller data before the async policy hook; mutation cannot change the authorized plan.
  const requested = structuredClone(input.artifact);
  const repoPath = input.repoPath;
  const evidenceRoot = input.evidenceRoot;
  const currentRequirementsHash = input.currentRequirementsHash;
  const signal = input.signal;
  await input.hostPolicy.authorize({ operation: 'verify', repoPath,
    sourceRevision: requested.sourceRevision, requirementsHash: requested.requirementsHash,
    stages: structuredClone(requested.stages), evidenceRoot });
  if (requested.version !== 1) throw new Error('Unsupported artifact version');
  validateStages(requested.stages);
  const body = { version: 1 as const, sourceRevision: requested.sourceRevision, sourceTree: requested.sourceTree,
    requirementsHash: requested.requirementsHash,
    stages: requested.stages.map(stage => ({ id: stage.id, command: [...stage.command], scope: stage.scope, timeoutMs: stage.timeoutMs })) };
  if (hash(body) !== requested.artifactHash) throw new Error('Artifact seal mismatch');
  const artifact = requested;
  await mkdir(evidenceRoot, { recursive: true });
  const evidenceDir = await mkdtemp(join(resolve(evidenceRoot), 'verification-'));
  const evidencePath = join(evidenceDir, 'receipt.json');
  const checkout = join(evidenceDir, 'source');
  const home = join(evidenceDir, 'home');
  await mkdir(home);
  const environment = verificationEnvironment(home);
  const stages: VerificationStageReceipt[] = [];
  let status: VerificationReceipt['status'] = 'passed';
  const fresh = async (): Promise<boolean> => await currentRequirementsHash() === artifact.requirementsHash;
  let failure: string | undefined;
  try {
    signal?.throwIfAborted();
    const resolved = await resolveArtifact({ ...artifact, repoPath, signal });
    if (resolved.artifactHash !== artifact.artifactHash) throw new Error('Artifact seal mismatch');
    if (!await fresh()) status = 'stale';
    else {
      await git(repoPath, ['worktree', 'add', '--detach', checkout, artifact.sourceRevision], signal);
      const unchanged = async (): Promise<boolean> =>
        await git(checkout, ['rev-parse', 'HEAD'], signal) === artifact.sourceRevision &&
        !(await git(checkout, ['status', '--porcelain', '--untracked-files=no'], signal));
      for (const stage of artifact.stages) {
        signal?.throwIfAborted();
        if (!await fresh()) { status = 'stale'; break; }
        if (!await unchanged()) { status = 'source_changed'; break; }
        const cwd = await realpath(resolve(checkout, stage.scope));
        const scopePath = relative(await realpath(checkout), cwd);
        if (isAbsolute(scopePath) || scopePath.split(/[\\/]/).includes('..')) throw new Error('Scope resolves outside the artifact');
        const startedAt = new Date().toISOString();
        const result = await execute(stage.command, cwd, environment.values, stage.timeoutMs, signal);
        const stdoutPath = join(evidenceDir, `${stage.id}.stdout.log`);
        const stderrPath = join(evidenceDir, `${stage.id}.stderr.log`);
        await writeFile(stdoutPath, result.stdout, { flag: 'wx' });
        await writeFile(stderrPath, result.stderr, { flag: 'wx' });
        stages.push({ stageId: stage.id, command: stage.command, scope: stage.scope, cwd, environment,
          exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, cancelled: result.cancelled,
          outputTruncated: result.outputTruncated, startedAt, finishedAt: new Date().toISOString(),
          stdoutPath, stderrPath,
          stdoutHash: createHash('sha256').update(result.stdout).digest('hex'),
          stderrHash: createHash('sha256').update(result.stderr).digest('hex'), ...(result.failure ? { failure: result.failure } : {}) });
        if (result.cancelled || signal?.aborted) { status = 'cancelled'; break; }
        if (!await fresh()) { status = 'stale'; break; }
        if (!await unchanged()) { status = 'source_changed'; break; }
        if (result.exitCode !== 0 || result.timedOut || result.failure) { status = 'failed'; break; }
      }
    }
  } catch (error) {
    status = signal?.aborted ? 'cancelled' : 'failed';
    failure = error instanceof Error ? error.message : String(error);
  }
  if (signal?.aborted) status = 'cancelled';
  const receipt: VerificationReceipt = { version: 1, artifactHash: artifact.artifactHash,
    sourceRevision: artifact.sourceRevision, sourceTree: artifact.sourceTree,
    requirementsHash: artifact.requirementsHash, status, stages, evidencePath,
    ...(failure ? { failure } : {}) };
  await writeFile(evidencePath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}
