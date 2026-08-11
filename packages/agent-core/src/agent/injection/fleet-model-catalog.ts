/**
 * Capped fleet model catalog for Conductor — healthy aliases + models.dev
 * scores so the orchestrator can pick worker `model_alias` on JobCreate.
 * Harness ranks and filters; Conductor chooses per Job.
 */

import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '#/profile/main-profile';
import type { LioraConfig } from '../../config';
import { warmModelsDevData, type ModelMetadata } from '../../utils/model-presets';
import { isLiveProbeFailureFresh } from '../routing/live-probe';
import {
  buildLocalModelMetadata,
  isConfigAliasHealthy,
} from '../routing/smart-router';
import { DynamicInjector } from './injector';

export const FLEET_MODEL_CATALOG_VARIANT = 'fleet_model_catalog';
export const FLEET_MODEL_CATALOG_MAX_ROWS = 12;
export const FLEET_MODEL_CATALOG_MAX_CHARS = 2_400;

/** Rank healthy tool-capable aliases for the Conductor fleet card. */
export function selectFleetCatalogRows(
  config: LioraConfig,
  maxRows: number = FLEET_MODEL_CATALOG_MAX_ROWS,
): readonly ModelMetadata[] {
  const defaultAlias = config.defaultModel?.trim() || undefined;
  const rows = buildLocalModelMetadata(config).filter((model) => {
    const alias = model.alias?.trim();
    if (alias === undefined || alias.length === 0) return false;
    if (!isConfigAliasHealthy(config, alias)) return false;
    // Hide aliases with a fresh live-probe failure even before cooldown lands
    // in the route-health store (same process, same Conductor turn).
    if (isLiveProbeFailureFresh(alias)) return false;
    if (model.supportsTools === false) return false;
    return true;
  });
  return [...rows]
    .sort((a, b) => {
      // Session default first when healthy — workers should stick to the user's pick.
      if (defaultAlias !== undefined) {
        const aDef = a.alias === defaultAlias ? 1 : 0;
        const bDef = b.alias === defaultAlias ? 1 : 0;
        if (aDef !== bDef) return bDef - aDef;
      }
      const aq = a.qualityScore ?? a.benchmarkScore ?? 0;
      const bq = b.qualityScore ?? b.benchmarkScore ?? 0;
      if (bq !== aq) return bq - aq;
      const av = a.valueScore ?? 0;
      const bv = b.valueScore ?? 0;
      return bv - av;
    })
    .slice(0, maxRows);
}

export function renderFleetModelCatalog(
  config: LioraConfig,
  maxChars: number = FLEET_MODEL_CATALOG_MAX_CHARS,
): string | undefined {
  const rows = selectFleetCatalogRows(config);
  if (rows.length === 0) return undefined;

  const lines: string[] = [
    '<fleet_model_catalog>',
    'Live-healthy aliases only (credentials + recent probe). Prefer the session default (listed first when healthy). When role models are auto, set JobCreate.model_alias from this list (omit → harness picks by kind/profile). Never invent aliases; never retry an omitted/failed alias until it reappears; JobCreate live-probes the pick.',
    'Hints: explore/research → value; implement/goal-driver → quality; verify → different family from maker when possible; UI/screenshots → vision=yes (multimodal session defaults count).',
    'alias | q | value | $/M_in | tools | vision | ctx | fit',
  ];

  for (const model of rows) {
    const alias = model.alias ?? model.id;
    const q = formatScore(model.qualityScore ?? model.benchmarkScore);
    const value = formatScore(model.valueScore);
    const cost =
      model.inputCostPerM !== undefined ? model.inputCostPerM.toFixed(2) : '?';
    const tools = model.supportsTools === false ? 'no' : 'yes';
    const vision = model.supportsVision === true ? 'yes' : 'no';
    const ctx =
      model.contextWindow !== undefined
        ? `${Math.round(model.contextWindow / 1000)}k`
        : '?';
    const fit = fitHint(model);
    lines.push(
      `${alias} | ${q} | ${value} | ${cost} | ${tools} | ${vision} | ${ctx} | ${fit}`,
    );
  }
  lines.push('</fleet_model_catalog>');

  const text = lines.join('\n');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 20)}\n…[catalog truncated]\n</fleet_model_catalog>`;
}

function formatScore(score: number | undefined): string {
  if (score === undefined || !Number.isFinite(score)) return '?';
  return String(Math.round(score));
}

function fitHint(model: ModelMetadata): string {
  const q = model.qualityScore ?? model.benchmarkScore ?? 0;
  const value = model.valueScore ?? 0;
  if (model.supportsVision === true && q >= 55) return 'ui/impl';
  if (q >= 70) return 'impl/plan';
  if (value >= 40 && q < 70) return 'explore';
  if (q >= 55) return 'verify/impl';
  return 'light';
}

export class FleetModelCatalogInjector extends DynamicInjector {
  protected override readonly injectionVariant = FLEET_MODEL_CATALOG_VARIANT;

  protected override async getInjection(): Promise<string | undefined> {
    if (this.agent.type !== 'main') return undefined;
    if (this.agent.config.profileName !== SOVEREIGN_CONDUCTOR_PROFILE_NAME) {
      return undefined;
    }
    const config = this.agent.runtimeConfig ?? this.agent.kimiConfig;
    if (config === undefined) return undefined;
    await warmModelsDevData().catch(() => {});
    return renderFleetModelCatalog(config);
  }
}
