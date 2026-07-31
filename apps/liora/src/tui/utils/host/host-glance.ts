/**
 * Host settings glance — in-process vs remote server runtime (Sovereign Reform §9 / W8).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SDKRpcClient, type LioraHarness } from '@superliora/sdk';

import { CLI_UI_MODE } from '#/constant/app';
import { formatTtftDuration } from '#/utils/usage/debug-timing';

export const SUPERLIORA_SERVER_URL_ENV = 'SUPERLIORA_SERVER_URL';
export const KIMI_SERVER_URL_ENV = 'KIMI_SERVER_URL';

/** Umbrella sovereign reform — mirrors agent-core profile/fleet/mission/repo-index gates. */
export const SOVEREIGN_UMBRELLA_ENV = 'SUPERLIORA_SOVEREIGN';

/** Host settings doc line — SSOT for all soft gates enabled by the umbrella env. */
export const HOST_SOVEREIGN_UMBRELLA_TIP =
  `${SOVEREIGN_UMBRELLA_ENV}=1 — umbrella sovereign reform: core profile default · codemap warm (also default ON — opt-out SUPERLIORA_REPO_INDEX_WARM=0) · fleet+mission dual-emit (WS/RPC only — never journal). Legacy compat aliases hide by product default.`;

export type HostRuntimeMode = 'in-process' | 'server';

export interface HostTtftSample {
  readonly ms: number;
  readonly turnId?: number;
  readonly step?: number;
}

export interface HostGlanceInput {
  readonly runtimeMode: HostRuntimeMode;
  readonly transportLine: string;
  readonly sessionLine?: string;
  readonly configPath: string;
  readonly homeDir: string;
  readonly configuredServerUrl?: string;
  readonly configuredServerSource?: 'SUPERLIORA_SERVER_URL' | 'KIMI_SERVER_URL';
  readonly localServerOrigin?: string;
  readonly uiMode: string;
  /** Last step TTFT from turn.step.completed when stream timing is present. */
  readonly lastStepTtft?: HostTtftSample | null;
  /** True when {@link SOVEREIGN_UMBRELLA_ENV} is set (umbrella sovereign reform active). */
  readonly sovereignUmbrellaActive?: boolean;
  /** Session (live) block — sovereign umbrella gate checklist when umbrella env is on. */
  readonly sessionLiveLines?: readonly string[];
}

const HOST_FUTURE_TIP =
  'Future: config [host] mode (in-process | server URL) · ACP adapter · latency profile.';

/** W8 soft — TTFT Done gate; live timing via SUPERLIORA_DEBUG=1 turn status. */
export const HOST_TTFT_TIP =
  'Future: TTFT p50 in-process vs server path (W8 Done gate) — complete a turn to capture a live sample here.';

/** Live last-step TTFT line for Host settings when turn.step.completed carried timing. */
export function formatHostTtftLine(
  sample: HostTtftSample,
  runtimeMode: HostRuntimeMode,
): string {
  const loc =
    sample.turnId !== undefined && sample.step !== undefined
      ? ` (turn ${String(sample.turnId)} step ${String(sample.step)})`
      : '';
  const pathLabel = runtimeMode === 'in-process' ? 'in-process' : 'server client';
  return `Last TTFT: ${formatTtftDuration(sample.ms)}${loc} · ${pathLabel} path`;
}

interface ServerLockContents {
  readonly pid?: number;
  readonly port?: number;
  readonly host?: string;
}

type HarnessWithRpc = { readonly rpc?: unknown };

function firstNonBlankEnv(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): { readonly key: string; readonly value: string } | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value !== undefined && value.length > 0) {
      return { key, value };
    }
  }
  return undefined;
}

/** Explicit client server URL from env — no e2e default fallback. */
export function resolveHostServerUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { readonly url: string; readonly source: 'SUPERLIORA_SERVER_URL' | 'KIMI_SERVER_URL' } | undefined {
  const canonical = firstNonBlankEnv(env, [SUPERLIORA_SERVER_URL_ENV]);
  if (canonical !== undefined) {
    return { url: canonical.value, source: 'SUPERLIORA_SERVER_URL' };
  }
  const legacy = firstNonBlankEnv(env, [KIMI_SERVER_URL_ENV]);
  if (legacy !== undefined) {
    return { url: legacy.value, source: 'KIMI_SERVER_URL' };
  }
  return undefined;
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  const flag = value?.trim();
  if (flag === undefined || flag.length === 0) return false;
  return flag === '1' || flag.toLowerCase() === 'true';
}

export function isSovereignUmbrellaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvFlag(env[SOVEREIGN_UMBRELLA_ENV]);
}

/** Live status when umbrella env is on — lists enabled soft gates. */
export const HOST_SOVEREIGN_UMBRELLA_ACTIVE_LINE =
  `Sovereign umbrella: ON (${SOVEREIGN_UMBRELLA_ENV}=1) — core · hide-legacy · warm · dual-emit`;

