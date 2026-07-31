/**
 * Telemetry settings glance — read-only config opt-in + live sink (SSOT §9.2).
 */

import {
  getTelemetryRuntimeGlance,
  isTelemetryDisabledByEnv,
  isTelemetryOptInEnvSet,
  resolveTelemetryEndpoint,
  shouldEnableTelemetry,
  TELEMETRY_DISABLE_ENV,
  TELEMETRY_ENDPOINT_ENV,
  TELEMETRY_OPT_IN_ENV,
} from '@superliora/telemetry';

export interface TelemetryGlanceInput {
  readonly configEnabled: boolean;
  readonly liveEnabled: boolean;
  readonly effectiveEnabled: boolean;
  readonly configPath: string;
  readonly envDisabled: boolean;
  readonly optInEnvSet: boolean;
  readonly endpoint?: string;
  readonly defaultEndpoint: string;
  readonly endpointEnvOverride?: string;
}

export { isTelemetryDisabledByEnv };

export function loadTelemetryGlance(input: {
  readonly configEnabled: boolean;
  readonly configPath: string;
  readonly env?: NodeJS.ProcessEnv;
}): TelemetryGlanceInput {
  const env = input.env ?? process.env;
  const runtime = getTelemetryRuntimeGlance();
  return {
    configEnabled: input.configEnabled,
    liveEnabled: runtime.liveEnabled,
    effectiveEnabled: shouldEnableTelemetry({ enabled: input.configEnabled, env }),
    configPath: input.configPath,
    envDisabled: isTelemetryDisabledByEnv(env),
    optInEnvSet: isTelemetryOptInEnvSet(env),
    endpoint: runtime.endpoint,
    defaultEndpoint: resolveTelemetryEndpoint(env),
    endpointEnvOverride: env[TELEMETRY_ENDPOINT_ENV]?.trim() ?? undefined,
  };
}

export function buildTelemetrySettingsLines(input: TelemetryGlanceInput): readonly string[] {
  const configLine = input.configEnabled
    ? 'Config opt-in: ON (`telemetry = true` in config.toml)'
    : 'Config opt-in: OFF (omit key or `telemetry = false` · ZDR-friendly default)';

  const liveLine = input.liveEnabled
    ? 'Live sink: ON — events batch under home before upload'
    : input.effectiveEnabled
      ? 'Live sink: OFF — restart liora after enabling config opt-in'
      : 'Live sink: OFF — no upload sink attached in this process';

  const effectiveLine =
    input.configEnabled !== input.liveEnabled || input.envDisabled
      ? `Effective: ${input.effectiveEnabled ? 'would enable on restart' : 'forced OFF'}`
      : undefined;

  const envLine = input.envDisabled
    ? `Env: ${TELEMETRY_DISABLE_ENV}=1 — sink forced off regardless of config.`
    : `Env: ${TELEMETRY_DISABLE_ENV} unset — config.toml controls opt-in.`;

  const optInEnvLine = input.optInEnvSet
    ? `Env: ${TELEMETRY_OPT_IN_ENV} set — footer/status opt-in marker (config.toml still SSOT).`
    : `Env: ${TELEMETRY_OPT_IN_ENV} unset — ZDR-friendly default posture.`;

  const endpointLines: string[] = [];
  if (input.liveEnabled && input.endpoint !== undefined) {
    endpointLines.push(`Endpoint (live): ${input.endpoint}`);
  } else if (input.configEnabled && !input.envDisabled) {
    endpointLines.push(`Endpoint (default): ${input.defaultEndpoint}`);
    if (input.endpointEnvOverride !== undefined) {
      endpointLines.push(`Env override: ${TELEMETRY_ENDPOINT_ENV}=${input.endpointEnvOverride}`);
    }
  }

  return [
    '── Telemetry (read-only) ───────────────────',
    'Product usage analytics — opt-in only; local-first by default.',
    '',
    '── Status ───────────────────────────────────',
    configLine,
    liveLine,
    ...(effectiveLine !== undefined ? [effectiveLine] : []),
    `Config: ${input.configPath}`,
    envLine,
    optInEnvLine,
    ...endpointLines,
    '',
    '── Local-only posture ───────────────────────',
    'Default OFF — no usage events leave this machine.',
    'When ON, events batch locally under ~/.superliora before upload.',
    'Session transcripts stay on disk unless you export them.',
    'Device id stays in ~/.superliora for correlation only.',
    '',
    '── Toggle (manual) ──────────────────────────',
    'Edit config.toml: telemetry = true | false',
    'Restart liora after changing telemetry.',
    'Omit the key to keep the ZDR-friendly default (off).',
    '',
    'Related: /context-os report · status panel privacy line.',
  ];
}
