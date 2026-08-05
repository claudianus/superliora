import type { SettingPreset } from './setting-presets';

export type MediaPresetId = 'block' | 'path' | 'analyze';

export interface MediaPresetPatch {
  readonly nonVisionFallback: 'block' | 'path' | 'analyze';
}

export const MEDIA_PRESETS: readonly SettingPreset<MediaPresetId, MediaPresetPatch>[] = [
  {
    id: 'block',
    label: 'Block',
    badge: 'strict',
    description: 'Reject image/video when the chat model is text-only.',
    patch: { nonVisionFallback: 'block' },
  },
  {
    id: 'path',
    label: 'Path only',
    badge: 'safe',
    description: 'Pass file paths without vision analysis.',
    patch: { nonVisionFallback: 'path' },
  },
  {
    id: 'analyze',
    label: 'Analyze fallback',
    badge: 'auto',
    description: 'Use media fallback model to describe attachments.',
    patch: { nonVisionFallback: 'analyze' },
  },
];
