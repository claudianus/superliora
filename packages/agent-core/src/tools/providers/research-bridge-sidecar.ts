import { spawn, type ChildProcess } from 'node:child_process';

import {
  isResearchBridgeEnabled,
  probeNativeHostLoopback,
  resolveDefaultAgentCoreRoot,
  resolveNativeHostScriptPath,
} from './research-bridge-status';

export const RESEARCH_BRIDGE_SERVE_STARTUP_MS = 3_000;

export interface ResearchBridgeSidecarDeps {
  readonly spawn?: typeof spawn | undefined;
  readonly probeLoopback?: typeof probeNativeHostLoopback | undefined;
  readonly resolveAgentCoreRoot?: (() => string | undefined) | undefined;
  readonly resolveScriptPath?: ((root: string) => string) | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly startupMs?: number | undefined;
}

let sidecarChild: ChildProcess | null = null;
let sidecarSpawnPromise: Promise<boolean> | null = null;

export function getResearchBridgeSidecarPid(): number | undefined {
  return sidecarChild?.pid;
}

export function isResearchBridgeSidecarRunning(): boolean {
  return sidecarChild !== null && !sidecarChild.killed;
}

/** Stops auto-spawned loopback server — wired from runtime cache clear. */
export function disposeResearchBridgeSidecar(): void {
  if (sidecarChild !== null && !sidecarChild.killed) {
    sidecarChild.kill('SIGTERM');
  }
  sidecarChild = null;
  sidecarSpawnPromise = null;
}

/** Test hook — resets module singleton state. */
export function resetResearchBridgeSidecarState(): void {
  disposeResearchBridgeSidecar();
}

/** Probe loopback first; spawn `research-bridge-native-host.mjs --serve` once when env ON and probe fails. */
export async function ensureResearchBridgeSidecar(
  deps: ResearchBridgeSidecarDeps = {},
): Promise<boolean> {
  const env = deps.env ?? process.env;
  if (!isResearchBridgeEnabled(env)) return false;

  const root = deps.resolveAgentCoreRoot?.() ?? resolveDefaultAgentCoreRoot();
  if (root === undefined) return false;
  const scriptPath =
    deps.resolveScriptPath?.(root) ?? resolveNativeHostScriptPath(root);

  const probe = deps.probeLoopback ?? probeNativeHostLoopback;
  if (probe(scriptPath, env).ok) return true;

  if (isResearchBridgeSidecarRunning()) return true;
  if (sidecarSpawnPromise !== null) return sidecarSpawnPromise;

  sidecarSpawnPromise = spawnServeSidecar(scriptPath, env, deps);
  try {
    return await sidecarSpawnPromise;
  } finally {
    sidecarSpawnPromise = null;
  }
}

function spawnServeSidecar(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  deps: ResearchBridgeSidecarDeps,
): Promise<boolean> {
  const spawnFn = deps.spawn ?? spawn;
  const startupMs = deps.startupMs ?? RESEARCH_BRIDGE_SERVE_STARTUP_MS;

  return new Promise((resolve) => {
    const child = spawnFn(process.execPath, [scriptPath, '--serve'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    sidecarChild = child;

    const timeout = setTimeout(() => resolve(false), startupMs);

    const finish = (ok: boolean) => {
      clearTimeout(timeout);
      resolve(ok);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('research-bridge serve ok')) {
        finish(true);
      }
    });

    child.once('error', () => {
      if (sidecarChild === child) sidecarChild = null;
      finish(false);
    });

    child.once('exit', () => {
      if (sidecarChild === child) sidecarChild = null;
      finish(false);
    });
  });
}
