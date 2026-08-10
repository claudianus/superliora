/**
 * Conductor media readiness — whether implement/goal-driver Jobs can register
 * GenerateImage / GenerateVideo from machine keys. Always injects on Conductor
 * so briefs do not promise draw when tools will be absent from the worker schema.
 */

import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '#/profile/main-profile';
import { isGenerateImageAvailable } from '../../tools/builtin/media/generate-image';
import { isGenerateVideoAvailable } from '../../tools/builtin/media/generate-video';
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
}

/** Pure availability from a resolved media env (tests + injector). */
export function mediaReadinessFromEnv(env: MediaProviderEnv): MediaReadinessSnapshot {
  return {
    image: isGenerateImageAvailable(env),
    video: isGenerateVideoAvailable(env),
  };
}

export function renderMediaReadiness(snapshot: MediaReadinessSnapshot): string {
  const image = snapshot.image ? 'ready' : 'missing';
  const video = snapshot.video ? 'ready' : 'missing';
  const lines = [
    '<media_readiness>',
    `Implement/goal-driver workers: GenerateImage=${image}; GenerateVideo=${video}.`,
  ];
  if (snapshot.image || snapshot.video) {
    lines.push(
      'When ready: put asset needs in JobCreate success_criteria (subjects, style seed, workspace paths); do not claim the harness cannot draw.',
    );
  }
  if (!snapshot.image || !snapshot.video) {
    lines.push(
      'When missing: do not brief native Generate* as guaranteed. AskUserQuestion for keys, or degrade (placeholder / SearchSkill imagen). Keys: QWEN_TOKEN_PLAN_API_KEY|ALIBABA_TOKEN_PLAN_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY|GEMINI_API_KEY (video also uses those + xAI when enabled).',
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
