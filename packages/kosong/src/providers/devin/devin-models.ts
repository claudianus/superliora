import { DEVIN_DEFAULT_BASE_URL, devinDiscoveryMetadata } from './devin-identity';
import { decodeDevinUnaryMessage } from './devin-decode';
import {
  type ClientModelConfig,
  DisplayOption,
  GetCliModelConfigsRequestSchema,
  GetCliModelConfigsResponseSchema,
  type Metadata,
  MetadataSchema,
} from './devin-proto.generated';
import { create, toBinary } from './protobuf';

const DEVIN_GET_CLI_MODEL_CONFIGS_PATH = '/exa.api_server_pb.ApiServerService/GetCliModelConfigs';

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 64_000;

/**
 * `DISPLAY_OPTION_INTERNAL_DEFAULT` — display slot for configs the server only
 * reveals to clients that opt in. The vendored descriptor predates display
 * options 6-8, so the `DisplayOption` enum stops at `QUICK_REVIEW` (4); wire
 * display options are plain int32, so the extra values decode faithfully.
 */
const DEVIN_DISPLAY_OPTION_INTERNAL_DEFAULT = 6 as DisplayOption;
/** Unclassified native display slot: requested for parity, never filtered on. */
const DEVIN_DISPLAY_OPTION_UNCLASSIFIED = 7 as DisplayOption;
/** Second visible-model slot, used beside `UNSPECIFIED` (0) for normal models. */
const DEVIN_DISPLAY_OPTION_NORMAL = 8 as DisplayOption;

/** Display slots the native client advertises; asking for the internal slots makes the server return its full catalog. */
const DEVIN_SUPPORTED_MODEL_DISPLAYS: readonly DisplayOption[] = [
  DisplayOption.MODEL_ROUTER,
  DisplayOption.QUICK_REVIEW,
  DEVIN_DISPLAY_OPTION_INTERNAL_DEFAULT,
  DEVIN_DISPLAY_OPTION_UNCLASSIFIED,
  DEVIN_DISPLAY_OPTION_NORMAL,
];

/** Display slots requested but never surfaced: quick-review and internal defaults. */
const DEVIN_INTERNAL_MODEL_DISPLAYS: ReadonlySet<DisplayOption> = new Set([
  DisplayOption.QUICK_REVIEW,
  DEVIN_DISPLAY_OPTION_INTERNAL_DEFAULT,
]);

/**
 * Wire uids whose configs advertise `supports_images` but whose backend
 * silently drops `ChatMessagePrompt.images` (verified live in oh-my-pi, SWE-1.6
 * family). Declaring text-only lets clients use their image fallback path.
 */
const DEVIN_IMAGE_BLIND_UIDS: ReadonlySet<string> = new Set(['swe-1-6', 'swe-1-6-fast']);

/** Best-effort match for labels whose wording implies a thinking / reasoning variant. */
const REASONING_LABEL_PATTERN = /think|thinking|reasoning/i;

/** A Devin model entry normalized for the provider catalog / connect flow. */
export interface DevinDiscoveredModel {
  /** Wire model uid (`swe-1-6`, `adaptive`, …). */
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly reasoning: boolean;
  readonly supportsImages: boolean;
  readonly supportsTools: boolean;
  /**
   * Server-side router (`adaptive`): `GetChatMessage` needs an `AssignModel`
   * round-trip first. The chat provider also keeps a built-in router uid set.
   */
  readonly isRouter: boolean;
}

export interface DevinModelDiscoveryOptions {
  /** Devin session token (`devin-session-token$` prefix is added on the wire). */
  readonly apiKey?: string;
  /** Optional Codeium API base URL override. */
  readonly baseUrl?: string;
  /** Request timeout in milliseconds (default 5000). */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
}

/**
 * Fetch Devin models through the `GetCliModelConfigs` unary Connect RPC and
 * normalize them into catalog entries.
 *
 * Returns `null` on request/decode failures; `[]` only when the endpoint
 * responds successfully with no usable models.
 *
 * Ported from oh-my-pi `packages/catalog/src/discovery/devin.ts`, dropping the
 * effort-variant collapsing machinery (our catalog lists wire uids directly).
 */
