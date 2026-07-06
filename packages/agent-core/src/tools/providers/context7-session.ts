import {
  Context7Error,
  resolveContext7ApiKey,
  SdkContext7Provider,
  type Context7Documentation,
  type Context7LibraryMatch,
  type Context7Provider,
} from './context7';

export class Context7SetupCancelledError extends Error {
  override readonly name = 'Context7SetupCancelledError';
}

export interface Context7ProviderDeps {
  isEnabled(): boolean;
  readApiKey(): string | undefined;
  requestApiKey(input: { toolCallId?: string | undefined }): Promise<string | undefined>;
  persistApiKey?(key: string): Promise<void>;
}

export function isContext7Enabled(config: {
  readonly research?: { readonly context7?: { readonly enabled?: boolean | undefined } | undefined };
}): boolean {
  return config.research?.context7?.enabled !== false;
}

export function readContext7ApiKeyFromConfig(config: {
  readonly research?: {
    readonly context7?:
      | { readonly apiKey?: string | undefined; readonly apiKeyEnv?: string | undefined }
      | undefined;
  };
}): string | undefined {
  const context7 = config.research?.context7;
  return resolveContext7ApiKey({
    apiKey: context7?.apiKey,
    apiKeyEnv: context7?.apiKeyEnv,
  });
}

export function createContext7Provider(deps: Context7ProviderDeps): Context7Provider | undefined {
  if (!deps.isEnabled()) return undefined;

  let cachedKey: string | undefined;
  let client: SdkContext7Provider | undefined;
  let promptInFlight: Promise<string | undefined> | undefined;

  async function resolveKey(toolCallId?: string): Promise<string | undefined> {
    const existing = cachedKey ?? deps.readApiKey();
    if (existing !== undefined && existing.length > 0) {
      cachedKey = existing;
      return existing;
    }

    if (promptInFlight !== undefined) {
      return promptInFlight;
    }

    promptInFlight = (async () => {
      const key = await deps.requestApiKey({ toolCallId });
      if (key !== undefined && key.length > 0) {
        cachedKey = key;
        if (deps.persistApiKey !== undefined) {
          await deps.persistApiKey(key);
        }
      }
      return key;
    })();

    try {
      return await promptInFlight;
    } finally {
      promptInFlight = undefined;
    }
  }

  async function ensureClient(toolCallId?: string): Promise<SdkContext7Provider> {
    const key = await resolveKey(toolCallId);
    if (key === undefined || key.length === 0) {
      throw new Context7SetupCancelledError(
        'Context7 API key is not configured. Get a free key at https://context7.com/dashboard, then set CONTEXT7_API_KEY or [research.context7] in config.toml.',
      );
    }
    client ??= new SdkContext7Provider({ apiKey: key });
    return client;
  }

  return {
    searchLibrary: async (query, libraryName, options) =>
      (await ensureClient(options?.toolCallId)).searchLibrary(query, libraryName, options),
    searchLibraryText: async (query, libraryName, options) =>
      (await ensureClient(options?.toolCallId)).searchLibraryText(query, libraryName, options),
    getContext: async (query, libraryId, options) =>
      (await ensureClient(options?.toolCallId)).getContext(query, libraryId, options),
    getContextText: async (query, libraryId, options) =>
      (await ensureClient(options?.toolCallId)).getContextText(query, libraryId, options),
  };
}

export function isContext7SetupCancelled(error: unknown): boolean {
  return error instanceof Context7SetupCancelledError;
}

export function context7SetupCancelledMessage(error: unknown): string {
  if (error instanceof Context7SetupCancelledError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export type { Context7Documentation, Context7LibraryMatch, Context7Provider, Context7Error };
