/**
 * Media fallback settings glance — live policy + model vision posture (SSOT §9.2).
 */

import { resolveConfigPath } from '@superliora/sdk';

import type { AppState } from '#/tui/types';

export type MediaFallbackPolicy = NonNullable<AppState['nonVisionFallbackPolicy']>;

export interface MediaSettingsGlance {
  readonly policy: MediaFallbackPolicy;
  readonly model: string;
  readonly supportsImageIn: boolean;
  readonly supportsVideoIn: boolean;
  readonly fallbackActive: boolean;
  readonly configPath: string;
  readonly configError?: string;
}

const POLICY_LABELS: Record<MediaFallbackPolicy, string> = {
  analyze: 'Analyze with a vision model',
  path: 'Attach path note',
  block: 'Block the send',
};

/** ChoicePicker tip — analyze policy when the chat model lacks vision. */
export const MEDIA_ANALYZE_TIP =
  'analyze — a vision-capable catalog model renders attached media to text before the chat model sees the prompt. Clipboard paste and drag-drop use the same policy at send time.';

/** ChoicePicker tip — path policy keeps the send alive for later vision tools. */
export const MEDIA_PATH_TIP =
  'path — attached media is replaced with a pointer note so the send completes; a vision tool can read the file later. Clipboard paste and drag-drop use the same policy.';

/** ChoicePicker tip — block policy refuses unsupported media at send time. */
export const MEDIA_BLOCK_TIP =
  'block — hard error when image_in or video_in is missing on the active model. Switch to a vision-capable model to skip fallback entirely.';

export function resolveModelVisionSupport(input: {
  readonly model: string;
  readonly availableModels: AppState['availableModels'];
}): { readonly supportsImageIn: boolean; readonly supportsVideoIn: boolean } {
  const capabilities = input.availableModels[input.model]?.capabilities;
  if (capabilities === undefined) {
    return { supportsImageIn: true, supportsVideoIn: true };
  }
  return {
    supportsImageIn: capabilities.includes('image_in'),
    supportsVideoIn: capabilities.includes('video_in'),
  };
}

export function loadMediaSettingsGlance(input: {
  readonly policy: MediaFallbackPolicy | undefined;
  readonly model: string;
  readonly availableModels: AppState['availableModels'];
  readonly configPath: string;
  readonly configError?: string;
}): MediaSettingsGlance {
  const vision = resolveModelVisionSupport({
    model: input.model,
    availableModels: input.availableModels,
  });
  const supportsAll = vision.supportsImageIn && vision.supportsVideoIn;
  return {
    policy: input.policy ?? 'analyze',
    model: input.model,
    supportsImageIn: vision.supportsImageIn,
    supportsVideoIn: vision.supportsVideoIn,
    fallbackActive: !supportsAll,
    configPath: input.configPath,
    configError: input.configError,
  };
}

export function formatMediaPolicyLine(glance: MediaSettingsGlance): string {
  return `Fallback policy: ${glance.policy} — ${POLICY_LABELS[glance.policy]}`;
}

export function formatModelVisionLine(glance: MediaSettingsGlance): string {
  const image = glance.supportsImageIn ? 'yes' : 'no';
  const video = glance.supportsVideoIn ? 'yes' : 'no';
  return `Current model: ${glance.model} · image_in ${image} · video_in ${video}`;
}

export function formatFallbackEffectiveLine(glance: MediaSettingsGlance): string {
  if (!glance.fallbackActive) {
    return 'Effective: native vision — attached media goes to the chat model as-is.';
  }
  if (glance.policy === 'block') {
    return 'Effective: block — prompts with unsupported media are refused at send time.';
  }
  if (glance.policy === 'path') {
    return 'Effective: path note — media replaced with a pointer for later vision tools.';
  }
  return 'Effective: analyze — core picks a vision-capable catalog model before send.';
}

export function buildMediaSettingsLines(glance: MediaSettingsGlance): readonly string[] {
  const configLine =
    glance.configError !== undefined
      ? `Config: (unavailable — ${glance.configError})`
      : `Config: ${glance.configPath} · [media] nonVisionFallback`;

  return [
    '── Media fallback (read-only) ───────────────',
    'Text-only model policy for attached images/videos — §9.2.',
    '',
    '── Session (live) ───────────────────────────',
    formatMediaPolicyLine(glance),
    formatModelVisionLine(glance),
    formatFallbackEffectiveLine(glance),
    configLine,
    '',
    '── Change policy ────────────────────────────',
    '  /media                         picker (analyze · path · block)',
    '  config.toml [media]           nonVisionFallback = analyze | path | block',
    '  /reload                       apply after manual edit',
    '',
    '── Tips ─────────────────────────────────────',
    '· analyze: vision analyzer text is injected before the chat model sees the prompt',
    '· path: keeps send alive; a vision tool can read the attachment later',
    '· block: hard error when image_in/video_in missing on the active model',
    '· Clipboard paste and drag-drop use the same policy at send time',
    '· Switch to a vision-capable model to skip fallback entirely',
  ];
}

export function resolveMediaConfigPath(input: {
  readonly homeDir?: string;
  readonly configPath?: string;
}): string {
  if (input.configPath !== undefined && input.configPath.length > 0) {
    return input.configPath;
  }
  return resolveConfigPath({ homeDir: input.homeDir });
}
