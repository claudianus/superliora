import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Primary Ch5 gate — operator opts into Chrome extension research bridge. */
export const CHROME_RESEARCH_BRIDGE_ENV = 'SUPERLIORA_CHROME_RESEARCH_BRIDGE';
/** Legacy alias kept for early stubs / docs. */
export const CHROME_EXT_BRIDGE_ENV = 'SUPERLIORA_CHROME_EXT_BRIDGE';
export const CHROME_EXT_URL_ENV = 'SUPERLIORA_CHROME_EXT_URL';
export const DEFAULT_CHROME_EXT_BRIDGE_URL = 'http://127.0.0.1:32123/search';

export const NATIVE_HOST_ID = 'com.superliora.research_bridge';
export const NATIVE_HOST_SCRIPT_REL = 'scripts/research-bridge-native-host.mjs';
export const NATIVE_HOST_SMOKE_TIMEOUT_MS = 1_500;
export const NATIVE_HOST_SMOKE_CACHE_TTL_MS = 30_000;
export const NATIVE_HOST_SMOKE_SKIP_ENV = 'SUPERLIORA_RESEARCH_BRIDGE_SKIP_SMOKE';

export type ResearchBridgeHandshake =
  | 'off'
  | 'env-gated'
  | 'manifest-present'
  | 'host-script-ready'
  | 'smoke-verified';

export interface NativeHostSmokeProbe {
  readonly ok: boolean;
  readonly version?: string | undefined;
  readonly error?: string | undefined;
  readonly probedAt: number;
}

export interface ResearchBridgeNativeHostStatus {
  readonly handshake: ResearchBridgeHandshake;
  readonly manifestPath?: string | undefined;
  readonly hostScriptPath?: string | undefined;
  readonly smoke?: NativeHostSmokeProbe | undefined;
}

export interface ResearchBridgeStatus {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly bridgeUrl?: string | undefined;
  readonly nativeHost: ResearchBridgeNativeHostStatus;
  readonly hint?: string | undefined;
}

export interface BuildResearchBridgeStatusOptions {
  readonly configured?: boolean | undefined;
  readonly agentCoreRoot?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** When false, skip `--smoke` spawn and keep file-probe handshake only. */
  readonly probeSmoke?: boolean | undefined;
  readonly smokeDeps?: NativeHostSmokeDeps | undefined;
}

export interface NativeHostSmokeDeps {
  readonly spawnSync?: typeof spawnSync | undefined;
  readonly now?: (() => number) | undefined;
}

interface SmokeCacheEntry {
  readonly key: string;
  readonly probe: NativeHostSmokeProbe;
}

let nativeHostSmokeCache: SmokeCacheEntry | null = null;

/** Clears module smoke cache — test hook only. */
export function clearResearchBridgeSmokeCache(): void {
  nativeHostSmokeCache = null;
}

function smokeCacheKey(scriptPath: string, env: NodeJS.ProcessEnv): string {
  const bridgeUrl = env[CHROME_EXT_URL_ENV]?.trim() ?? '';
  const skip = env[NATIVE_HOST_SMOKE_SKIP_ENV] === '1' ? '1' : '0';
  return `${scriptPath}:${bridgeUrl}:${skip}`;
}

function readCachedSmokeProbe(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  now: number,
): NativeHostSmokeProbe | undefined {
  const cached = nativeHostSmokeCache;
  if (cached === null) return undefined;
  if (cached.key !== smokeCacheKey(scriptPath, env)) return undefined;
  if (now - cached.probe.probedAt > NATIVE_HOST_SMOKE_CACHE_TTL_MS) return undefined;
  return cached.probe;
}

function storeSmokeProbeCache(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  probe: NativeHostSmokeProbe,
): void {
  nativeHostSmokeCache = { key: smokeCacheKey(scriptPath, env), probe };
}

function parseSmokeStdout(stdout: string): string | undefined {
  const match = stdout.match(/research-bridge-native-host smoke ok \(([^)]+)\)/);
  return match?.[1];
}