export function formatHostSovereignUmbrellaStatusLine(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return isSovereignUmbrellaEnabled(env) ? HOST_SOVEREIGN_UMBRELLA_ACTIVE_LINE : undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Live local `liora server` daemon from ~/.superliora/server/lock (sync, read-only). */
export function readLocalServerDaemon(
  homeDir: string,
): { readonly origin: string; readonly port: number; readonly pid: number } | undefined {
  const lockPath = join(homeDir, 'server', 'lock');
  if (!existsSync(lockPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as ServerLockContents;
    const pid = parsed.pid;
    const port = parsed.port;
    if (pid === undefined || port === undefined || !Number.isFinite(pid) || !Number.isFinite(port)) {
      return undefined;
    }
    if (!isProcessAlive(pid)) return undefined;
    const bindHost = parsed.host === '0.0.0.0' ? '127.0.0.1' : (parsed.host ?? '127.0.0.1');
    return { origin: `http://${bindHost}:${String(port)}`, port, pid };
  } catch {
    return undefined;
  }
}

/** True when the harness RPC client owns an in-process LioraCore (default TUI path). */
export function isInProcessHarness(harness: LioraHarness): boolean {
  const rpc = (harness as unknown as HarnessWithRpc).rpc;
  return rpc instanceof SDKRpcClient;
}

export function resolveHostRuntimeMode(harness: LioraHarness, env: NodeJS.ProcessEnv): HostRuntimeMode {
  if (isInProcessHarness(harness)) return 'in-process';
  return resolveHostServerUrlFromEnv(env) !== undefined ? 'server' : 'in-process';
}

export function buildHostTransportLine(input: {
  readonly runtimeMode: HostRuntimeMode;
  readonly inProcess: boolean;
  readonly uiMode: string;
  readonly configuredServerUrl?: string;
  readonly configuredServerSource?: 'SUPERLIORA_SERVER_URL' | 'KIMI_SERVER_URL';
}): string {
  if (input.runtimeMode === 'in-process') {
    const envNote =
      input.configuredServerUrl !== undefined && input.configuredServerSource !== undefined
        ? ` · ${input.configuredServerSource}=${input.configuredServerUrl} (not active — restart with remote client when wired)`
        : '';
    return `Transport: SDK in-process RPC · ui_mode=${input.uiMode}${envNote}`;
  }
  const url = input.configuredServerUrl ?? '(unset)';
  return `Transport: remote server client · ${url}`;
}

export function buildHostSettingsLines(input: HostGlanceInput): readonly string[] {
  const modeLine =
    input.runtimeMode === 'in-process'
      ? 'Mode: in-process (local harness — agent-core in this Node process).'
      : `Mode: server client (${input.configuredServerSource ?? 'remote'} → ${input.configuredServerUrl ?? 'unknown'}).`;

  const daemonLine =
    input.localServerOrigin !== undefined
      ? `Local server daemon: ${input.localServerOrigin} (running — separate from this TUI harness).`
      : 'Local server daemon: not running (`liora server run` starts background daemon).';

  const envLine =
    input.configuredServerUrl !== undefined && input.configuredServerSource !== undefined
      ? `Client env: ${input.configuredServerSource}=${input.configuredServerUrl}.`
      : 'Client env: SUPERLIORA_SERVER_URL unset (in-process default).';

  const sessionBlock =
    input.sessionLine !== undefined ? [input.sessionLine, ''] : [];

  const ttftLine =
    input.lastStepTtft !== undefined && input.lastStepTtft !== null
      ? formatHostTtftLine(input.lastStepTtft, input.runtimeMode)
      : null;

  return [
    '── Host (read-only) ──────────────────────────',
    'Agent runtime placement — Sovereign Reform §9 / W8.',
    '',
    ...(input.sessionLiveLines ?? []),
    '── Status ───────────────────────────────────',
    modeLine,
    input.transportLine,
    ...sessionBlock,
    ...(ttftLine !== null ? [ttftLine] : []),
    `Config: ${input.configPath}`,
    `Home: ${input.homeDir}`,
    daemonLine,
    envLine,
    'ACP: not wired in Settings yet (adapter ships with server host slice).',
    '',
    '── Today ────────────────────────────────────',
    '· Default TUI runs in-process — lowest latency, full tool waist',
    '· Remote server + WebSocket API: `liora server` + client env (future picker)',
    '· Latency / cost trade-offs documented in Sovereign Reform §10',
    '',
    '── Enable (future) ──────────────────────────',
    `· ${HOST_SOVEREIGN_UMBRELLA_TIP}`,
    `· ${HOST_FUTURE_TIP}`,
    ...(ttftLine === null ? [`· ${HOST_TTFT_TIP}`] : []),
    '· Bench / Diagnostics will export cache miss dump + trace',
    '',
    'No host switch action here until W8 In-process Host + Latency lands.',
  ];
}

export interface LoadHostGlanceInput {
  readonly harness: LioraHarness;
  readonly env?: NodeJS.ProcessEnv;
  readonly uiMode?: string;
  readonly sessionId?: string;
  readonly workDir?: string;
  readonly lastStepTtft?: HostTtftSample | null;
}

export function loadHostGlance(input: LoadHostGlanceInput): HostGlanceInput {
  const env = input.env ?? process.env;
  const homeDir = input.harness.homeDir;
  const configPath = input.harness.configPath;
  const configured = resolveHostServerUrlFromEnv(env);
  const inProcess = isInProcessHarness(input.harness);
  const runtimeMode = inProcess ? 'in-process' : 'server';
  const localDaemon = readLocalServerDaemon(homeDir);
  const uiMode = input.uiMode ?? CLI_UI_MODE;

  let sessionLine: string | undefined;
  if (input.sessionId !== undefined && input.sessionId.trim().length > 0) {
    const workDir =
      input.workDir !== undefined && input.workDir.trim().length > 0
        ? input.workDir
        : '(unknown workdir)';
    sessionLine = `Session: ${input.sessionId} · ${workDir}`;
  }

  return {
    runtimeMode,
    transportLine: buildHostTransportLine({
      runtimeMode,
      inProcess,
      uiMode,
      configuredServerUrl: configured?.url,
      configuredServerSource: configured?.source,
    }),
    sessionLine,
    configPath,
    homeDir,
    configuredServerUrl: configured?.url,
    configuredServerSource: configured?.source,
    localServerOrigin: localDaemon?.origin,
    uiMode,
    lastStepTtft: input.lastStepTtft ?? null,
    sovereignUmbrellaActive: isSovereignUmbrellaEnabled(env),
  };
}
