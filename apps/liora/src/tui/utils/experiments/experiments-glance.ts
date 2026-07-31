/**
 * Experiments settings glance — live feature flags from config (SSOT §9.2).
 */

import type { ExperimentalFeatureState } from '@superliora/sdk';

export interface ExperimentsCatalogGlance {
  readonly totalCount: number;
  readonly enabledCount: number;
  readonly disabledCount: number;
  readonly configOverrideCount: number;
  readonly envOverrideCount: number;
}

export interface ExperimentsGlanceInput {
  readonly features?: readonly ExperimentalFeatureState[];
  readonly loadError?: string;
}

/** Count ON/OFF and override sources for the live summary line. */
export function summarizeExperimentalFeatures(
  features: readonly ExperimentalFeatureState[],
): ExperimentsCatalogGlance {
  let enabledCount = 0;
  let disabledCount = 0;
  let configOverrideCount = 0;
  let envOverrideCount = 0;

  for (const feature of features) {
    if (feature.enabled) enabledCount += 1;
    else disabledCount += 1;
    if (feature.source === 'config') configOverrideCount += 1;
    if (feature.source === 'env' || feature.source === 'master-env') envOverrideCount += 1;
  }

  return {
    totalCount: features.length,
    enabledCount,
    disabledCount,
    configOverrideCount,
    envOverrideCount,
  };
}

function formatFlagSource(source: ExperimentalFeatureState['source']): string {
  switch (source) {
    case 'config':
      return 'config';
    case 'env':
      return 'env';
    case 'master-env':
      return 'master-env';
    default:
      return 'default';
  }
}

/** Compact per-flag line for the live registry section. */
export function formatExperimentalFeatureLine(feature: ExperimentalFeatureState): string {
  const state = feature.enabled ? 'ON' : 'OFF';
  return `${feature.id} ${state} (${formatFlagSource(feature.source)})`;
}

/** Live summary from harness.getExperimentalFeatures(). */
export function formatExperimentsLiveLine(
  features: readonly ExperimentalFeatureState[],
): string {
  const summary = summarizeExperimentalFeatures(features);
  const overrideNote =
    summary.configOverrideCount > 0
      ? ` · ${String(summary.configOverrideCount)} config override${summary.configOverrideCount === 1 ? '' : 's'}`
      : '';
  return `Live flags: ${String(summary.enabledCount)} ON · ${String(summary.disabledCount)} OFF · ${String(summary.totalCount)} registered${overrideNote}`;
}

export function buildExperimentsSettingsLines(input: ExperimentsGlanceInput): readonly string[] {
  const registryLines =
    input.features === undefined
      ? []
      : [
          '── Live flags (config + env) ────────────────',
          formatExperimentsLiveLine(input.features),
          ...input.features.map((feature) => `· ${formatExperimentalFeatureLine(feature)}`),
          '',
        ];

  const statusLine =
    input.loadError !== undefined
      ? `Feature flags: unavailable (${input.loadError})`
      : input.features === undefined
        ? 'Feature flags: open harness to resolve registry.'
        : formatExperimentsLiveLine(input.features);

  return [
    '── Experiments (read-only) ───────────────────',
    'Kill-switch feature flags — Sovereign Reform §9.2.',
    '',
    ...registryLines,
    '── Status ───────────────────────────────────',
    statusLine,
    '',
    '── Resolution order (tips) ──────────────────',
    '· L1: SUPERLIORA_EXPERIMENTAL_FLAG=1 forces all flags ON (master switch)',
    '· L2: SUPERLIORA_EXPERIMENTAL_<FLAG>=0|1 per-flag env override',
    '· L3: config.toml [experimental] id = true|false',
    '· L4: registry default (most flags ship ON as kill switches)',
    '',
    '── Toggle (manual) ──────────────────────────',
    '· Settings → Harness → Experiments — searchable toggle panel',
    '· Apply persists [experimental] and reloads the active session',
    '· Slash autocomplete hides TUI-surface flags when disabled',
    '',
    'No inline toggles here — use Harness → Experiments.',
  ];
}
