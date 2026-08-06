import { camelToSnake, snakeToCamel } from './toml-keys';
import { cloneObjectValue, cloneRecord, isPlainObject } from './toml-utils';

export function transformTomlData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const targetKey = snakeToCamel(key);

    if (targetKey === 'providers' && isPlainObject(value)) {
      result[targetKey] = transformRecord(value, transformProviderData);
    } else if (targetKey === 'models' && isPlainObject(value)) {
      result[targetKey] = transformRecord(value, transformModelData);
    } else if (targetKey === 'thinking' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'permission' && isPlainObject(value)) {
      result[targetKey] = transformPermissionData(value);
    } else if (targetKey === 'services' && isPlainObject(value)) {
      result[targetKey] = transformRecord(value, transformServiceData, snakeToCamel);
    } else if (targetKey === 'loopControl' && isPlainObject(value)) {
      result[targetKey] = transformLoopControlData(value);
    } else if (targetKey === 'background' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'memory' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'cache' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'research' && isPlainObject(value)) {
      result[targetKey] = transformResearchData(value);
    } else if (targetKey === 'mission' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'modelCatalog' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'browserUse' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'computerUse' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'media' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'mcp' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'extras' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'agent' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'persona' && isPlainObject(value)) {
      result[targetKey] = transformPlainObject(value);
    } else if (targetKey === 'experimental' && isPlainObject(value)) {
      result[targetKey] = cloneRecord(value);
    } else if (!isPlainObject(value)) {
      result[targetKey] = value;
    }
  }
  return result;
}

function transformRecord(
  value: Record<string, unknown>,
  transformEntry: (entry: Record<string, unknown>) => Record<string, unknown>,
  transformName: (name: string) => string = (name) => name,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [entryName, entryConfig] of Object.entries(value)) {
    record[transformName(entryName)] = isPlainObject(entryConfig)
      ? transformEntry(entryConfig)
      : entryConfig;
  }
  return record;
}

function transformPlainObject(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[snakeToCamel(key)] = value;
  }
  return out;
}

function transformProviderData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const targetKey = snakeToCamel(key);
    if (targetKey === 'oauth') {
      out[targetKey] = isPlainObject(value) ? transformPlainObject(value) : value;
    } else if (targetKey === 'oauths' || targetKey === 'credentials') {
      out[targetKey] = Array.isArray(value)
        ? value.map((entry) => (isPlainObject(entry) ? transformPlainObject(entry) : entry))
        : value;
    } else if (targetKey === 'env' || targetKey === 'customHeaders') {
      out[targetKey] = cloneObjectValue(value);
    } else {
      out[targetKey] = value;
    }
  }
  return out;
}

function transformModelData(data: Record<string, unknown>): Record<string, unknown> {
  const out = transformPlainObject(data);
  if (isPlainObject(out['routing'])) {
    out['routing'] = transformPlainObject(out['routing']);
  }
  if (isPlainObject(out['overrides'])) {
    const overrides = transformPlainObject(out['overrides']);
    if (isPlainObject(overrides['routing'])) {
      overrides['routing'] = transformPlainObject(overrides['routing']);
    }
    out['overrides'] = overrides;
  }
  return out;
}

function transformPermissionData(data: Record<string, unknown>): Record<string, unknown> {
  const raw = transformPlainObject(data);
  const out: Record<string, unknown> = {};

  const rules: unknown[] = [];
  appendPermissionRules(rules, raw['rules']);
  appendPermissionRules(rules, raw['deny'], 'deny');
  appendPermissionRules(rules, raw['allow'], 'allow');
  appendPermissionRules(rules, raw['ask'], 'ask');
  if (rules.length > 0) {
    out['rules'] = rules;
  }
  return out;
}

function appendPermissionRules(
  target: unknown[],
  value: unknown,
  decision?: 'allow' | 'deny' | 'ask',
): void {
  if (value === undefined) return;
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    target.push(transformPermissionRule(entry, decision));
  }
}

function transformPermissionRule(value: unknown, decision?: 'allow' | 'deny' | 'ask'): unknown {
  if (!isPlainObject(value)) return value;

  const rule = transformPlainObject(value);
  const tool = rule['tool'];
  const match = rule['match'];
  const pattern = rule['pattern'];
  const out: Record<string, unknown> = {};

  if (decision !== undefined) {
    out['decision'] = decision;
  } else {
    out['decision'] = rule['decision'];
  }
  out['scope'] = rule['scope'];
  out['reason'] = rule['reason'];

  if (typeof tool === 'string') {
    const argPattern = typeof match === 'string' ? match : pattern;
    out['pattern'] = typeof argPattern === 'string' ? `${tool}(${argPattern})` : tool;
  } else {
    out['pattern'] = pattern;
  }

  return out;
}

function transformServiceData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const targetKey = snakeToCamel(key);
    if (targetKey === 'oauth') {
      out[targetKey] = isPlainObject(value) ? transformPlainObject(value) : value;
    } else if (targetKey === 'customHeaders') {
      out[targetKey] = cloneObjectValue(value);
    } else {
      out[targetKey] = value;
    }
  }
  return out;
}

function transformLoopControlData(data: Record<string, unknown>): Record<string, unknown> {
  const out = transformPlainObject(data);
  if (out['maxStepsPerTurn'] === undefined && out['maxStepsPerRun'] !== undefined) {
    out['maxStepsPerTurn'] = out['maxStepsPerRun'];
  }
  delete out['maxStepsPerRun'];
  return out;
}

function transformResearchData(data: Record<string, unknown>): Record<string, unknown> {
  const out = transformPlainObject(data);
  if (isPlainObject(out['localSearch'])) {
    out['localSearch'] = transformResearchLocalSearchData(out['localSearch']);
  }
  if (isPlainObject(out['search'])) {
    out['search'] = transformResearchSearchData(out['search']);
  }
  if (isPlainObject(out['context7'])) {
    out['context7'] = transformPlainObject(out['context7']);
  }
  return out;
}

function transformResearchSearchData(data: Record<string, unknown>): Record<string, unknown> {
  const out = transformPlainObject(data);
  if (Array.isArray(out['providers'])) {
    out['providers'] = out['providers'].map((entry) =>
      isPlainObject(entry) ? transformPlainObject(entry) : entry,
    );
  }
  return out;
}

function transformResearchLocalSearchData(data: Record<string, unknown>): Record<string, unknown> {
  const out = transformPlainObject(data);
  if (isPlainObject(out['directSources'])) {
    out['directSources'] = transformPlainObject(out['directSources']);
  }
  return out;
}