/** Runs native-host `--smoke` once (sync, short timeout). Injectable for tests. */
export function probeNativeHostSmoke(
  scriptPath: string,
  env: NodeJS.ProcessEnv = process.env,
  deps: NativeHostSmokeDeps = {},
): NativeHostSmokeProbe {
  const now = deps.now ?? Date.now;
  const probedAt = now();
  const cached = readCachedSmokeProbe(scriptPath, env, probedAt);
  if (cached !== undefined) return cached;

  const spawn = deps.spawnSync ?? spawnSync;
  const result: SpawnSyncReturns<string> = spawn(process.execPath, [scriptPath, '--smoke'], {
    env,
    encoding: 'utf8',
    timeout: NATIVE_HOST_SMOKE_TIMEOUT_MS,
  });

  let probe: NativeHostSmokeProbe;
  if (result.error !== undefined) {
    probe = {
      ok: false,
      error: result.error.message,
      probedAt,
    };
  } else if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? '?'}`;
    probe = {
      ok: false,
      error: detail,
      probedAt,
    };
  } else {
    const stdout = result.stdout ?? '';
    const version = parseSmokeStdout(stdout);
    if (!stdout.includes('research-bridge-native-host smoke ok')) {
      probe = {
        ok: false,
        error: stdout.trim() || 'unexpected smoke output',
        probedAt,
      };
    } else {
      probe = {
        ok: true,
        version,
        probedAt,
      };
    }
  }

  storeSmokeProbeCache(scriptPath, env, probe);
  return probe;
}

function shouldProbeNativeHostSmoke(env: NodeJS.ProcessEnv, probeSmoke: boolean | undefined): boolean {
  if (probeSmoke === false) return false;
  if (env[NATIVE_HOST_SMOKE_SKIP_ENV] === '1') return false;
  return isResearchBridgeEnabled(env);
}

function chromeNativeMessagingHostsDir(): string {
  switch (process.platform) {
    case 'darwin':
      return join(
        homedir(),
        'Library/Application Support/Google/Chrome/NativeMessagingHosts',
      );
    case 'win32':
      return join(
        process.env['LOCALAPPDATA'] ?? homedir(),
        'Google/Chrome/User Data/NativeMessagingHosts',
      );
    default:
      return join(homedir(), '.config/google-chrome/NativeMessagingHosts');
  }
}

export function resolveNativeHostManifestPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST']?.trim();
  if (override !== undefined && override.length > 0) return override;
  return join(chromeNativeMessagingHostsDir(), `${NATIVE_HOST_ID}.json`);
}

export function resolveNativeHostScriptPath(agentCoreRoot: string): string {
  return join(agentCoreRoot, NATIVE_HOST_SCRIPT_REL);
}

/** Best-effort agent-core package root for default smoke probing. */
export function resolveDefaultAgentCoreRoot(): string | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, '../../..');
  } catch {
    return undefined;
  }
}

/** True when either primary or legacy Ch5 env gate is set. */
export function isResearchBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CHROME_RESEARCH_BRIDGE_ENV] === '1' || env[CHROME_EXT_BRIDGE_ENV] === '1';
}

export function resolveResearchBridgeUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[CHROME_EXT_URL_ENV]?.trim();
  return configured !== undefined && configured.length > 0
    ? configured
    : DEFAULT_CHROME_EXT_BRIDGE_URL;
}

function detectNativeHostHandshake(
  env: NodeJS.ProcessEnv,
  agentCoreRoot: string | undefined,
  options: Pick<BuildResearchBridgeStatusOptions, 'probeSmoke' | 'smokeDeps'> = {},
): ResearchBridgeNativeHostStatus {
  if (!isResearchBridgeEnabled(env)) {
    return { handshake: 'off' };
  }

  const manifestPath = resolveNativeHostManifestPath(env);
  if (!existsSync(manifestPath)) {
    return { handshake: 'env-gated', manifestPath };
  }

  let hostScriptPath: string | undefined;
  if (agentCoreRoot !== undefined) {
    hostScriptPath = resolveNativeHostScriptPath(agentCoreRoot);
    if (existsSync(hostScriptPath)) {
      if (shouldProbeNativeHostSmoke(env, options.probeSmoke)) {
        const smoke = probeNativeHostSmoke(hostScriptPath, env, options.smokeDeps);
        if (smoke.ok) {
          return { handshake: 'smoke-verified', manifestPath, hostScriptPath, smoke };
        }
        return { handshake: 'host-script-ready', manifestPath, hostScriptPath, smoke };
      }
      return { handshake: 'host-script-ready', manifestPath, hostScriptPath };
    }
  }

  return { handshake: 'manifest-present', manifestPath, hostScriptPath };
}

function handshakeHint(
  nativeHost: ResearchBridgeNativeHostStatus,
  bridgeUrl: string | undefined,
): string {
  switch (nativeHost.handshake) {
    case 'smoke-verified':
      return (
        `Ch5 bridge ON — native host smoke verified` +
        (nativeHost.smoke?.version !== undefined ? ` (${nativeHost.smoke.version})` : '') +
        ` · loopback ${bridgeUrl ?? DEFAULT_CHROME_EXT_BRIDGE_URL}.`
      );
    case 'host-script-ready':
      if (nativeHost.smoke !== undefined && !nativeHost.smoke.ok) {
        return (
          `Ch5 bridge ON — native host script present but smoke failed` +
          (nativeHost.smoke.error !== undefined ? `: ${nativeHost.smoke.error}` : '') +
          ` · check ${NATIVE_HOST_SCRIPT_REL} --smoke.`
        );
      }
      return (
        `Ch5 bridge ON — native host manifest + stub script ready · loopback ${bridgeUrl ?? DEFAULT_CHROME_EXT_BRIDGE_URL}.`
      );
    case 'manifest-present':
      return (
        `Ch5 bridge ON — native messaging manifest found · verify host path in ${nativeHost.manifestPath}.`
      );
    case 'env-gated':
      return (
        `Ch5 bridge env ON — install native host manifest (${NATIVE_HOST_ID}.json) and SuperLiora extension; ` +
        `run ${NATIVE_HOST_SCRIPT_REL} --write-manifest for a local stub.`
      );
    default:
      return researchBridgeCh5Tip();
  }
}

/** Operator-facing one-liner for Settings / never-empty hints. */
export function researchBridgeCh5Tip(): string {
  return (
    `Ch5 bridge: ${CHROME_RESEARCH_BRIDGE_ENV}=1 (or legacy ${CHROME_EXT_BRIDGE_ENV}=1) · ` +
    `optional ${CHROME_EXT_URL_ENV} (default ${DEFAULT_CHROME_EXT_BRIDGE_URL}) · ` +
    `Chrome native-messaging host ${NATIVE_HOST_ID} + SuperLiora extension (localhost POST or stdio handshake).`
  );
}

/** Snapshot for engine status / TUI — env gate + soft native-host handshake. */
export function buildResearchBridgeStatus(
  options: BuildResearchBridgeStatusOptions = {},
): ResearchBridgeStatus {
  const env = options.env ?? process.env;
  const configured = options.configured ?? true;
  const enabled = isResearchBridgeEnabled(env);
  const bridgeUrl = enabled ? resolveResearchBridgeUrl(env) : undefined;
  const agentCoreRoot = options.agentCoreRoot ?? resolveDefaultAgentCoreRoot();
  const nativeHost = detectNativeHostHandshake(env, agentCoreRoot, {
    probeSmoke: options.probeSmoke,
    smokeDeps: options.smokeDeps,
  });
  const ready = configured && enabled && (bridgeUrl?.trim().length ?? 0) > 0;

  if (!configured) {
    return {
      configured: false,
      enabled: false,
      ready: false,
      nativeHost: { handshake: 'off' },
    };
  }
  if (!enabled) {
    return {
      configured: true,
      enabled: false,
      ready: false,
      nativeHost: { handshake: 'off' },
      hint: researchBridgeCh5Tip(),
    };
  }

  return {
    configured: true,
    enabled: true,
    ready,
    bridgeUrl,
    nativeHost,
    hint: handshakeHint(nativeHost, bridgeUrl),
  };
}

export function formatResearchBridgeHandshakeLine(
  nativeHost: ResearchBridgeNativeHostStatus,
): string {
  switch (nativeHost.handshake) {
    case 'smoke-verified':
      return nativeHost.smoke?.version !== undefined
        ? `Native host: smoke verified (${nativeHost.smoke.version})`
        : 'Native host: smoke verified';
    case 'host-script-ready':
      if (nativeHost.smoke !== undefined && !nativeHost.smoke.ok) {
        return 'Native host: script ready (smoke failed)';
      }
      return 'Native host: ready (manifest + stub script)';
    case 'manifest-present':
      return 'Native host: manifest present (script unverified)';
    case 'env-gated':
      return 'Native host: env-gated (manifest not installed)';
    default:
      return 'Native host: off';
  }
}
