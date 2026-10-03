/** Native model catalog metadata; no task roles, ranking, or selection policy. */
interface ModelsDevModelEntry {
  readonly inputCostPerM?: number;
  readonly outputCostPerM?: number;
  readonly contextWindow?: number;
  readonly supportsReasoning?: boolean;
  readonly supportsTools?: boolean;
  readonly supportsVision?: boolean;
  readonly supportsVideo?: boolean;
  readonly supportsAudio?: boolean;
  readonly supportsPdf?: boolean;
  readonly family?: string;
  readonly knowledgeCutoff?: string;
}

interface ModelsDevApiData {
  readonly models: ReadonlyMap<string, ModelsDevModelEntry>;
}

interface CatalogModel {
  id?: string;
  family?: string;
  knowledge?: string;
  cost?: { input?: number; output?: number };
  limit?: { context?: number };
  reasoning?: boolean;
  tool_call?: boolean;
  modalities?: { input?: readonly string[] };
}

let cache: Promise<ModelsDevApiData> | undefined;
let resolved: ModelsDevApiData | undefined;

async function fetchCatalog(): Promise<ModelsDevApiData> {
  const models = new Map<string, ModelsDevModelEntry>();
  const signal = AbortSignal.timeout(8_000);
  try {
    const response = await fetch('https://models.dev/api.json', { signal });
    if (!response.ok) return { models };
    const catalog = await response.json() as Record<string, { models?: Record<string, CatalogModel> }>;
    for (const [providerId, provider] of Object.entries(catalog)) {
      for (const [key, model] of Object.entries(provider.models ?? {})) {
        const id = model.id ?? key;
        const inputs = model.modalities?.input;
        const entry: ModelsDevModelEntry = {
          inputCostPerM: model.cost?.input,
          outputCostPerM: model.cost?.output,
          contextWindow: model.limit?.context,
          supportsReasoning: model.reasoning,
          supportsTools: model.tool_call,
          supportsVision: inputs?.includes('image'),
          supportsVideo: inputs?.includes('video'),
          supportsAudio: inputs?.includes('audio'),
          supportsPdf: inputs?.includes('pdf'),
          family: model.family,
          knowledgeCutoff: model.knowledge,
        };
        models.set(`${providerId}/${id}`.toLowerCase(), entry);
        // Bare lookup is metadata convenience only, never an implicit model choice.
        if (!models.has(id.toLowerCase())) models.set(id.toLowerCase(), entry);
      }
    }
  } catch {
    // Optional metadata discovery cannot replace configured model metadata.
  }
  return { models };
}

export function getModelsDevData(): Promise<ModelsDevApiData> {
  cache ??= fetchCatalog().then((data) => { resolved = data; return data; });
  return cache;
}

export function peekModelsDevData(): ModelsDevApiData | undefined { return resolved; }
export async function warmModelsDevData(): Promise<void> { await getModelsDevData(); }

function modelsDevLookupKeys(modelId: string): readonly string[] {
  const raw = modelId.trim().toLowerCase();
  if (raw.length === 0) return [];
  const keys = [raw];
  const slash = raw.lastIndexOf('/');
  if (slash >= 0) keys.push(raw.slice(slash + 1));
  for (const key of keys.slice()) {
    const unprefixed = key.startsWith('cursor-') ? key.slice('cursor-'.length) : key;
    if (unprefixed !== key) keys.push(unprefixed);
    const base = unprefixed.replace(/-fast-(none|low|medium|high|xhigh|max)$/i, '')
      .replace(/-(none|low|medium|high|xhigh|max)-fast$/i, '')
      .replace(/-(none|low|medium|high|xhigh|max)$/i, '').replace(/-fast$/i, '');
    if (base !== unprefixed && base.length > 0) keys.push(base);
  }
  return [...new Set(keys)];
}

export function lookupModelsDevModel(modelId: string): ModelsDevModelEntry | undefined {
  for (const key of modelsDevLookupKeys(modelId)) {
    const entry = resolved?.models.get(key);
    if (entry !== undefined) return entry;
  }
  return undefined;
}

export function clearModelsDevCacheForTests(): void { cache = undefined; resolved = undefined; }
export function setModelsDevDataForTests(data: ModelsDevApiData): void {
  resolved = data;
  cache = Promise.resolve(data);
}
