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

import { persistOriginalImage } from '../../tools/support/image-originals';
import { providerHasAnyCredential } from '../provider/provider-manager';
import type { ProviderManager, ResolvedRuntimeProvider } from '../provider/provider-manager';
import { VISION_ANALYZER_SYSTEM_PROMPT, VISION_ANALYZE_USER_INSTRUCTION } from './prompts';
import type { AnalyzeMediaResult, MediaKind, VisionAnalyzerDeps } from './types';

const ANALYZE_TIMEOUT_MS = 60_000;

export function mediaKind(part: ContentPart): MediaKind | undefined {
  if (part.type === 'image_url') return 'image';
  if (part.type === 'video_url') return 'video';
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
  return kind === 'video' ?  capabilities.video_in :  capabilities.image_in;
}

/**
 * Pick a catalog model that can consume `kind`, whose provider has
 * credentials, preferring the current model's provider. Deterministic:
 * catalog keys are visited in sorted order. Returns undefined when no
 * candidate exists — callers fall back to path-only behavior.
 */
export function selectVisionModel(
  providerManager: ProviderManager,
  options: {
    readonly kind: MediaKind;
    readonly currentModelAlias?: string | undefined;
  },
): ResolvedRuntimeProvider | undefined {
  const config = providerManager.currentConfig();
  const models = config.models ?? {};

  let currentProviderName: string | undefined;
  if (options.currentModelAlias !== undefined) {
    try {
      currentProviderName = providerManager.resolveProviderConfig(
        options.currentModelAlias,
      ).providerName;
    } catch {
      currentProviderName = undefined;
    }
  }

  let first: ResolvedRuntimeProvider | undefined;
  let sameProvider: ResolvedRuntimeProvider | undefined;
  for (const alias of Object.keys(models).toSorted()) {
    let resolved: ResolvedRuntimeProvider;
    try {
      resolved = providerManager.resolveProviderConfig(alias);
    } catch {
      continue;
    }
    if (!hasVisionCapability(resolved, options.kind)) continue;
    const providerConfig = config.providers[resolved.providerName];
    if (providerConfig === undefined || !providerHasAnyCredential(providerConfig)) continue;
    if (
      !sharedCredentialHealthStore.isAvailable(
        resolved.providerName,
        resolved.credentialLabel,
      )
    ) {
      continue;
    }
    first ??= resolved;
    if (
      sameProvider === undefined &&
      currentProviderName !== undefined &&
      resolved.providerName === currentProviderName
    ) {
      sameProvider = resolved;
    }
  }
  return sameProvider ?? first;
}

function hasVisionCapability(
  resolved: ResolvedRuntimeProvider,
  kind: MediaKind,
): boolean {
  const capabilities = resolved.modelCapabilities;
  return kind === 'video'
    ?  capabilities.video_in
    :  capabilities.image_in;
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
 * One-shot analysis of a single media part. Returns undefined when no
 * analyzer model is available or the call fails — callers then emit the
 * path-only note. Never throws.
 */
export async function analyzeMediaPart(
  deps: VisionAnalyzerDeps,
  part: ContentPart,
  options: AnalyzeMediaPartOptions = {},
): Promise<AnalyzeMediaResult | undefined> {
  const kind = mediaKind(part);
  if (kind === undefined) return undefined;

  const selection = selectVisionModel(deps.providerManager, {
    kind,
    currentModelAlias: deps.currentModelAlias,
  });
  if (selection === undefined) return undefined;

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
  let analyzedCount = 0;
  let pathOnlyCount = 0;
  let imageIndex = 0;
  let videoIndex = 0;

  for (const part of parts) {
    const kind = mediaKind(part);
    if (kind === undefined || modelSupportsMediaKind(deps.currentCapabilities, kind)) {
      out.push(part);
      continue;
    }

    const label =
      kind === 'image'
        ? defaultMediaLabel('image', ++imageIndex)
        : defaultMediaLabel('video', ++videoIndex);
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
  }

  return { parts: out, analyzedCount, pathOnlyCount, analyzerModels, analyzedKinds };
}

export function defaultMediaLabel(kind: MediaKind, index: number): string {
  return kind === 'video' ? `video #${index}` : `image #${index}`;
}

export function formatAnalysisText(
  kind: MediaKind,
  analyzerModel: string,
  label: string,
  analysis: string,
  originalPath: string | null,
): string {
  const noun = kind === 'video' ? 'Video' : 'Image';
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
  const noun = kind === 'video' ? 'Video' : 'Image';
  const target = originalPath ?? label;
  return `[${noun} attached but model is text-only: ${target} — analyze with a vision-capable tool]`;
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
