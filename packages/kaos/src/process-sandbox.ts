/**
 * Optional process-sandbox backends for LocalKaos.exec.
 *
 * Docker confines commands to a container with workspace (+ extra dirs)
 * mounted, read-only mounts when requested. Windows Job Object is a
 * process-tree supervisor only — never describe it as a filesystem jail.
 *
 * Docker execution failures never fall back to host execution.
 */

import { execFileSync, spawn } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { isAbsolute } from 'pathe';

import { assignPidToWindowsJob } from './windows-job';

export type ProcessSandboxBackend = 'docker' | 'job';

export interface ProcessSandboxMount {
  readonly host: string;
  readonly container: string;
  readonly readOnly?: boolean;
}

export interface ProcessSandboxConfig {
  readonly backend: ProcessSandboxBackend;
  readonly workspaceDir: string;
  readonly additionalDirs?: readonly string[];
  readonly readOnly?: boolean;
  readonly image?: string;
  readonly resources?: ProcessSandboxResources;
  /** Injected for tests. */
  readonly dockerBin?: string;
}

export interface ProcessSandboxResources {
  readonly memoryMb?: number;
  readonly cpus?: number;
  readonly pidsLimit?: number;
}

export const DEFAULT_SANDBOX_IMAGE = 'bash:5.2';

function resourceLimit(value: number | undefined, fallback: number, name: string, integer = false): string {
  const limit = value ?? fallback;
  if (!Number.isFinite(limit) || limit <= 0 || (integer && !Number.isSafeInteger(limit))) {
    throw new Error(`Invalid Docker sandbox ${name}: expected a positive ${integer ? 'integer' : 'number'}`);
  }
  return String(limit);
}
export const SUPERLIORA_NO_PROCESS_SANDBOX_ENV = 'SUPERLIORA_NO_PROCESS_SANDBOX';
export const SUPERLIORA_SANDBOX_IMAGE_ENV = 'SUPERLIORA_SANDBOX_IMAGE';