export async function fetchDevinModels(
  options: DevinModelDiscoveryOptions,
): Promise<readonly DevinDiscoveredModel[] | null> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const resolvedBaseUrl = stripTrailingSlashes(options.baseUrl ?? DEVIN_DEFAULT_BASE_URL);
  const requestUrl = `${resolvedBaseUrl}${DEVIN_GET_CLI_MODEL_CONFIGS_PATH}`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const fetchImpl = options.fetch ?? fetch;

  const fetchCatalog = async (metadata: Metadata): Promise<DevinDiscoveredModel[] | null> => {
    try {
      const request = create(GetCliModelConfigsRequestSchema, { metadata });
      const response = await fetchImpl(requestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/proto',
          'connect-protocol-version': '1',
          accept: '*/*',
        },
        body: toBinary(GetCliModelConfigsRequestSchema, request),
        signal,
      });
      if (!response.ok) return null;
      const decoded = decodeDevinUnaryMessage(
        GetCliModelConfigsResponseSchema,
        new Uint8Array(await response.arrayBuffer()),
      );
      return decoded ? normalizeDevinModels(decoded.clientModelConfigs) : null;
    } catch {
      return null;
    }
  };

  try {
    const nativeMetadata = create(MetadataSchema, {
      ...devinDiscoveryMetadata(options.apiKey),
      supportedModelDisplays: [...DEVIN_SUPPORTED_MODEL_DISPLAYS],
    });
    const nativeModels = await fetchCatalog(nativeMetadata);
    const nativeIsSeedOnly =
      nativeModels !== null &&
      nativeModels.length > 0 &&
      nativeModels.every((model) => model.id === 'swe-1-6' || model.id === 'swe-1-6-fast');
    if (nativeModels !== null && nativeModels.length > 0 && !nativeIsSeedOnly) {
      return nativeModels;
    }

    // Legacy Windsurf Enterprise seats expose their full credential-scoped
    // roster only to the editor identity and raw windsurf_api_key. Native
    // chisel discovery returns the two-row fallback seed for those seats.
    const legacyMetadata = create(MetadataSchema, {
      apiKey: options.apiKey ?? '',
      ideName: 'windsurf',
      ideVersion: '3.2.23',
      extensionName: 'windsurf',
      extensionVersion: '1.48.2',
      locale: 'en',
    });
    const legacyModels = await fetchCatalog(legacyMetadata);
    const models =
      legacyModels !== null && (nativeModels === null || legacyModels.length > nativeModels.length)
        ? legacyModels
        : nativeModels;
    // An empty-but-200 response is the failure signature of a stale client
    // identity pin — report failure rather than an empty catalog.
    return models === null || models.length === 0 ? null : models;
  } finally {
    clearTimeout(timer);
  }
}

function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.codePointAt(end - 1) === 47) end--;
  return end === url.length ? url : url.slice(0, end);
}

function devinModelSpec(config: ClientModelConfig, uid: string): DevinDiscoveredModel {
  const features = config.modelInfo?.modelFeatures;
  const supportsImages =
    (features !== undefined ? features.supportsImages : config.supportsImages) &&
    !DEVIN_IMAGE_BLIND_UIDS.has(uid);
  const displayOption = config.modelInfo?.displayOption ?? DisplayOption.UNSPECIFIED;
  const isRouter =
    (displayOption === DisplayOption.MODEL_ROUTER || config.modelInfo?.isModelRouter === true) &&
    (config.modelInfo?.harnessUids.length ?? 0) === 0;
  const maxOutputTokens = config.modelInfo?.maxOutputTokens ?? 0;
  const label = config.label.trim();
  return {
    id: uid,
    name: label || uid,
    contextWindow: config.maxTokens > 0 ? config.maxTokens : DEFAULT_CONTEXT_WINDOW,
    maxTokens: maxOutputTokens > 0 ? maxOutputTokens : DEFAULT_MAX_TOKENS,
    reasoning:
      features?.supportsThinking === true ||
      REASONING_LABEL_PATTERN.test(label) ||
      REASONING_LABEL_PATTERN.test(uid),
    supportsImages,
    // Router configs ship no model features — the model they route to decides
    // tool use. Cascade only serves tool-calling models, so absent features
    // mean tools are available.
    supportsTools: features !== undefined ? features.supportsToolCalls : true,
    isRouter,
  };
}

/**
 * Lead chat uid of a Fusion pairing `fusion-<lead>[-fast]-sidekick-<sidekick>`.
 * An exact live lead uid wins; otherwise `-fast` selects the lead's priority
 * lane when listed, then the standard lane. `undefined` for non-pairings,
 * `null` for pairings whose lead is not live (never servable).
 */
function devinFusionLeadUid(
  uid: string,
  liveUids: ReadonlyMap<string, ClientModelConfig>,
): string | null | undefined {
  if (!uid.startsWith('fusion-')) return undefined;
  const cut = uid.indexOf('-sidekick-');
  if (cut <= 'fusion-'.length) return undefined;
  const lead = uid.slice('fusion-'.length, cut);
  if (liveUids.has(lead)) return lead;
  if (lead.endsWith('-fast')) {
    const base = lead.slice(0, -'-fast'.length);
    if (liveUids.has(`${base}-priority`)) return `${base}-priority`;
    if (liveUids.has(base)) return base;
  }
  return null;
}

function normalizeDevinModels(
  configs: readonly ClientModelConfig[],
): DevinDiscoveredModel[] {
  const specs: DevinDiscoveredModel[] = [];
  const seen = new Set<string>();
  const liveConfigs = new Map<string, ClientModelConfig>();
  for (const config of configs) {
    const uid = config.modelUid.trim();
    if (!config.disabled && uid && !liveConfigs.has(uid)) liveConfigs.set(uid, config);
  }

  for (const config of configs) {
    if (config.disabled) continue;
    const displayOption = config.modelInfo?.displayOption ?? DisplayOption.UNSPECIFIED;
    if (DEVIN_INTERNAL_MODEL_DISPLAYS.has(displayOption)) continue;
    const uid = config.modelUid.trim();
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    // Fusion pairings (`fusion-<lead>-sidekick-<sidekick>`) are orchestrated
    // client-side by the native client; the server has no provider for the
    // composite uid, and our catalog cannot express "display X but send lead
    // uid" — so pairings are not listed. The lead model lists on its own.
    if (devinFusionLeadUid(uid, liveConfigs) !== undefined) continue;
    specs.push(devinModelSpec(config, uid));
  }
  return specs.toSorted((a, b) => a.id.localeCompare(b.id));
}
