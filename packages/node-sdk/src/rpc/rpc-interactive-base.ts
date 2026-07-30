/**
 * Interactive-agent scope for `SDKRpcClientBase` — extracted from rpc.ts.
 *
 * Tracks which sub-agent is "active" for prompt/shell/cancel calls that need
 * an `agentId`. Remote transports inherit this as-is; in-process clients use
 * `withInteractiveAgent` when dispatching subagent UI.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { ResolvedCoreAPI } from '#/rpc/rpc-helpers';

const MAIN_AGENT_ID = 'main';

export abstract class SDKRpcClientInteractiveBase {
  private readonly interactiveAgentScope = new AsyncLocalStorage<string>();

  get interactiveAgentId(): string {
    return this.interactiveAgentScope.getStore() ?? MAIN_AGENT_ID;
  }

  withInteractiveAgent<T>(agentId: string, fn: () => T): T {
    return this.interactiveAgentScope.run(agentId, fn);
  }

  protected abstract getRpc(): Promise<ResolvedCoreAPI>;
}
