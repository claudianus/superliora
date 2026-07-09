import type { Agent } from '..';
import type { SwarmRoutingResult } from './ultra-swarm-routing';

export interface UltraSwarmEngageGateData {
  readonly planPath?: string;
  readonly reason?: string;
  readonly routing?: SwarmRoutingResult;
}

export class UltraSwarmEngageGate {
  private active: UltraSwarmEngageGateData | undefined;

  constructor(private readonly agent: Agent) {}

  get isActive(): boolean {
    return this.active !== undefined;
  }

  data(): UltraSwarmEngageGateData | undefined {
    return this.active;
  }

  engage(input: UltraSwarmEngageGateData): void {
    this.agent.records.logRecord({
      type: 'ultra_swarm_engage_gate.set',
      ...input,
    });
    this.restoreEngage(input);
  }

  clear(reason?: string): void {
    if (!this.isActive) return;
    this.agent.records.logRecord({
      type: 'ultra_swarm_engage_gate.clear',
      reason,
    });
    this.restoreClear();
  }

  restoreEngage(input: UltraSwarmEngageGateData): void {
    this.active = input;
  }

  restoreClear(): void {
    this.active = undefined;
  }
}
