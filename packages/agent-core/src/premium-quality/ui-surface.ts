/**
 * Premium density / vision-spawn profile.
 *
 * Harness keys off a declared surface contract or a cached/LLM effect
 * judgment — never title/prompt keywords or path-extension cookbooks.
 * MergeJob / verify-chain proof gates stay on Job.surfaceKind.
 */

import type { PremiumInjectionDensity } from './guidance';

export type ObjectiveSurfaceKind = 'none' | 'web' | 'tui' | 'mixed';

export interface ObjectiveProfile {
  readonly premiumDensity: PremiumInjectionDensity;
  readonly visualSurface: boolean;
}

export const VISUAL_OBJECTIVE_PROFILE: ObjectiveProfile = {
  premiumDensity: 'visual',
  visualSurface: true,
};

export const CODE_OBJECTIVE_PROFILE: ObjectiveProfile = {
  premiumDensity: 'code',
  visualSurface: false,
};

export interface ClassifyObjectiveProfileOptions {
  readonly surfaceKind?: ObjectiveSurfaceKind;
  readonly profile?: ObjectiveProfile;
}

/**
 * Sync resolution only. Declared surface_kind wins.
 * Empty objective → visual (Premium ON, no brief yet).
 * Non-empty without a contract → code (fail closed; do not scan wording).
 */
export function classifyObjectiveProfile(
  objective?: string | null,
  options?: ClassifyObjectiveProfileOptions,
): ObjectiveProfile {
  if (options?.profile !== undefined) return options.profile;
  if (
    options?.surfaceKind === 'web' ||
    options?.surfaceKind === 'tui' ||
    options?.surfaceKind === 'mixed'
  ) {
    return VISUAL_OBJECTIVE_PROFILE;
  }
  if (options?.surfaceKind === 'none') return CODE_OBJECTIVE_PROFILE;
  const text = objective?.trim() ?? '';
  if (text.length === 0) return VISUAL_OBJECTIVE_PROFILE;
  return CODE_OBJECTIVE_PROFILE;
}

/** True when spawn should force Premium + vision. Never invented from wording. */
export function jobLooksLikeUiSurface(input: {
  readonly surfaceKind?: ObjectiveSurfaceKind;
  readonly profile?: ObjectiveProfile;
}): boolean {
  return uiSpawnQualityFlags(input) !== undefined;
}

/** Fan-out flags for a declared or already-judged visual surface. */
export function uiSpawnQualityFlags(input: {
  readonly surfaceKind?: ObjectiveSurfaceKind;
  readonly profile?: ObjectiveProfile;
}): { readonly forcePremiumQuality: true; readonly preferVisionModel: true } | undefined {
  if (input.surfaceKind === 'none') return undefined;
  if (
    input.surfaceKind === 'web' ||
    input.surfaceKind === 'tui' ||
    input.surfaceKind === 'mixed'
  ) {
    return { forcePremiumQuality: true, preferVisionModel: true };
  }
  if (input.profile?.visualSurface === true || input.profile?.premiumDensity === 'visual') {
    return { forcePremiumQuality: true, preferVisionModel: true };
  }
  return undefined;
}
