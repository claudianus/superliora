/**
 * Vision analyzer fallback core logic.
 *
 * Renders attached images/videos into text with a vision-capable model from
 * the catalog when the current chat model cannot consume them. Selection is
 * deterministic (same provider as the current model first, then catalog
 * order) and credential-aware; every failure degrades to a path-only note so
 * a prompt is never blocked by the analyzer itself.
 */
import { createProvider, isUnknownCapability } from '@superliora/kosong';
import type { ContentPart, Message } from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';

import { isLiveProbeFailureFresh } from '../../agent/routing/live-probe';
import { sharedModelRouteHealthStore } from '../../agent/routing/model-route-health';
import type { LioraConfig } from '../../config';
import { persistOriginalImage } from '../../tools/support/image-originals';
import { providerHasAnyCredential } from '../provider/provider-manager';
import type { ProviderManager, ResolvedRuntimeProvider } from '../provider/provider-manager';
import { VISION_ANALYZER_SYSTEM_PROMPT, VISION_ANALYZE_USER_INSTRUCTION } from './prompts';
import type { AnalyzeMediaResult, MediaKind, VisionAnalyzerDeps } from './types';

const ANALYZE_TIMEOUT_MS = 60_000;

export function mediaKind(part: ContentPart): MediaKind | undefined {
  if (part.type === 'image_url') return 'image';
  if (part.type === 'video_url') return 'video';
  if (part.type === 'audio_url') return 'audio';
  if (part.type === 'file_url') return 'pdf';
  return undefined;
}

export function isVisionMediaPart(part: ContentPart): boolean {
  return mediaKind(part) !== undefined;
}

/**
 * Fail-open capability check: models with unknown capabilities are treated
 * as vision-capable so we never transform media they might accept.
 */
export function modelSupportsMediaKind(
  capabilities: VisionAnalyzerDeps['currentCapabilities'],
  kind: MediaKind,
): boolean {
  if (capabilities === undefined || isUnknownCapability(capabilities)) return true;
  if (kind === 'video') return capabilities.video_in;
  if (kind === 'audio') return capabilities.audio_in;
  if (kind === 'pdf') return capabilities.pdf_in;
  return capabilities.image_in;
}

/**
 * Pick a catalog model that can consume `kind`, whose provider has
 * credentials, preferring the current model's provider. Deterministic:
 * catalog keys are visited in sorted order.
 *
 * `media.analyzer_models.<kind>` overrides the automatic choice for that
 * kind, and `media.analyzer_fallbacks.<kind>` supplies an ordered fallback
 * list tried between the primary alias and the automatic path. Unusable
 * entries (unknown alias, missing credential, unhealthy route, wrong
 * capability) are silently skipped so a stale entry can never block a
 * prompt. The first usable candidate wins; see
 * `selectVisionModelCandidates` for the full ordered list.
 */
export function selectVisionModel(
  providerManager: ProviderManager,
  options: {
    readonly kind: MediaKind;
    readonly currentModelAlias?: string | undefined;
  },
): ResolvedRuntimeProvider | undefined {
  return selectVisionModelCandidates(providerManager, options)[0];
}

/**
 * Ordered analyzer candidates for a media kind: configured primary alias
 * (`analyzer_models`), then configured fallbacks (`analyzer_fallbacks`),
 * then the current chat model when capable, then the automatic catalog
 * scan (same provider as the current model first). Duplicates are removed;
 * every entry passes capability + selectability checks.
 */
