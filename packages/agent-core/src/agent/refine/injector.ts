/**
 * HarnessInjector — injects refine-produced prompt notes and the subagent
 * roster into context. Change-detected: re-injects only when the harness
 * content hash moved (a refine run applied something) or when compaction
 * dropped the earlier reminder (base-class injectedAt tracking).
 */

import { DynamicInjector } from '../injection/injector';
import type { Agent } from '..';

export class HarnessInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'harness';
  private lastInjectedHash: string | null = null;

  constructor(agent: Agent) {
    super(agent);
  }

  protected override getInjection(): string | undefined {
    const refine = this.agent.refine;
    if (refine === null) return undefined;
    const text = refine.renderPromptInjection();
    if (text === undefined) {
      this.lastInjectedHash = null;
      return undefined;
    }
    const hash = refine.contentHash();
    if (hash === this.lastInjectedHash && this.injectedAt !== null) return undefined;
    this.lastInjectedHash = hash;
    return text;
  }
}
