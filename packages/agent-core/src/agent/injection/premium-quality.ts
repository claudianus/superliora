import {
  PREMIUM_QUALITY_EXIT_GUIDANCE,
  PREMIUM_QUALITY_FULL_GUIDANCE,
  PREMIUM_QUALITY_SPARSE_GUIDANCE,
} from '../../premium-quality';
import { DynamicInjector } from './injector';

const PREMIUM_QUALITY_DEDUP_MIN_TURNS = 1;
const PREMIUM_QUALITY_FULL_REFRESH_TURNS = 3;

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
    if (!this.wasActive) {
      this.injectedAt = null;
      this.wasActive = true;
      return PREMIUM_QUALITY_FULL_GUIDANCE;
    }

    const variant = this.getVariant();
    if (variant === null) return undefined;
    return variant === 'full' ? PREMIUM_QUALITY_FULL_GUIDANCE : PREMIUM_QUALITY_SPARSE_GUIDANCE;
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
      if (msg.role === 'user') {
        return 'full';
      }
    }
    if (assistantTurnsSince >= PREMIUM_QUALITY_FULL_REFRESH_TURNS) return 'full';
    if (assistantTurnsSince >= PREMIUM_QUALITY_DEDUP_MIN_TURNS) return 'sparse';
    return null;
  }
}