export function isProcessSandboxDisabled(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = env[SUPERLIORA_NO_PROCESS_SANDBOX_ENV]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function posixJoin(base: string, rel: string): string {
  if (rel.length === 0 || rel === '.') return base;
  const trimmed = rel.replaceAll('\\', '/').replace(/^\.?\//, '');
  return `${base.replace(/\/$/, '')}/${trimmed}`;
}

function hostPathFlavor(path: string): typeof posix {
  return win32.isAbsolute(path) && !path.startsWith('/') ? win32 : posix;
}

function normalizedHostPath(path: string): string {
  return hostPathFlavor(path).normalize(path).replaceAll('\\', '/').replace(/\/$/, '');
}

function relativeUnder(child: string, parent: string): string | undefined {
  const nc = normalizedHostPath(child);
  const np = normalizedHostPath(parent);
  const windows = hostPathFlavor(parent) === win32;
  const a = windows ? nc.toLowerCase() : nc;
  const b = windows ? np.toLowerCase() : np;
  if (a === b) return '';
  const prefix = `${b}/`;
  if (!a.startsWith(prefix)) return undefined;
  return nc.slice(prefix.length);
}

function canonicalMountSource(host: string): string {
  const flavor = hostPathFlavor(host);
  const native = process.platform === 'win32' ? flavor === win32 : flavor === posix;
  if (!native) return flavor.normalize(host);
  let prefix = flavor.resolve(host);
  const missing: string[] = [];
  for (;;) {
    try {
      return flavor.join(realpathSync(prefix), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || flavor.dirname(prefix) === prefix) {
        throw new Error('Docker sandbox cannot resolve mount source.', { cause: error });
      }
      missing.unshift(flavor.basename(prefix));
      prefix = flavor.dirname(prefix);
    }
  }
}

/** Match the key selection Node uses for Windows child environments. */
function dockerEnvValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (process.platform !== 'win32') return env[name];
  const key = Object.keys(env).toSorted().find(key => key.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * Resolve once per invocation, not from a cached availability probe. DOCKER_CONTEXT
 * overrides DOCKER_HOST; otherwise an explicit host overrides the current context.
 * Keep the synchronous builder API: inspection uses a 2.5s SIGKILL timeout and
 * a 64KiB output limit. This is not a hard wall-time bound (OS teardown/I/O may
 * delay return). Any inspection/parse failure denies execution.
 */
function effectiveDockerEndpoint(dockerBin: string, env: NodeJS.ProcessEnv): { endpoint: string; socket?: string } {
  const context = dockerEnvValue(env, 'DOCKER_CONTEXT') || undefined;
  let endpoint = context ? undefined : dockerEnvValue(env, 'DOCKER_HOST')?.trim() || undefined;
  if (endpoint === undefined) {
    try {
      const output = execFileSync(dockerBin, ['context', 'inspect', ...(context ? [context] : [])], {
        env, encoding: 'utf8', timeout: 2500, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      const contexts: unknown = JSON.parse(output);
      if (!Array.isArray(contexts) || contexts.length !== 1) throw new Error('Expected one Docker context');
      const host: unknown = contexts[0]?.Endpoints?.docker?.Host;
      if (typeof host !== 'string' || !host.trim()) throw new Error('Missing Docker context endpoint');
      endpoint = host.trim();
    } catch (error) {
      throw new Error('Docker sandbox cannot inspect the effective Docker context.', { cause: error });
    }
  }
  // Remote daemons resolve bind sources on another filesystem, which these local
  // checks cannot validate. Local Windows named pipes are not Unix bind sources.
  if (process.platform === 'win32' && /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint)) {
    return { endpoint };
  }
  try {
    const url = new URL(endpoint);
    const path = decodeURIComponent(url.pathname);
    if (url.protocol !== 'unix:' || url.hostname || url.search || url.hash ||
        !posix.isAbsolute(path) || /[%\u0000-\u0020]/.test(endpoint) || /[\u0000-\u001F]/.test(path)) {
      throw new Error('Expected a local Unix socket endpoint');
    }
    const socket = canonicalMountSource(path);
    if (/[?#%\u0000-\u0020]/.test(socket)) throw new Error('Ambiguous canonical socket endpoint');
    // Pin the inspected endpoint instead of re-reading context metadata at spawn.
    // This does not prevent replacement of the socket or its parent directories.
    return { endpoint: `unix://${socket}`, socket };
  } catch (error) {
    throw new Error('Docker sandbox cannot resolve the effective Docker context / DOCKER_HOST socket; only local endpoints are supported.', { cause: error });
  }
}

/**
 * Best-effort snapshot, NOT an atomic filesystem confinement guarantee. Reject
 * existing nested Unix sockets (including non-Docker sockets); readonly does not
 * make socket access safe. Docker does not dereference nested directory symlinks
 * when mounting a tree, so scan real directories and check symlink file targets.
 * Entry/error limits fail closed rather than silently skipping inaccessible trees.
 * A host writer can still create/replace a socket or swap a mount path after this
 * check and before/during the bind mount. Eliminating that TOCTOU requires trusted,
 * immutable mount sources or an OS-level mount/socket policy, not a JS preflight.
 */
function rejectNestedSockets(source: string): void {
  const flavor = hostPathFlavor(source);
  if ((process.platform === 'win32') !== (flavor === win32)) return;
  let root;
  try {
    root = lstatSync(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; // Docker itself rejects missing bind sources.
    throw new Error('Docker sandbox cannot inspect mount source for sockets.', { cause: error });
  }
  if (root.isSocket()) throw new Error('Docker sandbox cannot mount a host socket.');
  if (!root.isDirectory()) return;
  const pending = [source];
  let entries = 0;
  try {
    while (pending.length > 0) {
      const directory = pending.pop()!;
      for (const name of readdirSync(directory)) {
        if (++entries > 100_000) throw new Error('Mount socket scan entry limit exceeded');
        const path = flavor.join(directory, name);
        const stat = lstatSync(path);
        if (stat.isSocket()) throw new Error('Nested host socket in mount source');
        if (stat.isDirectory()) pending.push(path);
        else if (stat.isSymbolicLink()) {
          try {
            if (statSync(path).isSocket()) throw new Error('Symlink to host socket in mount source');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      }
    }
  } catch (error) {
    throw new Error('Docker sandbox cannot safely inspect mount source: nested socket or socket scan failure.', { cause: error });
  }
}

function dockerBindMount(host: string, container: string, readOnly: boolean, endpointSocket: string | undefined): string {
  const inputFlavor = hostPathFlavor(host);
  if (!inputFlavor.isAbsolute(host) || /[,"\u0000-\u001F]/.test(host)) {
    throw new Error('Docker sandbox mount paths must be absolute and contain no commas, quotes, or control characters.');
  }
  const source = canonicalMountSource(host);
  const flavor = hostPathFlavor(source);
  if (!flavor.isAbsolute(source) || /[,"\u0000-\u001F]/.test(source)) {
    throw new Error('Docker sandbox canonical mount paths must be absolute and contain no commas, quotes, or control characters.');
  }
  try {
    if (statSync(source).isSocket()) throw new Error('Docker sandbox cannot mount a host socket.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const normalized = normalizedHostPath(source);
  const root = normalizedHostPath(flavor.parse(source).root);
  const home = normalizedHostPath(canonicalMountSource(homedir()));
  const comparable = flavor === win32 ? normalized.toLowerCase() : normalized;
  if (comparable === (flavor === win32 ? root.toLowerCase() : root) ||
      relativeUnder(home, source) !== undefined) {
    throw new Error('Docker sandbox cannot mount a filesystem root, the entire operator home, or a parent of the operator home.');
  }
  const socketDirs = ['/var/run', '/run', join(homedir(), '.docker', 'run'), join(homedir(), '.docker', 'desktop'),
    join(homedir(), '.rd'), join(homedir(), '.colima')]
    .map(canonicalMountSource);
  if ((endpointSocket !== undefined && relativeUnder(endpointSocket, source) !== undefined) ||
      flavor.basename(source).toLowerCase() === 'docker.sock' || socketDirs.some(dir =>
    relativeUnder(dir, source) !== undefined || relativeUnder(source, dir) !== undefined)) {
    throw new Error('Docker sandbox cannot mount a Docker daemon socket or a standard socket directory.');
  }
  rejectNestedSockets(source);
  return `type=bind,source=${source},target=${container}${readOnly ? ',readonly' : ''}`;
}

export function mapHostCwdToContainer(
  cwd: string,
  workspaceDir: string,
  additionalDirs: readonly string[] = [],
): string | undefined {
  const inWs = relativeUnder(cwd, workspaceDir);
  if (inWs !== undefined) return posixJoin('/workspace', inWs);
  for (let i = 0; i < additionalDirs.length; i++) {
    const extra = additionalDirs[i];
    if (extra === undefined) continue;
    const rel = relativeUnder(cwd, extra);
    if (rel !== undefined) return posixJoin(`/extra${String(i)}`, rel);
  }
  return undefined;
}

function isBashLike(file: string): boolean {
  const base = file.replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? file.toLowerCase();
  return base === 'bash' || base === 'bash.exe' || base === 'sh' || base === 'sh.exe';
}

/** Parse only a literal shell word: never evaluate expansions or shell syntax. */
function literalCd(script: string): { target: string; rest: string } | undefined {
  const start = /^\s*cd\s+/.exec(script);
  if (start === null) return undefined;
  let i = start[0].length;
  let target = '';
  let sawWord = false;
  while (i < script.length && !/\s/.test(script[i]!)) {
    // `&&` ends the word even without preceding whitespace (`cd /ws&& pwd`).
    if (script.startsWith('&&', i)) break;
    const char = script[i++]!;
    sawWord = true;
    if (char === "'") {
      const end = script.indexOf("'", i);
      if (end < 0) return undefined;
      target += script.slice(i, end);
      i = end + 1;
    } else if (char === '"') {
      let closed = false;
      while (i < script.length) {
        const part = script[i++]!;
        if (part === '"') { closed = true; break; }
        if (part === '$' || part === '`' || part === '\\') return undefined;
        target += part;
      }
      if (!closed) return undefined;
    } else if (char === '\\') {
      const escaped = script[i++];
      if (escaped === undefined || escaped === '\n' || escaped === '\r') return undefined;
      target += escaped;
    } else {
      if (/[;&|<>()[\]{}*?~$`#]/.test(char)) return undefined;
      target += char;
    }
  }
  if (!sawWord) return undefined;
  const separator = /^\s*&&\s*/.exec(script.slice(i));
  if (separator === null) return undefined;
  const rest = script.slice(i + separator[0].length);
  if (!rest) return undefined;
  return { target, rest };
}

function mapLiteralCdPrefix(script: string, workspaceDir: string, additionalDirs: readonly string[]): string {
  const mappedPrefixes: string[] = [];
  let rest = script;
  for (;;) {
    const literal = literalCd(rest);
    if (literal === undefined || (!posix.isAbsolute(literal.target) && !win32.isAbsolute(literal.target))) break;
    const mapped = mapHostCwdToContainer(
      canonicalMountSource(literal.target), canonicalMountSource(workspaceDir), additionalDirs.map(canonicalMountSource),
    );
    if (mapped === undefined) break;
    mappedPrefixes.push(`cd '${mapped.replaceAll("'", "'\\''")}' && `);
    rest = literal.rest;
  }
  return mappedPrefixes.join('') + rest;
}

export function buildDockerSandboxArgs(opts: {
  readonly workspaceDir: string;
  readonly additionalDirs?: readonly string[];
  readonly cwd: string;
  readonly readOnly?: boolean;
  readonly image?: string;
  readonly command: readonly string[];
  readonly resources?: ProcessSandboxResources;
  readonly dockerBin?: string;
  /** Complete effective Docker client environment, not an overlay on process.env. */
  readonly env?: NodeJS.ProcessEnv;
}): string[] {
  const ro = opts.readOnly === true;
  const image = opts.image?.trim() || DEFAULT_SANDBOX_IMAGE;
  const dockerBin = opts.dockerBin?.trim() || 'docker';
  const additionalDirs = opts.additionalDirs ?? [];
  const { endpoint, socket } = effectiveDockerEndpoint(dockerBin, opts.env ?? process.env);
  const mounts = [dockerBindMount(opts.workspaceDir, '/workspace', ro, socket),
    ...additionalDirs.map((dir, index) => dockerBindMount(dir, `/extra${String(index)}`, ro, socket))];
  const containerCwd = mapHostCwdToContainer(
    canonicalMountSource(opts.cwd), canonicalMountSource(opts.workspaceDir), additionalDirs.map(canonicalMountSource),
  );
  if (containerCwd === undefined) {
    throw new Error('Docker sandbox cwd must be within a mounted directory.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(image)) {
    throw new Error('Invalid Docker sandbox image reference.');
  }

  const memoryMb = resourceLimit(opts.resources?.memoryMb, 1024, 'memoryMb', true);
  const cpus = resourceLimit(opts.resources?.cpus, 2, 'cpus');
  const pidsLimit = resourceLimit(opts.resources?.pidsLimit, 256, 'pidsLimit', true);
  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  const uid = hostUid !== undefined && hostUid > 0 ? hostUid : 1000;
  const gid = hostUid !== undefined && hostUid > 0 && hostGid !== undefined && hostGid > 0 ? hostGid : 1000;
  const args: string[] = [
    dockerBin, '--host', endpoint, 'run', '--rm', '-i',
    '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
    '--read-only', '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777', `--user=${String(uid)}:${String(gid)}`,
    `--memory=${memoryMb}m`, `--memory-swap=${memoryMb}m`, `--cpus=${cpus}`, `--pids-limit=${pidsLimit}`,
  ];
  for (const mount of mounts) args.push('--mount', mount);
  args.push('-w', containerCwd, image);

  const file = opts.command[0];
  const rest = opts.command.slice(1);
  if (file !== undefined && isBashLike(file) && (rest[0] === '-c' || rest[0] === '-lc') && rest[1] !== undefined) {
    args.push('bash', rest[0], mapLiteralCdPrefix(rest[1], opts.workspaceDir, additionalDirs), ...rest.slice(2));
    return args;
  }
  if (file !== undefined && !file.includes('\\') && !/^[A-Za-z]:/.test(file)) {
    args.push(file, ...rest);
    return args;
  }
  // A host-absolute Windows binary cannot run inside the Linux container, and
  // re-joining its argv as `bash -lc` shell text would silently reinterpret
  // arguments as shell syntax. Fail with the reason instead.
  throw new Error(
    `docker process sandbox cannot execute host-absolute binary ${JSON.stringify(file)}; ` +
      'invoke it through a bash-like shell (bash -lc …) or a container-relative path',
  );
}

export async function probeDockerAvailable(
  run: () => Promise<number> = defaultDockerProbe,
): Promise<boolean> {
  try {
    const code = await run();
    return code === 0;
  } catch {
    return false;
  }
}

function defaultDockerProbe(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const done = (code: number | null): void => {
      resolve(code ?? 1);
    };
    const timer = setTimeout(() => {
      child.kill();
      resolve(1);
    }, 2500);
    child.once('error', () => {
      clearTimeout(timer);
      resolve(1);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      done(code);
    });
  });
}

export interface ResolveProcessSandboxBackendResult {
  readonly backend: ProcessSandboxBackend | undefined;
  readonly warning?: string;
}

export async function resolveProcessSandboxBackend(opts: {
  readonly platform?: NodeJS.Platform;
  readonly noProcess?: boolean;
  readonly probeDocker?: () => Promise<boolean>;
}): Promise<ResolveProcessSandboxBackendResult> {
  if (opts.noProcess === true) {
    throw new Error('Process sandbox conflicts with --no-process-sandbox / SUPERLIORA_NO_PROCESS_SANDBOX; explicitly select lexical enforcement for host execution.');
  }
  let dockerOk = false;
  try {
    dockerOk = await (opts.probeDocker ?? (() => probeDockerAvailable()))();
  } catch {
    // A failed availability probe is not permission to run on the host.
  }
  if (dockerOk) return { backend: 'docker' };
  const platform = opts.platform ?? process.platform;
  throw new Error(
    'Process sandbox required but Docker is unavailable. ' +
    (platform === 'win32' ? 'Windows Job Objects are process-tree supervisors, not confinement. ' : '') +
    'Install/start Docker or explicitly select lexical enforcement for host execution.',
  );
}

export interface WrappedLocalExec {
  readonly file: string;
  readonly args: string[];
  /** Docker-only spawn environment; context selection is removed after inspection. */
  readonly env?: NodeJS.ProcessEnv;
  readonly afterSpawn?: (pid: number) => void;
}

export function wrapLocalExecForProcessSandbox(opts: {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly config: ProcessSandboxConfig | undefined;
  /** Complete environment that would otherwise be supplied to spawn. */
  readonly env?: NodeJS.ProcessEnv;
}): WrappedLocalExec {
  const config = opts.config;
  if (config === undefined) {
    return { file: opts.file, args: [...opts.args] };
  }
  if (config.backend === 'docker') {
    // Snapshot once: inspect the actual client environment, then remove only
    // context selection from the run environment. Never mutate the caller's env.
    const env = { ...(opts.env ?? process.env) };
    const argv = buildDockerSandboxArgs({
      env,
      workspaceDir: config.workspaceDir,
      additionalDirs: config.additionalDirs,
      cwd: opts.cwd,
      readOnly: config.readOnly,
      image: config.image ?? process.env[SUPERLIORA_SANDBOX_IMAGE_ENV],
      dockerBin: config.dockerBin,
      resources: config.resources,
      command: [opts.file, ...opts.args],
    });
    const dockerFile = argv[0] ?? 'docker';
    // Explicit --host must not compete with DOCKER_CONTEXT on the run client.
    // Windows environment keys are case-insensitive, unlike JS object keys.
    const runEnv = { ...env };
    for (const key of Object.keys(runEnv)) {
      if (key === 'DOCKER_CONTEXT' || (process.platform === 'win32' && key.toUpperCase() === 'DOCKER_CONTEXT')) {
        delete runEnv[key];
      }
    }
    return { file: dockerFile, args: argv.slice(1), env: runEnv };
  }
  if (config.backend !== 'job') throw new Error('Unsupported process sandbox backend.');
  return {
    file: opts.file,
    args: [...opts.args],
    afterSpawn: (pid) => {
      assignPidToWindowsJob(pid);
    },
  };
}

export function isProcessSandboxHost(
  kaos: unknown,
): kaos is { setProcessSandbox: (config: ProcessSandboxConfig | undefined) => void } {
  return (
    typeof kaos === 'object' &&
    kaos !== null &&
    typeof (kaos as { setProcessSandbox?: unknown }).setProcessSandbox === 'function'
  );
}

export function looksLikeAbsoluteHostBinary(file: string): boolean {
  return isAbsolute(file) || file.includes('\\') || /^[A-Za-z]:/.test(file);
}
