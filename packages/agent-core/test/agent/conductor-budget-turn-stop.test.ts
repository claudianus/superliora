/**
 * Conductor wall-clock hard-budget force-stop wired through the real turn
 * step loop (checklist V1-4). Observation alone was the old failure mode;
 * these tests prove the loop actually interrupts overrunning calls and ends
 * the turn after three consecutive hard trips.
 */

import { emptyUsage } from '@superliora/kosong';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/agent';
import {
  CONDUCTOR_GUARD_CODES,
  ConductorDirectWorkGuard,
} from '../../src/agent/conductor-guard';
import { createTurnLoopDispatch } from '../../src/agent/turn/loop-dispatch';
import { runTurnStepLoop } from '../../src/agent/turn/step-loop';
import { TurnTelemetry } from '../../src/agent/turn/telemetry';
import type { GenerateFn } from '../../src/agent/turn/kosong-llm';
import type { LioraConfig } from '../../src/config';
import { ToolAccesses } from '../../src/loop';
import type { ExecutableTool, ExecutableToolResult, ToolExecution } from '../../src/loop';
import { DEFAULT_AGENT_PROFILES, type ResolvedAgentProfile } from '../../src/profile';
import { ProviderManager } from '../../src/session/provider/provider-manager';
import { StreamingThinkScrubber } from '../../src/utils/think-scrubber';
import { testKaos } from '../fixtures/test-kaos';

function bundledProfile(name: string): ResolvedAgentProfile {
  const profile = DEFAULT_AGENT_PROFILES[name];
  if (profile === undefined) throw new Error(`missing bundled profile: ${name}`);
  return profile;
}

interface LingeringCall {
  readonly id: string;
  abortedReason: unknown;
}

/** Blocks until aborted, recording the abort reason it observed. */
class LingerTool implements ExecutableTool<Record<string, unknown>> {
  readonly name = 'linger';
  readonly description = 'Blocks until the budget signal aborts it.';
  readonly parameters = { type: 'object', additionalProperties: true } as const;
  readonly calls: LingeringCall[] = [];

  resolveExecution(): ToolExecution {
    return {
      approvalRule: this.name,
      accesses: ToolAccesses.readFile('/test/linger'),
      execute: async (ctx): Promise<ExecutableToolResult> => {
        const record: LingeringCall = { id: ctx.toolCallId, abortedReason: undefined };
        this.calls.push(record);
        return new Promise<ExecutableToolResult>((_resolve, reject) => {
          const onAbort = (): void => {
            ctx.signal.removeEventListener('abort', onAbort);
            record.abortedReason = ctx.signal.reason;
            const err = new Error('linger cancelled');
            err.name = 'AbortError';
            reject(err);
          };
          if (ctx.signal.aborted) {
            onAbort();
            return;
          }
          ctx.signal.addEventListener('abort', onAbort);
        });
      },
    };
  }
}

function scriptedGenerate(plan: ReadonlyArray<'tool' | 'end'>): {
  readonly generate: GenerateFn;
  readonly callCount: () => number;
} {
  let index = 0;
  const generate: GenerateFn = async () => {
    const kind = plan[index] ?? 'end';
    index += 1;
    if (kind === 'tool') {
      return {
        id: `resp-${String(index)}`,
        message: {
          role: 'assistant',
          content: [],
          toolCalls: [
            { type: 'function', id: `call-${String(index)}`, name: 'linger', arguments: '{}' },
          ],
        },
        usage: emptyUsage(),
        finishReason: 'tool_calls',
        rawFinishReason: 'tool_use',
      };
    }
    return {
      id: `resp-${String(index)}`,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        toolCalls: [],
      },
      usage: emptyUsage(),
      finishReason: 'completed',
      rawFinishReason: 'stop',
    };
  };
  return { generate, callCount: () => index };
}

