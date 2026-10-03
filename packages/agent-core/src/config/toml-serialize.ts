import { type LioraConfig, validateConfig } from './schema';
import { camelToSnake, snakeToCamel } from './toml-keys';
import { isRetiredConfigField, transformTomlData } from './toml-transform';
import { cloneUnknown, isPlainObject } from './toml-utils';

/** Serialize native settings while preserving unrelated disk-only configuration. */
export function configToTomlData(config: LioraConfig): Record<string, unknown> {
  const { raw, ...settings } = validateConfig(config);
  const serialized = serializeObject(settings);
  return raw === undefined ? serialized : mergeRawFields(raw, serialized, transformTomlData(raw));
}

const OPAQUE_RECORDS: Record<string, true> = {
  env: true, customHeaders: true, source: true, weights: true,
};
const NAMED_RECORDS: Record<string, true> = { providers: true, models: true };

function mergeRawFields(
  raw: Record<string, unknown>,
  serialized: Record<string, unknown>,
  projected: Record<string, unknown>,
  namedEntries = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const nativeKey = Object.hasOwn(projected, key) ? key : snakeToCamel(key);
    const serializedKey = namedEntries ? key : camelToSnake(nativeKey);
    if (!namedEntries && isRetiredConfigField(nativeKey)) continue;
    if (!Object.hasOwn(projected, nativeKey)) {
      out[key] = cloneUnknown(value);
    } else if (
      isPlainObject(value) && isPlainObject(serialized[serializedKey]) &&
      isPlainObject(projected[nativeKey]) && !Object.hasOwn(OPAQUE_RECORDS, nativeKey)
    ) {
      out[serializedKey] = mergeRawFields(
        value, serialized[serializedKey], projected[nativeKey], Object.hasOwn(NAMED_RECORDS, nativeKey),
      );
    }
  }
  for (const [key, value] of Object.entries(serialized)) {
    if (!Object.hasOwn(out, key)) out[key] = value;
  }
  return out;
}

function serializeObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (Object.hasOwn(OPAQUE_RECORDS, key)) {
      out[camelToSnake(key)] = cloneUnknown(entry);
    } else if (Object.hasOwn(NAMED_RECORDS, key) && isPlainObject(entry)) {
      const named: Record<string, unknown> = {};
      for (const [name, config] of Object.entries(entry)) {
        named[name] = serializeValue(config);
      }
      if (Object.keys(named).length > 0) out[camelToSnake(key)] = named;
    } else {
      out[camelToSnake(key)] = serializeValue(entry);
    }
  }
  return out;
}

function serializeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(serializeValue);
  return isPlainObject(value) ? serializeObject(value) : value;
}