export function selectVisionModelCandidates(
  providerManager: ProviderManager,
  options: {
    readonly kind: MediaKind;
    readonly currentModelAlias?: string | undefined;
  },
): ResolvedRuntimeProvider[] {
  const config = providerManager.currentConfig();
  const models = config.models ?? {};

  const candidates: ResolvedRuntimeProvider[] = [];
  const seen = new Set<string>();
  const pushUsable = (alias: string, resolved: ResolvedRuntimeProvider): void => {
    if (seen.has(alias)) return;
    if (!hasVisionCapability(resolved, options.kind)) return;
    if (!isSelectableVisionAlias(config, alias, resolved)) return;
    seen.add(alias);
    candidates.push(resolved);
  };

  for (const alias of configuredAnalyzerAliases(config, options.kind)) {
    try {
      pushUsable(alias, providerManager.resolveProviderConfig(alias));
    } catch {
      // Unknown alias / unresolvable provider — skip to the next candidate.
    }
  }

  const currentAlias = options.currentModelAlias?.trim() || undefined;
  if (currentAlias !== undefined) {
    try {
      pushUsable(currentAlias, providerManager.resolveProviderConfig(currentAlias));
    } catch {
      // Unresolvable current alias — the catalog scan still runs.
    }
  }

  const scan: { readonly alias: string; readonly resolved: ResolvedRuntimeProvider }[] = [];
  for (const alias of Object.keys(models).toSorted()) {
    if (seen.has(alias)) continue;
    try {
      const resolved = providerManager.resolveProviderConfig(alias);
      if (!hasVisionCapability(resolved, options.kind)) continue;
      if (!isSelectableVisionAlias(config, alias, resolved)) continue;
      scan.push({ alias, resolved });
    } catch {
      continue;
    }
  }
  let currentProviderName: string | undefined;
  if (currentAlias !== undefined) {
    try {
      currentProviderName = providerManager.resolveProviderConfig(currentAlias).providerName;
    } catch {
      currentProviderName = undefined;
    }
  }
  const sameProvider =
    currentProviderName === undefined
      ? undefined
      : scan.find((candidate) => candidate.resolved.providerName === currentProviderName);
  const orderedScan =
    sameProvider === undefined
      ? scan
      : [sameProvider, ...scan.filter((candidate) => candidate !== sameProvider)];
  for (const candidate of orderedScan) {
    pushUsable(candidate.alias, candidate.resolved);
  }
  return candidates;
}

function isSelectableVisionAlias(
  config: LioraConfig,
  alias: string,
  resolved: ResolvedRuntimeProvider,
): boolean {
  if (isLiveProbeFailureFresh(alias)) return false;
  if (!sharedModelRouteHealthStore.isAvailable(alias)) return false;
  const providerConfig = config.providers[resolved.providerName];
  if (providerConfig === undefined || !providerHasAnyCredential(providerConfig)) return false;
  if (
    !sharedCredentialHealthStore.isAvailable(resolved.providerName, resolved.credentialLabel)
  ) {
    return false;
  }
  return true;
}

