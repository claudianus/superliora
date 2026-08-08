import { describe, expect, it } from 'vitest';

import type { Agent } from '../../../src/agent';
import { ToolWorkflowInjector } from '../../../src/agent/injection/tool-workflow-injector';
import {
  buildToolWorkflowGuidance,
  buildToolWorkflowSparseGuidance,
  hasToolWorkflowSurface,
  resolveToolWorkflowCapability,
} from '../../../src/agent/injection/tool-workflow';

function workflowAgent(
  toolNames: readonly string[] = ['SearchSkill', 'Skill', 'WebSearch', 'LioraRead', 'TodoList'],
): Agent {
  const history: unknown[] = [];
  return {
    tools: {
      loopTools: toolNames.map((name) => ({ name })),
    },
    context: {
      history,
      appendSystemReminder: (content: string) => {
        history.push({
          role: 'user',
          content: [{ type: 'text', text: content }],
          origin: { kind: 'injection', variant: 'tool_workflow' },
        });
      },
    },
  } as unknown as Agent;
}

function history(agent: Agent): unknown[] {
  return agent.context.history as unknown[];
}

function lastText(agent: Agent): string {
  const last = history(agent).at(-1) as { content: Array<{ text: string }> } | undefined;
  return last?.content[0]?.text ?? '';
}

describe('resolveToolWorkflowCapability', () => {
  it('maps known tools to capability flags', () => {
    const cap = resolveToolWorkflowCapability([
      'SearchSkill',
      'Skill',
      'WebSearch',
      'FetchURL',
      'Context7Resolve',
      'LioraRead',
      'VerifySurface',
      'RunProjectChecks',
      'TodoList',
      'Memory',
      'Bash',
    ]);
    expect(cap.hasSearchSkill).toBe(true);
    expect(cap.hasSkill).toBe(true);
    expect(cap.hasWebSearch).toBe(true);
    expect(cap.hasFetchUrl).toBe(true);
    expect(cap.hasContext7).toBe(true);
    expect(cap.hasLeanRead).toBe(true);
    expect(cap.hasVerifySurface).toBe(true);
    expect(cap.hasRunProjectChecks).toBe(true);
    expect(cap.hasTodoList).toBe(true);
    expect(cap.hasMemory).toBe(true);
  });

  it('maps Script and Compact to PTC / compaction flags', () => {
    const cap = resolveToolWorkflowCapability(['Script', 'Compact']);
    expect(cap.hasScript).toBe(true);
    expect(cap.hasCompact).toBe(true);
    expect(hasToolWorkflowSurface(cap)).toBe(true);
    const guidance = buildToolWorkflowGuidance(cap);
    expect(guidance).toContain('Bulk N');
    expect(guidance).toContain('Compact');
  });

  it('treats empty tool set as no surface', () => {
    expect(hasToolWorkflowSurface(resolveToolWorkflowCapability([]))).toBe(false);
    expect(hasToolWorkflowSurface(resolveToolWorkflowCapability(['Bash']))).toBe(false);
  });
});

describe('buildToolWorkflowGuidance', () => {
  it('includes SearchSkill and WebSearch lines when those tools exist', () => {
    const full = buildToolWorkflowGuidance(
      resolveToolWorkflowCapability(['SearchSkill', 'Skill', 'WebSearch', 'FetchURL']),
    );
    expect(full).toContain('SearchSkill');
    expect(full).toContain('WebSearch');
    expect(full).toContain('MANDATORY');
    expect(full).not.toContain('LioraRead');
  });

  it('omits skill/research lines when tools are absent', () => {
    const full = buildToolWorkflowGuidance(resolveToolWorkflowCapability(['RepoQuery', 'TodoList']));
    expect(full).toContain('RepoQuery');
    expect(full).toContain('TodoList');
    expect(full).not.toContain('SearchSkill');
    expect(full).not.toContain('WebSearch');
  });

  it('builds a short sparse checkpoint', () => {
    const sparse = buildToolWorkflowSparseGuidance(
      resolveToolWorkflowCapability(['SearchSkill', 'WebSearch', 'RepoQuery']),
    );
    expect(sparse).toContain('SearchSkill→Skill');
    expect(sparse).toContain('RepoQuery before dumps');
    expect(sparse.length).toBeLessThan(200);
  });
});

