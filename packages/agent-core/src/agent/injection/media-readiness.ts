/**
 * Conductor media readiness — whether implement/goal-driver Jobs can register
 * GenerateImage / GenerateVideo from machine keys. Always injects on Conductor
 * so briefs do not promise draw when tools will be absent from the worker schema.
 */

import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '#/profile/main-profile';
import { listReadyImageGenerationProviders } from '../../tools/builtin/media/generate-image';
import { listReadyVideoGenerationProviders } from '../../tools/builtin/media/generate-video';
import {
  resolveMediaProviderEnv,
  type MediaProviderEnv,
  type MediaProviderEnvSource,
} from '../../tools/builtin/media/provider-env';
import { DynamicInjector } from './injector';

export const MEDIA_READINESS_VARIANT = 'media_readiness';

export interface MediaReadinessSnapshot {
  readonly image: boolean;
  readonly video: boolean;
  /** Ready image backends in auto-route order (empty when missing). */
  readonly imageProviders: readonly string[];
  /** Ready video backends in auto-route order (empty when missing). */
  readonly videoProviders: readonly string[];
}

/** Pure availability from a resolved media env (tests + injector). */
export function mediaReadinessFromEnv(env: MediaProviderEnv): MediaReadinessSnapshot {
  const imageProviders = listReadyImageGenerationProviders(env);
  const videoProviders = listReadyVideoGenerationProviders(env);
  return {
    image: imageProviders.length > 0,
    video: videoProviders.length > 0,
    imageProviders,
    videoProviders,
  };
}

function formatReady(ready: boolean, providers: readonly string[]): string {
  if (!ready) return 'missing';
  return providers.length > 0 ? `ready (${providers.join('|')})` : 'ready';
}

export function renderMediaReadiness(snapshot: MediaReadinessSnapshot): string {
  const image = formatReady(snapshot.image, snapshot.imageProviders);
  const video = formatReady(snapshot.video, snapshot.videoProviders);
  const lines = [
    '<media_readiness>',
    `Implement/goal-driver workers: GenerateImage=${image}; GenerateVideo=${video}.`,
  ];
  if (snapshot.image || snapshot.video) {
    lines.push(
      'When ready: put asset needs in JobCreate success_criteria (subjects, style seed, workspace paths); do not claim the harness cannot draw.',
      'Workers: call GenerateImage/GenerateVideo with provider=auto (or only an id listed above). Do not force qwen/openai/google when that id is absent — the harness falls back, but briefs must not invent keys.',
    );
  }
  if (!snapshot.image || !snapshot.video) {
    lines.push(
      'When missing: do not brief native Generate* as guaranteed. AskUserQuestion for keys, or degrade (placeholder / SearchSkill imagen). Keys: xAI Grok OAuth (/login) or XAI_API_KEY, QWEN_TOKEN_PLAN_API_KEY|ALIBABA_TOKEN_PLAN_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY|GEMINI_API_KEY (video also uses those + xAI when enabled).',
    );
  }
  lines.push('</media_readiness>');
  return lines.join('\n');
}

export function renderMediaReadinessFromSource(source: MediaProviderEnvSource): string {
  return renderMediaReadiness(mediaReadinessFromEnv(resolveMediaProviderEnv(source)));
}

export class MediaReadinessInjector extends DynamicInjector {
  protected override readonly injectionVariant = MEDIA_READINESS_VARIANT;

  protected override getInjection(): string | undefined {
    if (this.agent.type !== 'main') return undefined;
    if (this.agent.config.profileName !== SOVEREIGN_CONDUCTOR_PROFILE_NAME) {
      return undefined;
    }
    return renderMediaReadinessFromSource({
      toolServices: this.agent.toolServices,
      kimiConfig: this.agent.runtimeConfig ?? this.agent.kimiConfig,
    });
  }
}
