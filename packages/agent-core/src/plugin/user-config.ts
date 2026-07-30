import { isObject } from './paths';
import type { PluginDiagnostic, PluginUserConfigField, PluginUserConfigSchema } from './types';

const FIELD_TYPES = new Set(['string', 'number', 'boolean']);

/**
 * Parse Claude `userConfig` object from plugin.json.
 * Values are persisted separately on {@link PluginCapabilityState.userConfig}.
 */
export function parseUserConfigSchema(
  raw: unknown,
  diagnostics: PluginDiagnostic[],
): PluginUserConfigSchema | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    diagnostics.push({
      severity: 'warn',
      message: '"userConfig" must be an object',
    });
    return undefined;
  }

  const fields: Record<string, PluginUserConfigField> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      diagnostics.push({
        severity: 'warn',
        message: `userConfig key "${key}" is invalid; ignored`,
      });
      continue;
    }
    if (!isObject(value)) {
      diagnostics.push({
        severity: 'warn',
        message: `userConfig.${key} must be an object; ignored`,
      });
      continue;
    }
    const type = typeof value['type'] === 'string' ? value['type'] : 'string';
    if (!FIELD_TYPES.has(type)) {
      diagnostics.push({
        severity: 'warn',
        message: `userConfig.${key} has unsupported type "${type}"; ignored`,
      });
      continue;
    }
    const field: PluginUserConfigField = {
      type: type as PluginUserConfigField['type'],
      title: typeof value['title'] === 'string' ? value['title'] : undefined,
      description: typeof value['description'] === 'string' ? value['description'] : undefined,
      default: value['default'],
      sensitive: value['sensitive'] === true,
      required: value['required'] === true,
    };
    fields[key] = field;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/** Merge schema defaults with persisted values (persisted wins). */
export function resolveUserConfigValues(
  schema: PluginUserConfigSchema | undefined,
  stored: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (schema !== undefined) {
    for (const [key, field] of Object.entries(schema)) {
      if (field.default === undefined || field.default === null) continue;
      out[key] = String(field.default);
    }
  }
  if (stored !== undefined) {
    for (const [key, value] of Object.entries(stored)) {
      out[key] = value;
    }
  }
  return out;
}

/** Env vars Claude plugins expect: `CLAUDE_PLUGIN_OPTION_<KEY>`. */
export function userConfigEnvVars(values: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    out[`CLAUDE_PLUGIN_OPTION_${key}`] = value;
  }
  return out;
}

/** Required userConfig keys still missing after defaults + stored values. */
export function missingRequiredUserConfigKeys(
  schema: PluginUserConfigSchema | undefined,
  stored: Readonly<Record<string, string>> | undefined,
): readonly string[] {
  if (schema === undefined) return [];
  const values = resolveUserConfigValues(schema, stored);
  const missing: string[] = [];
  for (const [key, field] of Object.entries(schema)) {
    if (field.required !== true) continue;
    const value = values[key];
    if (value === undefined || value.trim() === '') missing.push(key);
  }
  return missing;
}
