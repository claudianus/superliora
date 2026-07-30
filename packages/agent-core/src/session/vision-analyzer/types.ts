/**
 * Shared types for the vision analyzer fallback.
 *
 * When the current chat model cannot consume attached images/videos, the
 * analyzer renders them into text with a vision-capable model from the same
 * catalog so the non-vision model still receives the information.
 */
import type { ModelCapability } from '@superliora/kosong';

import type { Agent } from '../../agent';
import type { ProviderManager } from '../provider/provider-manager';

/** What happens when the current chat model cannot consume attached media. */
export type NonVisionFallbackPolicy = 'analyze' | 'path' | 'block';

export const DEFAULT_NON_VISION_FALLBACK: NonVisionFallbackPolicy = 'analyze';

export type MediaKind = 'image' | 'video';

/**
 * One-shot dependencies, mirroring the response-language LLM detector: the
 * caller owns the Agent generate entry point and provider selection context.
 */
export interface VisionAnalyzerDeps {
  readonly generate: Agent['generate'];
  readonly providerManager: ProviderManager;
  /** Alias of the current chat model; used to prefer its provider. */
  readonly currentModelAlias?: string | undefined;
  /** Capabilities of the current chat model. */
  readonly currentCapabilities?: ModelCapability | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface AnalyzeMediaResult {
  /** Replacement text for the media part. */
  readonly text: string;
  readonly analyzerModel: string;
  readonly providerId: string;
}
