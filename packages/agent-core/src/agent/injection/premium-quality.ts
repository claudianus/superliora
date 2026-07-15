import {
  PREMIUM_QUALITY_EXIT_GUIDANCE,
  resolvePremiumInjectionDensity,
  selectPremiumFullGuidance,
  selectPremiumSparseGuidance,
  type PremiumInjectionDensity,
} from '../../premium-quality';
import { isRealUserPromptOrigin } from '../context/types';
import { DynamicInjector } from './injector';
import type { Agent } from '..';

/**
 * Full Premium visual guidance is ~1.5–1.8k tokens after compact hype.
 * Non-visual Ultrawork/Goal objectives use code/evidence density instead.
 * Re-inject full (for the active density) when mode turns on or a real user prompt arrives.
 * Sparse checkpoints keep pressure without blowing the budget.
 */
const PREMIUM_QUALITY_SPARSE_REFRESH_TURNS = 4;

export class PremiumQualityInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'premium_quality';
  private wasActive = false;

  override onContextClear(): void {
    super.onContextClear();
    this.wasActive = this.agent.premiumQuality.isEnabled();
  }

  override getInjection(): string | undefined {
    const isActive = this.agent.premiumQuality.isEnabled();
    if (!isActive) {
      if (!this.wasActive) return undefined;
      this.wasActive = false;
      this.injectedAt = null;
      return PREMIUM_QUALITY_EXIT_GUIDANCE;
    }
    const density = resolveActivePremiumDensity(this.agent);
    if (!this.wasActive) {
      this.injectedAt = null;
      this.wasActive = true;
      return selectPremiumFullGuidance(density);
    }

    const variant = this.getVariant();
    if (variant === null) return undefined;
    return variant === 'full'
      ? selectPremiumFullGuidance(density)
      : selectPremiumSparseGuidance(density);
  }

  private getVariant(): 'full' | 'sparse' | null {
    if (this.injectedAt === null) return 'full';
    const history = this.agent.context.history;
    let assistantTurnsSince = 0;
    for (let i = this.injectedAt + 1; i < history.length; i++) {
      const msg = history[i];
      if (msg === undefined) continue;
      if (msg.role === 'assistant') {
        assistantTurnsSince += 1;
        continue;
      }
      if (msg.role === 'user' && isRealUserPromptOrigin(msg.origin)) {
        return 'full';
      }
    }
    if (assistantTurnsSince >= PREMIUM_QUALITY_SPARSE_REFRESH_TURNS) return 'sparse';
    return null;
  }
}

/** Prefer active goal objective; fall back to Ultrawork run objective. */
export function resolveActivePremiumDensity(agent: Agent): PremiumInjectionDensity {
  const goalObjective = agent.goal?.getGoal?.().goal?.objective;
  const runObjective = agent.ultrawork?.getRun?.()?.objective;
  return resolvePremiumInjectionDensity(goalObjective ?? runObjective);
}
