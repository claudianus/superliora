import type { GlanceFn } from './summary-glances';
import { GLANCE_SAMPLES } from './summary-glances';

export const ultraworkGraphGlance: GlanceFn = (_toolCall, result) => {
  if (/Ultrawork graph is empty/i.test(result.output)) return 'empty graph';
  const updated = /Ultrawork graph updated:\s*(\d+)\s+nodes,\s*(\d+)\s+task events/i.exec(result.output);
  if (updated) return `updated · ${updated[1]} nodes · ${updated[2]} events`;
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /^\s*\[([^\]]+)\]\s+([^:]+):\s+(.+)$/.exec(line);
    if (m) {
      samples.push(`${m[1]} ${m[2]}`);
      if (samples.length >= GLANCE_SAMPLES) break;
    }
  }
  if (samples.length > 0) return samples.join(' · ');
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

export const swarmChannelGlance: GlanceFn = (toolCall, result) => {
  if (/No Swarm bus messages/i.test(result.output)) return 'no messages';
  if (/Posted to Swarm bus/i.test(result.output)) {
    const channel = /channel=(\S+)/.exec(result.output)?.[1];
    const kind = /kind=(\S+)/.exec(result.output)?.[1];
    const parts = ['posted'];
    if (channel !== undefined) parts.push(channel);
    if (kind !== undefined) parts.push(kind);
    return parts.join(' · ');
  }
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /^\s*\[.+\]\s+(.+?)\s+→\s+.+?\s+\(([^)]+)\):\s*(.+)$/.exec(line);
    if (m) {
      samples.push(`${m[1]} (${m[2]})`);
      if (samples.length >= GLANCE_SAMPLES) break;
    }
  }
  if (samples.length > 0) return samples.join(' · ');
  const action = typeof toolCall.args['action'] === 'string' ? toolCall.args['action'] : '';
  return action.length > 0 ? action : result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

export const agentGlance: GlanceFn = (_toolCall, result) => {
  const agentId = /^agent_id:\s*(\S+)/m.exec(result.output)?.[1];
  const status = /^status:\s*([a-z_]+)/m.exec(result.output)?.[1];
  const type = /^actual_subagent_type:\s*(\S+)/m.exec(result.output)?.[1];
  const parts: string[] = [];
  if (type !== undefined) parts.push(type);
  if (status !== undefined) parts.push(status);
  if (agentId !== undefined) parts.push(agentId);
  if (parts.length > 0) return parts.join(' · ');
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

export const agentSwarmGlance: GlanceFn = (_toolCall, result) => {
  const summary = /<summary>([^<]+)<\/summary>/i.exec(result.output)?.[1]?.trim();
  if (summary !== undefined && summary.length > 0) return summary;
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /outcome="([^"]+)"/.exec(line);
    const item = /item="([^"]+)"/.exec(line)?.[1];
    if (m) {
      samples.push(item !== undefined ? `${item}:${m[1]}` : m[1]!);
      if (samples.length >= GLANCE_SAMPLES) break;
    }
  }
  if (samples.length > 0) return samples.join(' · ');
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

export const ultraSwarmGlance: GlanceFn = (_toolCall, result) => {
  const summary = /<summary>([^<]+)<\/summary>/i.exec(result.output)?.[1]?.trim();
  const strategy = /<strategy>([^<]+)<\/strategy>/i.exec(result.output)?.[1]?.trim();
  const parts: string[] = [];
  if (strategy !== undefined) parts.push(strategy);
  if (summary !== undefined) parts.push(summary);
  if (parts.length > 0) return parts.join(' · ');
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const name = /name="([^"]+)"/.exec(line)?.[1];
    const outcome = /outcome="([^"]+)"/.exec(line)?.[1];
    if (name !== undefined && outcome !== undefined) {
      samples.push(`${name}:${outcome}`);
      if (samples.length >= GLANCE_SAMPLES) break;
    }
  }
  if (samples.length > 0) return samples.join(' · ');
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};
