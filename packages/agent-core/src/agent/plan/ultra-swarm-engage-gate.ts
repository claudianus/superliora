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
    if (input.routing !== undefined) {
      const run = this.agent.ultrawork.getRun();
      if (run !== null) {
        this.agent.emitEvent({
          type: 'ultrawork.routing.decided',
          runId: run.id,
          decision: input.routing.decision,
          intensity: input.routing.intensity,
          estimatedExperts: input.routing.estimatedExperts,
          rationale: input.routing.rationale,
        });
      }
    }
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
