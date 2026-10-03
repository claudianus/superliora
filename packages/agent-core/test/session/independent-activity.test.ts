import type { Event } from '@superliora/protocol';
import { describe, expect, it } from 'vitest';

import { projectIndependentSessionActivity } from '../../src/session/independent-activity';

const scope = { sessionId: 'coord_worker', agentId: 'main' };
describe('independent activity previews', () => {
  it('projects bounded tool arguments/results with real session scope and unique task identity', () => {
    const raw: Event = { ...scope, type: 'tool.call.started', turnId: 0, toolCallId: 'call', name: 'Bash', args: { command: `echo ${'x'.repeat(100000)}` } };
    const projected = projectIndependentSessionActivity(raw);
    expect(projected).toMatchObject({ ...scope, type: 'subagent.tool_call', subagentId: 'main', name: 'Bash' });
    if (projected?.type !== 'subagent.tool_call') throw new Error('Expected tool preview');
    expect(projected.argsPreview!.length).toBeLessThanOrEqual(401);
    expect('args' in projected).toBe(false);
    expect(raw.type).toBe('tool.call.started');
    const result = projectIndependentSessionActivity({ ...scope, type: 'tool.result', turnId: 0, toolCallId: 'call', output: 'y'.repeat(100000) });
    if (result?.type !== 'subagent.tool_result') throw new Error('Expected result preview');
    expect(result.resultPreview!.length).toBeLessThanOrEqual(501);
    expect('output' in result).toBe(false);
  });

  it('forwards progress immediately but drops opaque custom updates and prompt metadata', () => {
    expect(projectIndependentSessionActivity({ ...scope, type: 'tool.progress', turnId: 0, toolCallId: 'call', update: { kind: 'stdout', text: 'first live line' } }))
      .toMatchObject({ type: 'subagent.tool_progress', subagentId: 'main', kind: 'stdout', textPreview: 'first live line' });
    expect(projectIndependentSessionActivity({ ...scope, type: 'tool.progress', turnId: 0, toolCallId: 'call', update: { kind: 'custom', customData: { prompt: 'do not relay' } } })).toBeUndefined();
    expect(projectIndependentSessionActivity({ ...scope, type: 'session.meta.updated', title: 'worker', patch: { lastPrompt: 'private prompt' } })).toBeUndefined();
  });

  it('keeps child tool identities separate from the independent main and caps single large inference deltas', () => {
    const child = projectIndependentSessionActivity({ ...scope, agentId: 'agent-1', type: 'tool.call.started', turnId: 0, toolCallId: 'call', name: 'Bash', args: {} });
    expect(child).toMatchObject({ sessionId: 'coord_worker', agentId: 'agent-1', subagentId: 'agent-1' });
    const delta = projectIndependentSessionActivity({ ...scope, type: 'assistant.delta', turnId: 0, delta: 'large delta'.repeat(10000) });
    if (delta?.type !== 'assistant.delta') throw new Error('Expected inference delta');
    expect(Buffer.byteLength(delta.delta)).toBeLessThanOrEqual(2000);
  });
});
