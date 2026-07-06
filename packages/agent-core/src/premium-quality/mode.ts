import type { Agent } from '../agent';
import type { AgentRecordOf } from '../agent/records';

export class PremiumQualityMode {
  private enabled = false;

  constructor(private readonly agent: Agent) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.agent.records.logRecord({ type: 'premium-quality.mode', enabled });
    this.agent.emitStatusUpdated();
    this.agent.telemetry.track('premium_quality_toggle', { enabled });
  }

  restoreMode(record: AgentRecordOf<'premium-quality.mode'>): void {
    this.enabled = record.enabled;
  }
}
