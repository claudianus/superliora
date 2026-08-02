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
  /** In-process request build portion of TTFT (when stream timing split is present). */
  readonly requestBuildMs?: number;
  /** Upstream API wait portion of TTFT after dispatch. */
  readonly serverFirstTokenMs?: number;
}

/** Max TTFT samples retained for session p50 (W8 latency profile). */
export const HOST_TTFT_WINDOW_MAX = 20;

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
  /** Rolling total-ms samples for session p50 (newest last). */
  readonly lastStepTtftMsWindow?: readonly number[] | null;
  /** True when {@link SOVEREIGN_UMBRELLA_ENV} is set (umbrella sovereign reform active). */
  readonly sovereignUmbrellaActive?: boolean;
  /** Session (live) block — sovereign umbrella gate checklist when umbrella env is on. */
  readonly sessionLiveLines?: readonly string[];
}

export const HOST_FUTURE_TIP =
  'Future: config [host] mode (in-process | server URL) · ACP adapter · latency profile.';

/** W8 soft — shown until at least one TTFT sample is captured this session. */
export const HOST_TTFT_TIP =
  'TTFT p50: complete a turn to capture live samples (api + client split when stream timing is present). Rolling window up to 20 steps.';

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
  const split = formatHostTtftSplit(sample);
  return `Last TTFT: ${formatTtftDuration(sample.ms)}${split}${loc} · ${pathLabel} path`;
}

/** ` (api X + client Y)` when both TTFT split fields are present. */
export function formatHostTtftSplit(sample: HostTtftSample): string {
  const build = sample.requestBuildMs;
  const server = sample.serverFirstTokenMs;
  if (build === undefined || server === undefined) return '';
  return ` (api ${formatTtftDuration(server)} + client ${formatTtftDuration(build)})`;
}

/** Append a TTFT total-ms sample, dropping oldest when over {@link HOST_TTFT_WINDOW_MAX}. */
export function appendHostTtftMsSample(
  window: readonly number[] | null | undefined,
  ms: number,
  max: number = HOST_TTFT_WINDOW_MAX,
): number[] {
  const next = [...(window ?? []), ms];
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}

/** Median of TTFT totals (average of two middle values when even). */
export function computeHostTtftP50Ms(samples: readonly number[]): number | undefined {
  if (samples.length === 0) return undefined;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (lo === undefined || hi === undefined) return undefined;
  return Math.round((lo + hi) / 2);
}

/** Session p50 line — requires ≥1 sample. */
export function formatHostTtftP50Line(
  samples: readonly number[],
  runtimeMode: HostRuntimeMode,
): string | null {
  const p50 = computeHostTtftP50Ms(samples);
  if (p50 === undefined) return null;
  const pathLabel = runtimeMode === 'in-process' ? 'in-process' : 'server client';
  return `TTFT p50: ${formatTtftDuration(p50)} (n=${String(samples.length)}, window≤${String(HOST_TTFT_WINDOW_MAX)}) · ${pathLabel} path`;
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
  const ttftWindow = input.lastStepTtftMsWindow ?? null;
  const ttftP50Line =
    ttftWindow !== null && ttftWindow.length > 0
      ? formatHostTtftP50Line(ttftWindow, input.runtimeMode)
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
    ...(ttftP50Line !== null ? [ttftP50Line] : []),
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
    ...(ttftLine === null && ttftP50Line === null ? [`· ${HOST_TTFT_TIP}`] : []),
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
  readonly lastStepTtftMsWindow?: readonly number[] | null;
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
    lastStepTtftMsWindow: input.lastStepTtftMsWindow ?? null,
    sovereignUmbrellaActive: isSovereignUmbrellaEnabled(env),
  };
}