/** Normalized per-kind analyzer override; empty/whitespace values mean auto. */
function configuredAnalyzerAlias(
  config: LioraConfig,
  kind: MediaKind,
): string | undefined {
  const raw = config.media?.analyzerModels?.[kind];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Primary override first, then the ordered fallback list, deduplicated. */
function configuredAnalyzerAliases(
  config: LioraConfig,
  kind: MediaKind,
): readonly string[] {
  const primary = configuredAnalyzerAlias(config, kind);
  const fallbacks = config.media?.analyzerFallbacks?.[kind] ?? [];
  const out: string[] = primary === undefined ? [] : [primary];
  for (const raw of fallbacks) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function hasVisionCapability(
  resolved: ResolvedRuntimeProvider,
  kind: MediaKind,
): boolean {
  const capabilities = resolved.modelCapabilities;
  if (kind === 'video') return capabilities.video_in;
  if (kind === 'audio') return capabilities.audio_in;
  if (kind === 'pdf') return capabilities.pdf_in;
  return capabilities.image_in;
}

export interface AnalyzeMediaPartOptions {
  /**
   * Already-persisted original path (prompt pipeline persists once and
   * reuses it). When omitted, data-URL bytes are persisted best effort.
   */
  readonly originalPath?: string | null | undefined;
  /** Human label for the media, e.g. `image #1` or a file name. */
  readonly label?: string | undefined;
  /** Directory for best-effort original persistence when no path is given. */
  readonly originalsDir?: string | undefined;
}

/**
 * One-shot analysis of a single media part. Tries the ordered analyzer
 * candidates in turn (configured aliases, then the automatic path) until
 * one succeeds; returns undefined when no analyzer model is available or
 * every call fails — callers then emit the path-only note. Never throws.
 */
export async function analyzeMediaPart(
  deps: VisionAnalyzerDeps,
  part: ContentPart,
  options: AnalyzeMediaPartOptions = {},
): Promise<AnalyzeMediaResult | undefined> {
  const kind = mediaKind(part);
  if (kind === undefined) return undefined;

  const candidates = selectVisionModelCandidates(deps.providerManager, {
    kind,
    currentModelAlias: deps.currentModelAlias,
  });
  for (const selection of candidates) {
    const analyzed = await analyzeWithProvider(deps, part, selection, kind, options);
    if (analyzed !== undefined) return analyzed;
  }
  return undefined;
}

/** Single analyzer attempt; undefined on provider failure or empty reply. */
async function analyzeWithProvider(
  deps: VisionAnalyzerDeps,
  part: ContentPart,
  selection: ResolvedRuntimeProvider,
  kind: MediaKind,
  options: AnalyzeMediaPartOptions,
): Promise<AnalyzeMediaResult | undefined> {
  try {
    const provider = createProvider(selection.provider);
    const message: Message = {
      role: 'user',
      content: [part, { type: 'text', text: VISION_ANALYZE_USER_INSTRUCTION }],
      toolCalls: [],
    };
    const response = await deps.generate(
      provider,
      VISION_ANALYZER_SYSTEM_PROMPT,
      [],
      [message],
      undefined,
      // runtimeModelAlias is read by the Agent generate wrapper (auth/routing
      // for the analyzer model); the raw kosong options type does not list it.
      {
        signal: analyzeSignal(deps.signal),
        runtimeModelAlias: selection.modelAlias,
      } as Parameters<VisionAnalyzerDeps['generate']>[5],
    );
    const analysis = extractTextFromGenerateResponse(response).trim();
    if (analysis.length === 0) return undefined;

    const originalPath =
      options.originalPath !== undefined
        ? options.originalPath
        : await persistOriginalPart(part, options.originalsDir);
    const label = options.label ?? defaultMediaLabel(kind, 1);
    return {
      text: formatAnalysisText(kind, selection.modelAlias, label, analysis, originalPath),
      analyzerModel: selection.modelAlias,
      providerId: selection.providerName,
    };
  } catch {
    return undefined;
  }
}

export interface TransformMediaOptions {
  readonly policy: 'analyze' | 'path';
  /** Session-owned originals dir; see sessionMediaOriginalsDir(). */
  readonly originalsDir?: string | undefined;
}

export interface TransformMediaResult {
  readonly parts: ContentPart[];
  /** Media parts replaced by analyzer text. */
  readonly analyzedCount: number;
  /** Media parts replaced by a path-only note (no analyzer or failure). */
  readonly pathOnlyCount: number;
  /** Media kinds degraded to path-only notes, in first-use order. */
  readonly pathOnlyKinds: readonly MediaKind[];
  /** Analyzer model aliases actually used, in first-use order. */
  readonly analyzerModels: readonly string[];
  /** Media kinds actually analyzed, in first-use order. */
  readonly analyzedKinds: readonly MediaKind[];
}

/**
 * Replace media parts the current model cannot consume with text. Parts the
 * current model supports pass through untouched (fail-open for unknown
 * capabilities). `policy: 'block'` is handled by callers, which refuse the
 * whole prompt before reaching this transform.
 */
export async function transformMediaForNonVisionModel(
  deps: VisionAnalyzerDeps,
  parts: readonly ContentPart[],
  options: TransformMediaOptions,
): Promise<TransformMediaResult> {
  const out: ContentPart[] = [];
  const analyzerModels: string[] = [];
  const analyzedKinds: MediaKind[] = [];
  const pathOnlyKinds: MediaKind[] = [];
  let analyzedCount = 0;
  let pathOnlyCount = 0;
  const kindIndexes: Record<MediaKind, number> = { image: 0, video: 0, audio: 0, pdf: 0 };

  for (const part of parts) {
    const kind = mediaKind(part);
    if (kind === undefined || modelSupportsMediaKind(deps.currentCapabilities, kind)) {
      out.push(part);
      continue;
    }

    const label = defaultMediaLabel(kind, ++kindIndexes[kind]);
    const originalPath = await persistOriginalPart(part, options.originalsDir);

    if (options.policy === 'analyze') {
      const analyzed = await analyzeMediaPart(deps, part, { originalPath, label });
      if (analyzed !== undefined) {
        out.push({ type: 'text', text: analyzed.text });
        analyzedCount += 1;
        if (!analyzerModels.includes(analyzed.analyzerModel)) {
          analyzerModels.push(analyzed.analyzerModel);
        }
        if (!analyzedKinds.includes(kind)) {
          analyzedKinds.push(kind);
        }
        continue;
      }
    }
    out.push({ type: 'text', text: pathOnlyText(kind, label, originalPath) });
    pathOnlyCount += 1;
    if (!pathOnlyKinds.includes(kind)) {
      pathOnlyKinds.push(kind);
    }
  }

  return {
    parts: out,
    analyzedCount,
    pathOnlyCount,
    pathOnlyKinds,
    analyzerModels,
    analyzedKinds,
  };
}

export function defaultMediaLabel(kind: MediaKind, index: number): string {
  if (kind === 'video') return `video #${index}`;
  if (kind === 'audio') return `audio #${index}`;
  if (kind === 'pdf') return `pdf #${index}`;
  return `image #${index}`;
}

export function formatAnalysisText(
  kind: MediaKind,
  analyzerModel: string,
  label: string,
  analysis: string,
  originalPath: string | null,
): string {
  const noun =
    kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'pdf' ? 'PDF' : 'Image';
  const lines = [`[${noun} analysis — ${analyzerModel} (${label})]`, analysis];
  if (originalPath !== null) {
    lines.push(`[Original: ${originalPath}]`);
  }
  return lines.join('\n');
}

export function pathOnlyText(
  kind: MediaKind,
  label: string,
  originalPath: string | null,
): string {
  const noun =
    kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'pdf' ? 'PDF' : 'Image';
  const target = originalPath ?? label;
  return `[${noun} attached but model cannot read it directly: ${target} — analyze with a capable tool]`;
}

function analyzeSignal(outer: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(ANALYZE_TIMEOUT_MS);
  return outer === undefined ? timeout : AbortSignal.any([outer, timeout]);
}

/** Persist data-URL bytes best effort; http(s) URLs have no local bytes. */
async function persistOriginalPart(
  part: ContentPart,
  originalsDir: string | undefined,
): Promise<string | null> {
  const url = mediaUrl(part);
  if (url === undefined || !url.startsWith('data:')) return null;
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/u.exec(url);
  if (match === null) return null;
  const mimeType = match[1] ?? 'application/octet-stream';
  const payload = match[3] ?? '';
  let bytes: Uint8Array;
  try {
    bytes =
      match[2] !== undefined
        ? Buffer.from(payload, 'base64')
        : Buffer.from(decodeURIComponent(payload), 'utf8');
  } catch {
    return null;
  }
  return persistOriginalImage(bytes, mimeType, originalsDir === undefined ? {} : { dir: originalsDir });
}

function mediaUrl(part: ContentPart): string | undefined {
  if (part.type === 'image_url') return part.imageUrl.url;
  if (part.type === 'video_url') return part.videoUrl.url;
  if (part.type === 'audio_url') return part.audioUrl.url;
  if (part.type === 'file_url') return part.fileUrl.url;
  return undefined;
}

function extractTextFromGenerateResponse(response: unknown): string {
  const msg = response as {
    message?: {
      content?: ReadonlyArray<{ type?: string; text?: string }>;
    };
  };
  const parts = msg.message?.content ?? [];
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text);
  }
  return texts.join('\n');
}
