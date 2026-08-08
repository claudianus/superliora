/**
 * UI / visual-surface classification for Premium density, Job PQ force-ON,
 * and MergeJob visual proof gates.
 */

import type { PremiumInjectionDensity } from './guidance';

export interface ObjectiveProfile {
  readonly premiumDensity: PremiumInjectionDensity;
  readonly visualSurface: boolean;
}

const UI_OBJECTIVE_PATTERN =
  /\b(ui|ux|css|scss|html|landing|dashboard|frontend|front-end|hero|visual|design|stylesheet|tailwind|component|webpage|web\s*page|website|web\s*app|marketing\s*page|game\s*ui|canvas|screenshot|pixel|typography|layout|bento|awwwards|figma)\b/i;

/** Path fragments that imply a user-visible surface change. */
const UI_PATH_PATTERN =
  /(?:^|\/)(?:components?|pages?|views?|layouts?|styles?|public|assets|static|app|src\/app|apps\/[^/]+\/(?:src\/)?(?:app|pages|components|styles)|game|games|canvas)\b|\.(?:css|scss|sass|less|html|vue|svelte|astro)$|(?:^|\/)(?:page|layout|template|globals?|game)\.(?:tsx?|jsx?|css|scss)$/i;

export function pathsLookLikeUi(paths: readonly string[] | undefined | null): boolean {
  if (paths === undefined || paths === null || paths.length === 0) return false;
  return paths.some((path) => UI_PATH_PATTERN.test(path.replace(/\\/g, '/')));
}

/** Heuristic objective → profile (no LLM). */
export function classifyObjectiveProfile(
  objective: string | undefined | null,
  paths?: readonly string[] | undefined | null,
): ObjectiveProfile {
  const text = objective?.trim() ?? '';
  if (pathsLookLikeUi(paths) || (text.length > 0 && UI_OBJECTIVE_PATTERN.test(text))) {
    return { premiumDensity: 'visual', visualSurface: true };
  }
  if (text.length === 0) {
    return { premiumDensity: 'visual', visualSurface: true };
  }
  return { premiumDensity: 'code', visualSurface: false };
}

/** True when a Conductor Job brief/paths look like UI work (PQ force-ON). */
export function jobLooksLikeUiSurface(input: {
  readonly title?: string | undefined;
  readonly prompt?: string | undefined;
  readonly goalObjective?: string | undefined;
  readonly contextPaths?: readonly string[] | undefined;
  readonly ownershipPaths?: readonly string[] | undefined;
}): boolean {
  const blob = [input.title, input.prompt, input.goalObjective].filter(Boolean).join('\n');
  return classifyObjectiveProfile(blob, [
    ...(input.contextPaths ?? []),
    ...(input.ownershipPaths ?? []),
  ]).visualSurface;
}

/** Fan-out flags for UI-shaped prompts (Jobs and Agent/Fleet share this). */
export function uiSpawnQualityFlags(input: {
  readonly title?: string | undefined;
  readonly prompt?: string | undefined;
  readonly goalObjective?: string | undefined;
  readonly contextPaths?: readonly string[] | undefined;
  readonly ownershipPaths?: readonly string[] | undefined;
}): { readonly forcePremiumQuality: true; readonly preferVisionModel: true } | undefined {
  if (!jobLooksLikeUiSurface(input)) return undefined;
  return { forcePremiumQuality: true, preferVisionModel: true };
}
