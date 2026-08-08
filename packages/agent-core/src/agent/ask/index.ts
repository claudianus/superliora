import type { Agent } from '..';

/**
 * Ask mode — exploration without execution. Reads, searches, web lookups, and
 * AskUserQuestion stay available; mutations and worker delegation are denied by
 * `AskModeGuardDenyPermissionPolicy`.
 *
 * Ask mode and plan mode are mutually exclusive: plan mode produces a plan
 * artifact and is a step toward doing the work, while ask mode is for deciding
 * whether and what to do at all.
 */
export class AskMode {
  private active = false;

  constructor(private readonly agent: Agent) {}

  get isActive(): boolean {
    return this.active;
  }

  async set(enabled: boolean): Promise<void> {
    if (this.active === enabled) return;
    if (enabled && this.agent.planMode.isActive) {
      this.agent.planMode.cancel();
    }
    this.active = enabled;
    this.agent.emitStatusUpdated();
  }
}