function makeAgent(plan: ReadonlyArray<'tool' | 'end'>): {
  readonly agent: Agent;
  readonly tool: LingerTool;
  readonly callCount: () => number;
} {
  const scripted = scriptedGenerate(plan);
  const config: LioraConfig = {
    providers: { openai: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-test' } },
    models: {
      main: { provider: 'openai', model: 'gpt-test', maxContextSize: 128_000 },
    },
  };
  const agent = new Agent({
    kaos: testKaos,
    generate: scripted.generate,
    config,
    modelProvider: new ProviderManager({ config }),
  });
  agent.config.update({ modelAlias: 'main' });
  agent.useProfile(bundledProfile('conductor'));
  const tool = new LingerTool();
  agent.tools.userTools.set(tool.name, tool);
  agent.tools.enabledTools.add(tool.name);
  return { agent, tool, callCount: scripted.callCount };
}

/** Small budgets so the hard tripwire fires quickly but deterministically. */
function makeBudgetGuard(): ConductorDirectWorkGuard {
  return new ConductorDirectWorkGuard({ softBudgetMs: 4, hardBudgetMs: 20 });
}

async function runStepLoop(agent: Agent, flushSteerBuffer: () => boolean = () => false) {
  const turnTelemetry = new TurnTelemetry(agent);
  turnTelemetry.resetForTurn(1, turnTelemetry.telemetryMode());
  const assistantThinkScrubber = new StreamingThinkScrubber();
  return runTurnStepLoop(
    {
      agent,
      turnTelemetry,
      flushSteerBuffer,
      buildDispatchEvent: () =>
        createTurnLoopDispatch(
          { agent, turnTelemetry, assistantThinkScrubber, getActiveTurn: () => null },
          1,
        ),
    },
    1,
    new AbortController().signal,
  );
}

describe('conductor hard-budget force-stop through the step loop (V1-4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aborts overrunning calls mid-flight and stops the turn after three trips', async () => {
    const { agent, tool, callCount } = makeAgent(['tool', 'tool', 'tool', 'end']);
    const guard = makeBudgetGuard();
    vi.spyOn(agent, 'conductorGuard', 'get').mockReturnValue(guard);
    const warnings: string[] = [];
    vi.spyOn(agent, 'emitEvent').mockImplementation(((event: { code?: unknown; message?: unknown }) => {
      if (event.code === CONDUCTOR_GUARD_CODES.toolBudgetTripStop) {
        warnings.push(String(event.message));
      }
    }) as Agent['emitEvent']);

    const stopReason = await runStepLoop(agent);

    // The turn ended right after the third trip — the scripted fourth
    // ('end') response was never requested.
    expect(stopReason).toBe('end_turn');
    expect(callCount()).toBe(3);
    // Every call really ran and was interrupted by the budget signal.
    expect(tool.calls).toHaveLength(3);
    for (const call of tool.calls) {
      expect(String(call.abortedReason)).toContain('hard budget');
    }
    // Guard ledger: three hard trips plus the turn-stop diagnostic event.
    const codes = guard.events().map((event) => event.code);
    expect(
      codes.filter((code) => code === CONDUCTOR_GUARD_CODES.toolBudgetHard),
    ).toHaveLength(3);
    expect(codes).toContain(CONDUCTOR_GUARD_CODES.toolBudgetTripStop);
    // Operator-visible warning carried the diagnostic report.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('consecutive hard-budget');
    expect(warnings[0]).toContain('JobCreate');
    expect(guard.consumeBudgetTurnStop('1')).toBeUndefined();
  }, 20_000);

  it('does not resume a budget-stopped turn even with steered input waiting', async () => {
    const { agent, tool, callCount } = makeAgent(['tool', 'tool', 'tool', 'end']);
    const guard = makeBudgetGuard();
    vi.spyOn(agent, 'conductorGuard', 'get').mockReturnValue(guard);

    const stopReason = await runStepLoop(agent, () => true);

    expect(stopReason).toBe('end_turn');
    expect(callCount()).toBe(3);
    expect(tool.calls).toHaveLength(3);
  }, 20_000);

  it('force-stops a single overrunning call but keeps the turn alive', async () => {
    const { agent, tool, callCount } = makeAgent(['tool', 'end']);
    const guard = makeBudgetGuard();
    vi.spyOn(agent, 'conductorGuard', 'get').mockReturnValue(guard);

    const stopReason = await runStepLoop(agent);

    expect(stopReason).toBe('end_turn');
    // Call aborted, model retried, turn finished normally via 'end'.
    expect(callCount()).toBe(2);
    expect(tool.calls).toHaveLength(1);
    expect(String(tool.calls[0]?.abortedReason)).toContain('hard budget');
    const codes = guard.events().map((event) => event.code);
    expect(codes).toContain(CONDUCTOR_GUARD_CODES.toolBudgetHard);
    expect(codes).not.toContain(CONDUCTOR_GUARD_CODES.toolBudgetTripStop);
  }, 20_000);
});
