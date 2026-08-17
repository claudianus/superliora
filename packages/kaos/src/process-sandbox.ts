/**
 * Optional process-sandbox backends for LocalKaos.exec.
 *
 * Docker (when present) is the filesystem jail: workspace (+ extra dirs)
 * mounted, read-only mounts when requested. Windows Job Object is a
 * process-tree supervisor only — never describe it as a filesystem jail.
 *
 * Failures must not block the host CLI: wrap falls back to a plain spawn.
 */

import { spawn } from 'node:child_process';
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
  /** Injected for tests. */
  readonly dockerBin?: string;
}

export const DEFAULT_SANDBOX_IMAGE = 'bash:5.2';
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

function relativeUnder(child: string, parent: string): string | undefined {
  const nc = child.replaceAll('\\', '/').replace(/\/$/, '');
  const np = parent.replaceAll('\\', '/').replace(/\/$/, '');
  const a = nc.toLowerCase();
  const b = np.toLowerCase();
  if (a === b) return '';
  const prefix = `${b}/`;
  if (!a.startsWith(prefix)) return undefined;
  return nc.slice(prefix.length);
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

function stripCdPrefix(script: string): string {
  const match = /^(?:cd\s+(?:'[^']+'|"[^"]+"|\S+)\s+&&\s+)([\s\S]+)$/.exec(script.trim());
  return match?.[1] ?? script;
}

export function buildDockerSandboxArgs(opts: {
  readonly workspaceDir: string;
  readonly additionalDirs?: readonly string[];
  readonly cwd: string;
  readonly readOnly?: boolean;
  readonly image?: string;
  readonly command: readonly string[];
  readonly dockerBin?: string;
}): string[] {
  const ro = opts.readOnly === true;
  const image = opts.image?.trim() || DEFAULT_SANDBOX_IMAGE;
  const dockerBin = opts.dockerBin?.trim() || 'docker';
  const additionalDirs = opts.additionalDirs ?? [];
  const containerCwd = mapHostCwdToContainer(opts.cwd, opts.workspaceDir, additionalDirs) ?? '/workspace';

  const args: string[] = [dockerBin, 'run', '--rm', '-i'];
  args.push('-v', `${opts.workspaceDir}:/workspace${ro ? ':ro' : ''}`);
  additionalDirs.forEach((dir, index) => {
    args.push('-v', `${dir}:/extra${String(index)}${ro ? ':ro' : ''}`);
  });
  args.push('-w', containerCwd, image);

  const file = opts.command[0];
  const rest = opts.command.slice(1);
  if (file !== undefined && isBashLike(file) && (rest[0] === '-c' || rest[0] === '-lc') && rest[1] !== undefined) {
    args.push('bash', '-lc', stripCdPrefix(rest[1]));
    return args;
  }
  if (file !== undefined && !file.includes('\\') && !/^[A-Za-z]:/.test(file)) {
    args.push(file, ...rest);
    return args;
  }
  args.push('bash', '-lc', rest.length > 0 ? rest.join(' ') : 'true');
  return args;
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
    return { backend: undefined, warning: 'Process sandbox skipped (--no-process-sandbox).' };
  }
  const dockerOk = await (opts.probeDocker ?? (() => probeDockerAvailable()))();
  if (dockerOk) {
    return { backend: 'docker' };
  }
  const platform = opts.platform ?? process.platform;
  if (platform === 'win32') {
    return {
      backend: 'job',
      warning:
        'Docker Desktop not found — using a Windows Job Object for the process tree only. This is not a filesystem jail.',
    };
  }
  return {
    backend: undefined,
    warning: 'Process sandbox unavailable (no Docker). Staying on lexical path guards.',
  };
}

export interface WrappedLocalExec {
  readonly file: string;
  readonly args: string[];
  readonly afterSpawn?: (pid: number) => void;
}

export function wrapLocalExecForProcessSandbox(opts: {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly config: ProcessSandboxConfig | undefined;
}): WrappedLocalExec {
  const config = opts.config;
  if (config === undefined) {
    return { file: opts.file, args: [...opts.args] };
  }
  if (config.backend === 'docker') {
    const argv = buildDockerSandboxArgs({
      workspaceDir: config.workspaceDir,
      additionalDirs: config.additionalDirs,
      cwd: opts.cwd,
      readOnly: config.readOnly,
      image: config.image ?? process.env[SUPERLIORA_SANDBOX_IMAGE_ENV],
      dockerBin: config.dockerBin,
      command: [opts.file, ...opts.args],
    });
    const dockerFile = argv[0] ?? 'docker';
    return { file: dockerFile, args: argv.slice(1) };
  }
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
