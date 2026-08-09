/**
 * Cheap rule-based turn signals for smart model routing.
 * No LLM classifier — sync heuristics only.
 */

import type { ModelRole } from '../../utils/model-presets';

export type RouteIntensity = 'value' | 'balanced' | 'max';

export type TurnSignals = {
  readonly prompt?: string;
  readonly profileName?: string;
  readonly profileBaseName?: string;
  /** True when the worker is expected to stay read-only. */
  readonly readOnly?: boolean;
  /** Recent consecutive tool failures in this turn / spawn. */
  readonly recentToolFailures?: number;
  readonly hasImage?: boolean;
  /** Soft escalate hint from empty patch / thrash. */
  readonly softEscalate?: boolean;
};

export type ClassifiedTurnRouting = {
  readonly role: ModelRole;
  readonly intensity: RouteIntensity;
  readonly reason: string;
};

const DEBUG_RE =
  /\b(debug|stack\s*trace|typeerror|referenceerror|panic|segfault|FAIL(?:ED)?|assert(?:ion)?|traceback)\b/i;
const PLAN_RE =
  /\b(architecture|refactor\s+plan|\bADR\b|설계|아키텍처|design\s+doc|system\s+design)\b/i;
const IMPLEMENT_RE =
  /\b(implement|patch|multi[- ]?file|apply\s+fix|write\s+code|코딩|구현)\b/i;
const EXPLORE_RE = /\b(explore|find\s+where|search\s+code|locate|어디에|찾아)\b/i;

export function escalateIntensity(current: RouteIntensity): RouteIntensity {
  if (current === 'value') return 'balanced';
  if (current === 'balanced') return 'max';
  return 'max';
}

export function classifyTurnRouting(input: {
  readonly roleHint: ModelRole;
  readonly signals: TurnSignals;
  readonly defaultIntensity: RouteIntensity;
}): ClassifiedTurnRouting {
  const prompt = input.signals.prompt ?? '';
  const profile = `${input.signals.profileName ?? ''} ${input.signals.profileBaseName ?? ''}`.toLowerCase();

  if (DEBUG_RE.test(prompt) || profile.includes('debug')) {
    return { role: 'debugging', intensity: 'max', reason: 'debug signal' };
  }
  if (PLAN_RE.test(prompt) || profile.includes('plan') || profile.includes('mission')) {
    return { role: 'planning', intensity: 'max', reason: 'planning signal' };
  }

  if (
    input.signals.readOnly === true ||
    EXPLORE_RE.test(prompt) ||
    profile.includes('explore') ||
    profile.includes('desk')
  ) {
    if (input.roleHint === 'exploration' || EXPLORE_RE.test(prompt) || profile.includes('explore')) {
      return { role: 'exploration', intensity: 'value', reason: 'read-only explore' };
    }
  }

  // Match implement/coder profiles without treating every "code" substring as coding.
  if (
    IMPLEMENT_RE.test(prompt) ||
    profile.includes('implement') ||
    /(^|\s)(coder|code)\b/.test(profile)
  ) {
    const heavy =
      input.signals.softEscalate === true ||
      (input.signals.recentToolFailures ?? 0) >= 2 ||
      /\b(multi[- ]?file|across\s+\d+|여러\s*파일)\b/i.test(prompt);
    return {
      role: 'coding',
      intensity: heavy ? 'max' : input.defaultIntensity === 'value' ? 'balanced' : input.defaultIntensity,
      reason: heavy ? 'heavy coding signal' : 'coding signal',
    };
  }

  if (input.signals.softEscalate === true || (input.signals.recentToolFailures ?? 0) >= 2) {
    return {
      role: input.roleHint,
      intensity: escalateIntensity(input.defaultIntensity),
      reason: 'soft escalate',
    };
  }

  return {
    role: input.roleHint,
    intensity: input.defaultIntensity,
    reason: 'role default',
  };
}

/** Classify a main-session user prompt into a worker-style role. */
export function classifySessionRole(prompt: string | undefined): ModelRole {
  const text = prompt ?? '';
  if (DEBUG_RE.test(text)) return 'debugging';
  if (PLAN_RE.test(text)) return 'planning';
  if (EXPLORE_RE.test(text) && !IMPLEMENT_RE.test(text)) return 'exploration';
  if (IMPLEMENT_RE.test(text)) return 'coding';
  return 'completion';
}