describe('ToolWorkflowInjector', () => {
  it('injects full guidance when workflow tools are enabled', async () => {
    const agent = workflowAgent();
    const injector = new ToolWorkflowInjector(agent);
    await injector.inject();
    expect(history(agent)).toHaveLength(1);
    expect(lastText(agent)).toContain('SearchSkill');
    expect(lastText(agent)).toContain('MANDATORY');
  });

  it('does not re-inject every step without a real user prompt', async () => {
    const agent = workflowAgent();
    const injector = new ToolWorkflowInjector(agent);
    await injector.inject();
    history(agent).push({ role: 'assistant' });
    await injector.inject();
    expect(history(agent)).toHaveLength(2);
  });

  it('re-injects sparse guidance after several assistant turns', async () => {
    const agent = workflowAgent();
    const injector = new ToolWorkflowInjector(agent);
    await injector.inject();
    history(agent).push({ role: 'assistant' });
    history(agent).push({ role: 'assistant' });
    history(agent).push({ role: 'assistant' });
    await injector.inject();
    expect(history(agent)).toHaveLength(5);
    expect(lastText(agent)).toContain('Tool workflow still ON');
  });

  it('re-injects sparse guidance after a real user prompt', async () => {
    const agent = workflowAgent();
    const injector = new ToolWorkflowInjector(agent);
    await injector.inject();
    history(agent).push({
      role: 'user',
      content: [{ type: 'text', text: 'tighten the harness' }],
      origin: { kind: 'user' },
    });
    await injector.inject();
    expect(history(agent)).toHaveLength(3);
    expect(lastText(agent)).toContain('Tool workflow still ON');
    expect(lastText(agent)).not.toContain('Tool / Skill / Research Workflow');
  });

  it('skips when no workflow-relevant tools are active', async () => {
    const agent = workflowAgent(['Bash', 'Read']);
    const injector = new ToolWorkflowInjector(agent);
    await injector.inject();
    expect(history(agent)).toHaveLength(0);
  });

  it('mentions Write/Edit over shell I/O and secret-file hard blocks', () => {
    const cap = resolveToolWorkflowCapability(['Read', 'Write', 'Bash', 'SearchTools']);
    const text = buildToolWorkflowGuidance(cap);
    expect(text).toMatch(/Write\/Edit/);
    expect(text).toMatch(/shell redirects|runtime-blocked/i);
    expect(text).toMatch(/Read/);
    expect(text).toMatch(/Secrets never via Bash/i);
    const sparse = buildToolWorkflowSparseGuidance(cap);
    expect(sparse).toContain('Write≠shell I/O');
    expect(sparse).toContain('no secret shell');
  });

  it('shifts injectedAt by keptHeadCount so post-compaction sparse refresh is correct', async () => {
    // Regression for the onContextCompacted off-by-one: without the
    // keptHeadCount shift, the tool-workflow injector would undercount the
    // assistant turns since its prior injection, switching from
    // full → sparse at the wrong boundary. Pin the math directly here: a
    // prior injection at original index 4, with compactedCount=2 and
    // keptHeadCount=1, lands at 1 + 1 + (4 - 2) = 4.
    const agent = workflowAgent();
    const injector = new ToolWorkflowInjector(agent);
    await injector.inject();
    const internal = injector as unknown as { injectedAt: number | null };
    internal.injectedAt = 4;
    injector.onContextCompacted(2, 1);
    expect(internal.injectedAt).toBe(4);
    // A second compaction with a different head count shifts the index
    // by the new head count, not zero.
    internal.injectedAt = 7;
    injector.onContextCompacted(3, 2);
    expect(internal.injectedAt).toBe(2 + 1 + (7 - 3));
  });

});
