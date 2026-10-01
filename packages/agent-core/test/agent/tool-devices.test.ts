/**
 * Tool devices: with the flag on, rarely-used tool schemas leave the request's
 * tool block (it is re-sent and re-cached every call) and stay reachable through
 * the ToolDevice transport. The invariants that matter are here: nothing is
 * demoted unless the transport is present, core tools are never demoted, and a
 * device run carries the target tool's own approval rule and accesses so the
 * permission pipeline sees what a direct call would have seen.
 */
import { describe, expect, it } from 'vitest';

import { FLAG_DEFINITIONS } from '../../src/flags/registry';
import { FlagResolver } from '../../src/flags/resolver';
import { Agent } from '../../src/agent';
import { CORE_TOOL_NAMES, resolveToolLoadMode } from '../../src/agent/tool/core-tools';
import type { SDKAgentRPC } from '../../src/rpc';
import { ProviderManager } from '../../src/session/provider/provider-manager';
import { testKaos } from '../fixtures/test-kaos';

function flags(devices: boolean): FlagResolver {
  return new FlagResolver(
    { SUPERLIORA_EXPERIMENTAL_TOOL_DEVICES: devices ? 'true' : 'false' },
    FLAG_DEFINITIONS,
  );
}

function makeAgent(devices: boolean, tools: readonly string[]): Agent {
  const rpc = {
    emitEvent: () => {},
    requestApproval: () => {},
    requestQuestion: () => {},
    requestCredential: () => {},
    toolCall: () => {},
  } as unknown as SDKAgentRPC;
  const agent = new Agent({
    kaos: testKaos,
    rpc,
    modelProvider: new ProviderManager({
      config: {
        providers: { test: { type: 'kimi', apiKey: 'test-key' } },
        models: {
          'mock-model': { provider: 'test', model: 'mock-model', maxContextSize: 1_000_000 },
        },
      },
    }),
    experimentalFlags: flags(devices),
  });
  agent.config.update({ cwd: process.cwd(), modelAlias: 'mock-model' });
  agent.tools.initializeBuiltinTools();
  agent.tools.setActiveTools(tools);
  return agent;
}

const PROFILE = ['Read', 'Bash', 'Grep', 'JobList', 'JobCreate'] as const;

function loopToolNames(agent: Agent): string[] {
  return agent.tools.loopTools.map((tool) => tool.name);
}

/** Discoverable tools this agent actually instantiated (capabilities differ). */
function demotedNames(agent: Agent): string[] {
  return [...agent.tools.builtinTools.keys()].filter(
    (name) => resolveToolLoadMode(name) === 'discoverable',
  );
}

describe('tool devices', () => {
  it('leaves the tool block untouched while the flag is off', () => {
    const agent = makeAgent(false, PROFILE);
    const names = loopToolNames(agent);

    expect(names).toContain('Read');
    expect(names).toContain('JobList');
    expect(names).not.toContain('ToolDevice');
  });

  it('demotes discoverable tools and keeps the core surface when on', () => {
    const agent = makeAgent(true, PROFILE);
    const names = loopToolNames(agent);

    expect(names).toContain('ToolDevice');
    expect(names).toContain('Read');
    expect(names).toContain('Bash');
    expect(names).toContain('Grep');
    expect(names).not.toContain('JobList');
    // Instantiated, not deleted: the transport can still run them.
    const demoted = demotedNames(agent);
    expect(demoted.length).toBeGreaterThan(0);
    for (const name of demoted) expect(names).not.toContain(name);
    expect([...agent.tools.builtinTools.keys()]).toContain('JobList');
  });

  it('never demotes an unclassified name', () => {
    expect(resolveToolLoadMode('SomeMcpServerTool')).toBe('core');
    expect(CORE_TOOL_NAMES['Read']).toBe(true);
  });

  it('lists the demoted tools and refuses an unknown name', async () => {
    const agent = makeAgent(true, PROFILE);
    const device = agent.tools.loopTools.find((tool) => tool.name === 'ToolDevice')!;
    const demoted = demotedNames(agent);

    const listed = await device.resolveExecution({ action: 'list' });
    expect('execute' in listed).toBe(true);
    const listOutput =
      'execute' in listed
        ? String(
            (await listed.execute({ signal: new AbortController().signal } as never)).output,
          )
        : '';
    for (const name of demoted) expect(listOutput).toContain(name);
    expect(listOutput).not.toContain('Read:'); // core tools are not device entries

    const unknown = await device.resolveExecution({ action: 'run', name: 'Nope' });
    expect(unknown).toMatchObject({ isError: true });
  });

  it('delegates the target tool execution, approval rule, and accesses', async () => {
    const agent = makeAgent(true, PROFILE);
    const device = agent.tools.loopTools.find((tool) => tool.name === 'ToolDevice')!;
    // A demoted tool whose schema accepts an empty object, so the call reaches
    // execution instead of validation.
    const targetName = demotedNames(agent).find((name) =>
      ['GetCurrentTime', 'JobList', 'RepoQuery'].includes(name),
    );
    expect(targetName).toBeDefined();
    const target = agent.tools.builtinTools.get(targetName!)!;
    const direct = await target.resolveExecution({} as never);

    const viaDevice = await device.resolveExecution({
      action: 'run',
      name: targetName!,
      arguments: {},
    });

    expect('approvalRule' in viaDevice && viaDevice.approvalRule).toBe(
      'approvalRule' in direct ? direct.approvalRule : undefined,
    );
    expect('accesses' in viaDevice ? viaDevice.accesses : undefined).toEqual(
      'accesses' in direct ? direct.accesses : undefined,
    );
  });

  it('shrinks the serialized tool block for a device-heavy profile', () => {
    // The point of the split: the block is re-sent and re-cached every call.
    const profile = [
      'Read',
      'Write',
      'Edit',
      'Bash',
      'Grep',
      'Glob',
      'JobCreate',
      'JobList',
      'JobInspect',
      'JobInbox',
      'MergeJob',
      'PushJob',
      'NextPhase',
      'RecordInterviewFinding',
      'CreateGoal',
      'GetGoal',
      'UpdateGoal',
      'SetGoalBudget',
      'SearchExpert',
      'SkillCreate',
      'Refine',
      'RepoQuery',
      'Review',
      'Compact',
      'EnterPlanMode',
    ] as const;
    const bytes = (tools: readonly { name: string; description: string; parameters: unknown }[]) =>
      tools.reduce(
        (total, tool) =>
          total +
          tool.name.length +
          tool.description.length +
          JSON.stringify(tool.parameters ?? {}).length,
        0,
      );

    const off = makeAgent(false, profile).tools.loopTools;
    const on = makeAgent(true, profile).tools.loopTools;

    expect(on.length).toBeLessThan(off.length);
    expect(bytes(on)).toBeLessThan(bytes(off) * 0.8);
  });

  it('rejects arguments the target tool would reject', async () => {
    const agent = makeAgent(true, PROFILE);
    const device = agent.tools.loopTools.find((tool) => tool.name === 'ToolDevice')!;

    const invalid = await device.resolveExecution({
      action: 'run',
      name: 'JobCreate',
      arguments: { unexpected: true } as never,
    });

    expect(invalid).toMatchObject({ isError: true });
  });
});