import type { AgentEvent, WorkerAncestry } from '@superliora/protocol';
import type { SDKAgentRPC, SDKSessionRPC } from '../../rpc/sdk-api';
import { proxyWithExtraPayload } from '../../rpc/types';
import type { AgentMeta, SessionOptions } from './session-types';

export function resolveWorkerAncestry(options: Pick<SessionOptions, 'id' | 'role' | 'workerAncestry'>, agents: Record<string, AgentMeta>, agentId: string, fallbackParent?: string | null): WorkerAncestry {
  const sessionId = options.id ?? '';
  const own = agents[agentId];
  const parent = own === undefined ? fallbackParent ?? null : own.parentAgentId;
  const main = options.workerAncestry;
  const base = {
    agentId, sessionId, parentAgentId: parent, parentSessionId: parent === null ? null : sessionId || null,
    rootAgentId: null, rootSessionId: null,
    ...(main?.conductorAgentId === undefined ? {} : { conductorAgentId: main.conductorAgentId }),
    ...(main?.conductorSessionId === undefined ? {} : { conductorSessionId: main.conductorSessionId }),
    ...(main?.coordinationId === undefined ? {} : { coordinationId: main.coordinationId }),
  };
  if (agentId === 'main' && main !== undefined) return { ...main, agentId, sessionId: sessionId || main.sessionId };
  if (!sessionId || (own === undefined && fallbackParent === undefined)) return { ...base, status: 'orphan' };
  const seen = new Set<string>([agentId]);
  let root = agentId;
  let cursor = parent;
  while (cursor !== null) {
    if (seen.has(cursor) || agents[cursor] === undefined) return { ...base, status: 'orphan' };
    seen.add(cursor);
    root = cursor;
    cursor = agents[cursor]!.parentAgentId;
  }
  if (root === 'main' && main !== undefined) return {
    ...base, rootAgentId: main.rootAgentId, rootSessionId: main.rootSessionId,
    status: main.status === 'orphan' ? 'orphan' : 'linked',
  };
  return {
    ...base, rootAgentId: root, rootSessionId: sessionId,
    ...(options.role === 'interactive-conductor' ? { conductorAgentId: root, conductorSessionId: sessionId } : {}),
    status: parent === null ? 'root' : 'linked',
  };
}

export function agentRpcWithAncestry(rpc: SDKSessionRPC, agentId: string, ancestry: (subject: string) => WorkerAncestry): SDKAgentRPC {
  const methods = proxyWithExtraPayload(rpc, { agentId });
  return new Proxy(methods, {
    get(target, property) {
      if (property === 'emitEvent') return (event: AgentEvent) => {
        const subject = 'subagentId' in event ? event.subagentId : agentId;
        return target.emitEvent({ ...event, workerAncestry: ancestry(subject) });
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
