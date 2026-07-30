import { readFile } from 'node:fs/promises';

import type { LioraConfigPatch, PermissionRule } from '../config/schema';
import { isObject } from './paths';
import type { PluginDiagnostic, PluginManifest } from './types';

/**
 * Safe Claude `settings.json` keys applied as an in-memory session overlay.
 * Never writes `config.toml`. Providers/API keys/defaultModel are rejected.
 */
const REJECTED_TOP_LEVEL = new Set([
  'providers',
  'models',
  'defaultModel',
  'apiKey',
  'oauth',
  'services',
]);

/** Subset of LoopControl keys safe for plugin overlays. */
const ALLOWED_LOOP_CONTROL_KEYS = new Set([
  'maxStepsPerTurn',
  'maxRetriesPerStep',
  'maxRalphIterations',
  'reservedContextSize',
  'compactionTriggerRatio',
  'compactionAsyncTriggerRatio',
  'compactionBlockRatio',
  'compactionTriggerTokens',
  'maxWorkingSetTokens',
  'asyncWorkingSetTokens',
  'compactionMaxRecentMessages',
  'compactionModel',
  'completionModel',
  'explorationModel',
  'codingModel',
  'planningModel',
  'debuggingModel',
]);

export interface PluginSettingsOverlay {
  readonly patch: LioraConfigPatch;
  readonly env: Readonly<Record<string, string>>;
  readonly diagnostics: readonly PluginDiagnostic[];
}

export async function loadPluginSettingsOverlay(
  settingsPath: string,
): Promise<PluginSettingsOverlay> {
  const diagnostics: PluginDiagnostic[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(settingsPath, 'utf8')) as unknown;
  } catch (error) {
    return {
      patch: {},
      env: {},
      diagnostics: [
        {
          severity: 'warn',
          message: `Failed to parse settings.json: ${(error as Error).message}`,
        },
      ],
    };
  }
  if (!isObject(raw)) {
    return {
      patch: {},
      env: {},
      diagnostics: [{ severity: 'warn', message: 'settings.json must be a JSON object' }],
    };
  }

  for (const key of Object.keys(raw)) {
    if (REJECTED_TOP_LEVEL.has(key)) {
      diagnostics.push({
        severity: 'info',
        message: `settings.json "${key}" is ignored (not applied to session overlay)`,
      });
    }
  }

  const patch: LioraConfigPatch = {};
  const env: Record<string, string> = {};

  if (isObject(raw['env'])) {
    for (const [key, value] of Object.entries(raw['env'])) {
      if (typeof value === 'string') env[key] = value;
    }
  }

  const permissionRules = readPermissionRules(raw['permissions'] ?? raw['permission'], diagnostics);
  if (permissionRules !== undefined) {
    patch.permission = { rules: permissionRules };
  }

  if (isObject(raw['loopControl'])) {
    const loop: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw['loopControl'])) {
      if (!ALLOWED_LOOP_CONTROL_KEYS.has(key)) {
        diagnostics.push({
          severity: 'info',
          message: `settings.json loopControl.${key} is ignored`,
        });
        continue;
      }
      if (typeof value === 'number' && Number.isFinite(value)) loop[key] = value;
      if (typeof value === 'string' && value.trim() !== '') loop[key] = value;
    }
    if (Object.keys(loop).length > 0) {
      patch.loopControl = loop as LioraConfigPatch['loopControl'];
    }
  }

  if (typeof raw['telemetry'] === 'boolean') {
    patch.telemetry = raw['telemetry'];
  }

  return { patch, env, diagnostics };
}

/** Merge overlays from enabled plugin manifests (later packages append rules). */
export async function mergeEnabledSettingsOverlays(
  manifests: readonly PluginManifest[],
): Promise<PluginSettingsOverlay> {
  let patch: LioraConfigPatch = {};
  const env: Record<string, string> = {};
  const diagnostics: PluginDiagnostic[] = [];
  const rules: PermissionRule[] = [];

  for (const manifest of manifests) {
    if (manifest.settingsPath === undefined) continue;
    const next = await loadPluginSettingsOverlay(manifest.settingsPath);
    diagnostics.push(...next.diagnostics);
    const { permission: _permission, ...rest } = next.patch;
    patch = { ...patch, ...rest };
    if (next.patch.permission?.rules !== undefined) {
      rules.push(...next.patch.permission.rules);
    }
    Object.assign(env, next.env);
  }

  if (rules.length > 0) {
    patch = { ...patch, permission: { rules } };
  }

  return { patch, env, diagnostics };
}

function readPermissionRules(
  raw: unknown,
  diagnostics: PluginDiagnostic[],
): PermissionRule[] | undefined {
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw)
    ? raw
    : isObject(raw) && Array.isArray(raw['rules'])
      ? raw['rules']
      : undefined;
  if (list === undefined) {
    diagnostics.push({
      severity: 'info',
      message: 'settings.json permissions must be an array or { rules: [...] }',
    });
    return undefined;
  }
  const out: PermissionRule[] = [];
  for (const entry of list) {
    if (!isObject(entry)) continue;
    const pattern = typeof entry['pattern'] === 'string' ? entry['pattern'] : undefined;
    const decisionRaw = entry['decision'] ?? entry['effect'];
    const decision =
      decisionRaw === 'allow' || decisionRaw === 'deny' || decisionRaw === 'ask'
        ? decisionRaw
        : undefined;
    if (pattern === undefined || decision === undefined) continue;
    out.push({
      pattern,
      decision,
      scope: 'session-runtime',
      reason: typeof entry['reason'] === 'string' ? entry['reason'] : 'plugin settings.json',
    });
  }
  return out.length > 0 ? out : undefined;
}
