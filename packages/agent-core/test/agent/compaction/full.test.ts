import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { createControlledPromise } from '@antfu/utils';
import {
  APIConnectionError,
  APIContextOverflowError,
  APIStatusError,
  generate as runKosongGenerate,
  UNKNOWN_CAPABILITY,
  type ChatProvider,
  type Message,
  type StreamedMessage,
  type StreamedMessagePart,
  type ToolCall,
} from '@superliora/kosong';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sharedCredentialHealthStore } from '@superliora/oauth';

import type { AgentOptions } from '../../../src/agent';
import {
  CONTEXT_COMPACTION_V2_VERSION,
  DEFAULT_COMPACTION_CONFIG,
  DefaultCompactionStrategy,
  evaluateCompactionQualitySignals,
  injectMissingDurableEvidenceIds,
  validateInitialCompactionSummary,
  validateRenderedCompactionSummary,
  type CompactionPlan,
  type CompactionStrategy,
} from '../../../src/agent/compaction';
import { evaluateContinuity } from '../../../src/agent/compaction/context-helpers';
import {
  formatContextOSDiagnoseLine,
  formatContextOSHealthLine,
} from '../../../src/agent/context-os';
import {
  buildEmergencyBackstopActions,
  emergencyBackstopWarnings,
  evidenceRepairSucceeded,
  isMissingEvidenceQualityFailure,
  stripResolvedEvidenceCriticals,
  mergeQualityWarningLists,
  shouldIncludeCompactionQualitySignals,
} from '../../../src/agent/compaction/full-helpers';
import { CompactionQualityTracker } from '../../../src/agent/compaction/quality';
import * as compactionQualityModule from '../../../src/agent/compaction/plan/quality';
import type { LioraConfig } from '../../../src/config';
import { FLAG_DEFINITIONS, FlagResolver, MASTER_ENV } from '../../../src/flags';
import type { AgentMemoryRuntime, MemoryCreateInput, MemoryRecord } from '../../../src/memory';
import { HookEngine, type HookEngineTriggerArgs } from '../../../src/session/hooks';
import { inferCheapModelAliasSync } from '../../../src/utils/cheap-model';
import { estimateTokensForMessages } from '../../../src/utils/tokens';
import { expandArchivedContent } from '../../../src/tools/builtin/context/context-archive';
import { recordingTelemetry, type TelemetryRecord } from '../../fixtures/telemetry';
import { agentTask, waitForTerminal } from '../background/helpers';
import type { TestAgentContext, TestAgentOptions } from '../harness/agent';
import { testAgent } from '../harness/agent';

type GenerateFn = NonNullable<AgentOptions['generate']>;

const CATALOGUED_PROVIDER = {
  type: 'kimi',
  apiKey: 'test-key',
  model: 'kimi-code',
} as const;
const CATALOGUED_MODEL_CAPABILITIES = {
  image_in: true,
  video_in: true,
  audio_in: false,
  thinking: true,
  tool_use: true,
  max_context_tokens: 256_000,
} as const;

/**
 * Runtime config whose models catalogue contains one cheap-looking alias
 * (`cheap-fast` → a haiku model) next to the main `kimi-code` alias, used to
 * exercise automatic cheap-model routing in createCompactionProvider.
 */
function configWithCheapModelCatalogue(loopControl?: LioraConfig['loopControl']): LioraConfig {
  return {
    providers: {
      'test-provider': { type: 'kimi', apiKey: 'test-key' },
    },
    models: {
      'kimi-code': { provider: 'test-provider', model: 'kimi-code', maxContextSize: 256_000 },
      'cheap-fast': { provider: 'test-provider', model: 'claude-3-5-haiku', maxContextSize: 200_000 },
    },
    ...(loopControl === undefined ? {} : { loopControl }),
  };
}

describe('FullCompaction', () => {
  beforeEach(() => {
    // Reset credential health store to prevent state pollution between tests
    // (e.g. markAuthRejected in the OAuth compaction test leaking to others).
    sharedCredentialHealthStore.clear();
  });

  it('keeps a deferred system reminder behind an unresolved tool exchange across compaction', async () => {
    const ctx = testAgent();
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.appendUnresolvedToolExchange(0);
    ctx.agent.context.appendSystemReminder('host note', {
      kind: 'injection',
      variant: 'host',
    });

    // Tool exchange is open, so the reminder is deferred — not yet in history.
    expect(ctx.agent.context.history.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);

    const compacted = ctx.once('context.apply_compaction');
    ctx.mockNextResponse({ type: 'text', text: 'Compacted with open tools.' });
    await ctx.rpc.beginCompaction({});
    await compacted;

    // Compaction preserves the in-flight tool exchange in recent; the deferred
    // reminder still cannot land because the tool exchange is still open.
    expect(ctx.agent.context.history.map((m) => m.role)).toEqual([
      'user',
      'user',
      'assistant',
    ]);

    // Closing the exchange flushes the deferred reminder to history.
    ctx.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'tool.result',
        parentUuid: 'call_unresolved_one',
        toolCallId: 'call_unresolved_one',
        result: { output: 'one result' },
      },
    });
    ctx.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'tool.result',
        parentUuid: 'call_unresolved_two',
        toolCallId: 'call_unresolved_two',
        result: { output: 'two result' },
      },
    });

    expect(ctx.agent.context.history.map((m) => m.role)).toEqual([
      'user',
      'user',
      'assistant',
      'tool',
      'tool',
      'user',
    ]);
    expect(ctx.agent.context.history.at(-1)?.content).toEqual([
      { type: 'text', text: '<system-reminder>\nhost note\n</system-reminder>' },
    ]);
  });

  it('keeps a deferred system reminder behind a partially resolved tool exchange across compaction', async () => {
    const ctx = testAgent();
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.appendUnresolvedToolExchange(1);
    ctx.agent.context.appendSystemReminder('host note', {
      kind: 'injection',
      variant: 'host',
    });

    // One tool result has landed but the second is still pending — reminder defers.
    expect(ctx.agent.context.history.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'tool',
    ]);

    const compacted = ctx.once('context.apply_compaction');
    ctx.mockNextResponse({ type: 'text', text: 'Compacted with partial tools.' });
    await ctx.rpc.beginCompaction({});
    await compacted;

    expect(ctx.agent.context.history.map((m) => m.role)).toEqual([
      'user',
      'user',
      'assistant',
      'tool',
    ]);

    ctx.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'tool.result',
        parentUuid: 'call_unresolved_two',
        toolCallId: 'call_unresolved_two',
        result: { output: 'two result' },
      },
    });

    expect(ctx.agent.context.history.map((m) => m.role)).toEqual([
      'user',
      'user',
      'assistant',
      'tool',
      'tool',
      'user',
    ]);
    expect(ctx.agent.context.history.at(-1)?.content).toEqual([
      { type: 'text', text: '<system-reminder>\nhost note\n</system-reminder>' },
    ]);
  });

  it('fails the turn with context.overflow when auto compaction has no compactable prefix', async () => {
    const ctx = testAgent();
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: {
        ...CATALOGUED_MODEL_CAPABILITIES,
        max_context_tokens: 2_000,
      },
    });
    const oversizedPrompt = `initial-pending-verbatim:${'x'.repeat(8_000)}`;

    await ctx.rpc.prompt({ input: [{ type: 'text', text: oversizedPrompt }] });
    const events = await ctx.untilTurnEnd();

    expect(eventIndex(events, 'compaction.started')).toBe(-1);
    expect(ctx.llmCalls).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'turn.ended',
        args: expect.objectContaining({
          reason: 'failed',
          error: expect.objectContaining({ code: 'context.overflow' }),
        }),
      }),
    );
    await ctx.expectResumeMatches();
  });

  it('reclaims ephemeral injections when auto compaction has no structural prefix', async () => {
    const ctx = testAgent();
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: {
        ...CATALOGUED_MODEL_CAPABILITIES,
        max_context_tokens: 2_000,
      },
    });

    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'kept task' }]);
    ctx.agent.context.appendUserMessage(
      // Keep well under hard50 (floor(2000*0.50)=1000 tokens) after injection reclaim.
      [{ type: 'text', text: 'x'.repeat(2_400) }],
      { kind: 'compaction_summary' },
    );
    ctx.agent.context.appendSystemReminder(`inject ${'y'.repeat(12_000)}`, {
      kind: 'injection',
      variant: 'lean_context',
    });

    const abort = new AbortController();
    await ctx.agent.fullCompaction.beforeStep(abort.signal);

    expect(ctx.agent.context.history.some((message) => message.origin?.kind === 'injection')).toBe(false);
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);
  });

  it('rejects manual compaction with compaction.unable when no prefix is compactable', async () => {
    const ctx = testAgent();
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });

    await expect(ctx.rpc.beginCompaction({})).rejects.toMatchObject({
      code: 'compaction.unable',
    });
    expect(ctx.llmCalls).toHaveLength(0);

    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'only pending user' }]);
    ctx.mockNextResponse({ type: 'text', text: 'Compacted single user.' });
    const singleCompacted = ctx.once('context.apply_compaction');
    const singleCompleted = ctx.once('compaction.completed');
    await ctx.rpc.beginCompaction({});
    await singleCompacted;
    await singleCompleted;
    expect(ctx.llmCalls).toHaveLength(1);

    ctx.agent.context.clear();
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.appendExchange(2, 'recent user two', 'recent assistant two', 80);
    const compacted = ctx.once('context.apply_compaction');
    const completed = ctx.once('compaction.completed');

    ctx.mockNextResponse({ type: 'text', text: 'Compacted after no-op cancel.' });
    await ctx.rpc.beginCompaction({});
    await compacted;
    await completed;

    expect(ctx.llmCalls).toHaveLength(2);
    expectCompactedAssistant(compactionSummaryEntry(ctx.compactHistory()), 'Compacted after no-op cancel.');
    await ctx.expectResumeMatches();
  });

  it('does not auto compact small contexts when reserved size exceeds the model window', async () => {
    const ctx = testAgent({
      experimentalFlags: new FlagResolver(
        { SUPERLIORA_EXPERIMENTAL_ASYNC_COMPACTION: '0' },
        FLAG_DEFINITIONS,
      ),
      initialConfig: {
        providers: {},
        loopControl: {
          reservedContextSize: 50_000,
          // Keep soft reclaim far above this small fixture so the test isolates
          // the reserved-size-exceeds-window path after densify ladders.
          compactionTriggerRatio: 0.85,
          compactionTriggerTokens: 2_000_000,
        },
      },
    });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: {
        ...CATALOGUED_MODEL_CAPABILITIES,
        max_context_tokens: 32_000,
      },
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 1_000);

    ctx.mockNextResponse({ type: 'text', text: 'I can answer without reserved compaction.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'small prompt' }] });
    const events = await ctx.untilTurnEnd();

    expect(eventIndex(events, 'compaction.started')).toBe(-1);
    expect(ctx.llmCalls).toHaveLength(1);
    expect(ctx.llmCalls[0]?.history.map(messageText)).toContain('old assistant one');
    expect(
      ctx.llmCalls[0]?.history.some((message) => messageText(message) === 'small prompt'),
    ).toBe(true);
    await ctx.expectResumeMatches();
  });

  it('triggers auto compaction when pending tokens cross the reserved threshold', async () => {
    const ctx = testAgent({
      initialConfig: {
        providers: {},
        loopControl: { reservedContextSize: 500 },
      },
    });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: {
        ...CATALOGUED_MODEL_CAPABILITIES,
        max_context_tokens: 2_000,
      },
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 1_700);

    ctx.mockNextResponse({ type: 'text', text: 'Reserved compacted summary.' });
    ctx.mockNextResponse({ type: 'text', text: 'I can answer after reserved compaction.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'x'.repeat(440) }] });
    await ctx.untilTurnEnd();

    expect(ctx.llmCalls).toHaveLength(2);
    const [compactionCall, answerCall] = ctx.llmCalls;
    expect(messageText(compactionCall?.history.at(-1))).toContain('Respond with text only');
    expect(messageTextsContain(answerCall?.history, 'Reserved compacted summary.')).toBe(true);
    await ctx.expectResumeMatches();
  });

  it('keeps an oversized pending user prompt out of auto compaction', async () => {
    const ctx = testAgent();
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: {
        ...CATALOGUED_MODEL_CAPABILITIES,
        max_context_tokens: 2_000,
      },
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 1_650);
    const oversizedPrompt = `keep-this-pending-verbatim:${'x'.repeat(1_800)}`;

    ctx.mockNextResponse({ type: 'text', text: 'Oversized prompt summary.' });
    ctx.mockNextResponse({ type: 'text', text: 'I can answer the oversized prompt.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: oversizedPrompt }] });
    await ctx.untilTurnEnd();

    expect(ctx.llmCalls).toHaveLength(2);
    const [compactionCall, answerCall] = ctx.llmCalls;
    const compactionTexts = compactionCall?.history.map(messageText) ?? [];
    expect(compactionTexts.some((text) => text.includes('keep-this-pending-verbatim'))).toBe(false);
    expect(compactionCall?.history.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(messageTextsContain(answerCall?.history, 'Oversized prompt summary.')).toBe(true);
    expect(
      answerCall?.history.some(
        (message) => messageText(message) === oversizedPrompt,
      ),
    ).toBe(true);
    await ctx.expectResumeMatches();
  });

  it('triggers auto compaction when pending tokens cross the ratio threshold', async () => {
    const ctx = testAgent();
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: {
        ...CATALOGUED_MODEL_CAPABILITIES,
        max_context_tokens: 1_000_000,
      },
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 840_000);
    const pendingPrompt = `ratio-pending-verbatim:${'x'.repeat(60_000)}`;

    ctx.mockNextResponse({ type: 'text', text: 'Ratio compacted summary.' });
    ctx.mockNextResponse({ type: 'text', text: 'I can answer the ratio pending prompt.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: pendingPrompt }] });
    await ctx.untilTurnEnd();

    expect(ctx.llmCalls).toHaveLength(2);
    const [compactionCall, answerCall] = ctx.llmCalls;
    const compactionTexts = compactionCall?.history.map(messageText) ?? [];
    expect(compactionTexts.some((text) => text.includes('ratio-pending-verbatim'))).toBe(false);
    expect(compactionCall?.history.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(messageTextsContain(answerCall?.history, 'Ratio compacted summary.')).toBe(true);
    expect(
      answerCall?.history.some((message) => messageText(message) === pendingPrompt),
    ).toBe(true);

    await ctx.expectResumeMatches();
  });

  it('honors loopControl.compactionTriggerRatio for auto compaction', async () => {
    const ctx = testAgent({
      initialConfig: {
        providers: {},
        loopControl: {
          reservedContextSize: 0,
          compactionTriggerRatio: 0.7,
          compactionTriggerTokens: 2_000_000,
        },
      },
    });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: {
        ...CATALOGUED_MODEL_CAPABILITIES,
        max_context_tokens: 1_000_000,
      },
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 705_000);

    ctx.mockNextResponse({ type: 'text', text: 'Custom ratio compacted summary.' });
    ctx.mockNextResponse({ type: 'text', text: 'I can answer after custom ratio compaction.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'custom ratio prompt' }] });
    await ctx.untilTurnEnd();

    expect(ctx.llmCalls).toHaveLength(2);
    const [compactionCall, answerCall] = ctx.llmCalls;
    expect(messageText(compactionCall?.history.at(-1))).toContain('Respond with text only');
    expect(messageTextsContain(answerCall?.history, 'Custom ratio compacted summary.')).toBe(true);
    await ctx.expectResumeMatches();
  });

  it('merges parallel block compaction summaries into one v2 summary', async () => {
    const records: TelemetryRecord[] = [];
    const mergePrompts: string[] = [];
    let blockCalls = 0;
    const generate: GenerateFn = async (_provider, _system, _tools, history) => {
      const prompt = messageText(history.at(-1));
      if (prompt.includes('Merge these block-level compaction summaries')) {
        mergePrompts.push(prompt);
        return textResult('Merged block summary with the final next action.');
      }
      blockCalls += 1;
      return textResult(`Block ${String(blockCalls)} summary.`);
    };
    const ctx = testAgent({
      generate,
      telemetry: recordingTelemetry(records),
      compactionStrategy: parallelCompactAll,
    });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.appendExchange(2, 'old user two', 'old assistant two', 20);
    ctx.appendExchange(3, 'old user three', 'old assistant three', 20);
    const compacted = ctx.once('context.apply_compaction');
    const completed = ctx.once('compaction.completed');

    await ctx.rpc.beginCompaction({});
    await compacted;
    await completed;

    expect(blockCalls).toBeGreaterThan(1);
    expect(mergePrompts).toHaveLength(1);
    expect(mergePrompts[0]).toContain('Block 1 summary.');
    expectCompactedAssistant(
      compactionSummaryEntry(ctx.compactHistory()),
      'Merged block summary with the final next action.',
    );
    expect(ctx.newEvents()).toContainEqual(
      expect.objectContaining({
        event: 'compaction.completed',
        args: expect.objectContaining({
          result: expect.objectContaining({
            parallelBlockCount: expect.any(Number),
            mergeInputTokens: expect.any(Number),
          }),
        }),
      }),
    );
    expect(records).toContainEqual({
      event: 'compaction_v2_finished',
      properties: expect.objectContaining({
        parallel_block_count: expect.any(Number),
        merge_input_tokens: expect.any(Number),
      }),
    });
    await ctx.expectResumeMatches();
  });

  it('repairs malformed v2 compaction summaries once before applying context', async () => {
    const records: TelemetryRecord[] = [];
    let attempts = 0;
    const generate: GenerateFn = async (_provider, _system, _tools, history) => {
      attempts += 1;
      const prompt = messageText(history.at(-1));
      if (prompt.includes('failed deterministic quality checks')) {
        return textResult([
          'current_goal: Continue the repaired task.',
          'next_actions:',
          '- Run the repaired compaction checks.',
          'raw_refs:',
          '- user[0-0] tokens=4',
        ].join('\n'));
      }
      return textResult([
        'current_goal:',
        '- Missing inline goal value.',
        'last_known_state:',
        '- This malformed v2 summary omits next actions and raw refs.',
      ].join('\n'));
    };
    const ctx = testAgent({ generate, telemetry: recordingTelemetry(records) });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.appendExchange(2, 'recent user two', 'recent assistant two', 80);
    const compacted = ctx.once('context.apply_compaction');
    const completed = ctx.once('compaction.completed');

    await ctx.rpc.beginCompaction({});
    await compacted;
    await completed;

    expect(attempts).toBe(2);
    expectCompactedAssistant(compactionSummaryEntry(ctx.compactHistory()), 'Continue the repaired task.');
    expect(ctx.newEvents()).toContainEqual(
      expect.objectContaining({
        event: 'compaction.completed',
        args: expect.objectContaining({
          result: expect.objectContaining({ repairAttempted: true }),
        }),
      }),
    );
    expect(records).toContainEqual({
      event: 'compaction_v2_finished',
      properties: expect.objectContaining({
        repair_attempted: true,
      }),
    });
    await ctx.expectResumeMatches();
  });

  it('injects planner raw_refs when the LLM omits them from a v2 summary', async () => {
    let attempts = 0;
    const generate: GenerateFn = async () => {
      attempts += 1;
      return textResult([
        'current_goal: Continue capturing screenshots for WG-11.',
        'next_actions:',
        '- Capture the landing page screenshot next.',
        'last_known_state:',
        '- Dev server is running on port 4173.',
      ].join('\n'));
    };
    const ctx = testAgent({ generate });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.appendExchange(2, 'recent user two', 'recent assistant two', 80);
    const compacted = ctx.once('context.apply_compaction');
    const completed = ctx.once('compaction.completed');

    await ctx.rpc.beginCompaction({});
    await compacted;
    await completed;

    expect(attempts).toBe(1);
    expect(compactionSummaryEntry(ctx.compactHistory())?.text).toContain('raw_refs:');
    expect(compactionSummaryEntry(ctx.compactHistory())?.text).toMatch(/user\[0-0\]/);
    expect(ctx.newEvents()).toContainEqual(
      expect.objectContaining({
        event: 'compaction.completed',
        args: expect.objectContaining({
          result: expect.not.objectContaining({ repairAttempted: true }),
        }),
      }),
    );
    await ctx.expectResumeMatches();
  });

  it('compacts and retries when the provider reports context overflow', async () => {
    let callCount = 0;
    const inputs: string[][] = [];
    const generate: GenerateFn = async (_provider, _system, _tools, history, callbacks) => {
      callCount += 1;
      inputs.push(inputHistorySnapshot(history));
      if (callCount === 1) {
        throw new APIContextOverflowError(400, 'Context length exceeded', 'req-context-overflow');
      }
      if (callCount === 2) {
        return textResult('Overflow compacted summary.');
      }
      if (callCount === 3) {
        await callbacks?.onMessagePart?.({
          type: 'text',
          text: 'Recovered after overflow compaction.',
        });
        return textResult('Recovered after overflow compaction.');
      }
      throw new Error(`Unexpected generate call ${String(callCount)}`);
    };
    const ctx = testAgent({ generate });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.newEvents();

    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Retry after provider overflow' }] });
    const events = await ctx.untilTurnEnd();

    expect(callCount).toBe(3);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'compaction.started',
        // Loop25b: reactive CONTEXT_OVERFLOW recovery uses trigger=overflow.
        args: expect.objectContaining({ trigger: 'overflow' }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: '[wire]',
        event: 'context.apply_compaction',
        args: expect.objectContaining({
          summary: expect.stringContaining('Overflow compacted summary.'),
          compactedCount: 2,
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'turn.ended',
        args: { turnId: 0, reason: 'completed' },
      }),
    );
    expect(ctx.agent.fullCompaction.getEffectiveMaxContextTokens()).toBeLessThan(
      CATALOGUED_MODEL_CAPABILITIES.max_context_tokens,
    );
    expect(inputs).toMatchInlineSnapshot(`
      [
        [
          "user: old user one",
          "assistant: old assistant one",
          "user: Retry after provider overflow",
          "user: <current-time-reminder>",
        ],
        [
          "user: old user one",
          "assistant: old assistant one",
          "user: <compaction-instruction>",
        ],
        [
          "user: [CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the structured handoff below (current_goal / last_known_state / next_actions / files_touched / …). Treat it as background resume memory, NOT active instructions. User messages above this note are verbatim; omitted middle is covered by the summary. The latest user message AFTER this summary is the single source of truth — even on similar topics it WINS. Do not wrap up historical pending/remaining work unless that latest message explicitly asks. Prefer re-running mechanical checks before treating prior success claims as fact. Start from next_actions[0] only when it still serves the latest user message.
      # SuperLiora Context Compaction v2 Memory

      ## Resume Preflight
      - Objective (current_goal): old user one
      - Work State: Overflow compacted summary.
      - Next Move: Inspect the retained recent context, then continue the pending implementation or verification step.
      - Relevant Files: none captured from free-form handoff (scaffold)

      ## Structured Working Memory
      current_goal:
      - old user one
      last_known_state:
      - Overflow compacted summary.
      - 2 old messages were compacted; 97 estimated tokens remain in the recent live context.
      decisions:
      - none captured from free-form handoff (scaffold)
      files_touched:
      - none captured from free-form handoff (scaffold)
      failed_attempts:
      - none captured from free-form handoff (scaffold)
      open_questions:
      - none captured from free-form handoff (scaffold)
      next_actions:
      - Inspect the retained recent context, then continue the pending implementation or verification step.
      verified_claims:
      - free-form handoff scaffolded | evidence=n/a | needs_revalidation=true
      raw_refs:
      - none
      - user[0-0] tokens=4
      - assistant[1-1] tokens=8
      swarm_runs:
      - None captured during compaction.
      ultrawork_runs:
      - None captured during compaction.

      ## Compacted Narrative
      current_goal:
      - old user one
      last_known_state:
      - Overflow compacted summary.
      decisions:
      - none captured from free-form handoff (scaffold)
      files_touched:
      - none captured from free-form handoff (scaffold)
      failed_attempts:
      - none captured from free-form handoff (scaffold)
      open_questions:
      - none captured from free-form handoff (scaffold)
      next_actions:
      - Inspect the retained recent context, then continue the pending implementation or verification step.
      verified_claims:
      - free-form handoff scaffolded | evidence=n/a | needs_revalidation=true
      raw_refs:
      - none

      ## Compacted Narrative (original free-form)
      Overflow compacted summary.",
          "user: Retry after provider overflow",
          "user: <current-time-reminder>",
          "user: <current-time-reminder>",
          "user: <system-reminder>
      Resume recheck (T1-5): the compacted summary carries verification claims flagged needs_revalidation.
      Re-run their cheap evidence (tests, typecheck, git status) before treating them as done:
      - free-form handoff scaffolded | evidence=n/a | needs_revalidation=true
      </system-reminder>",
        ],
      ]
    `);
    await ctx.expectResumeMatches();
  });

  it('stops repeated provider-overflow compactions when compacted context still overflows', async () => {
    let callCount = 0;
    const generate: GenerateFn = async (_provider, _system, _tools, history) => {
      callCount += 1;
      const last = messageText(history.at(-1));
      // Compaction prompts evolved from "first-person handoff note" to the
      // structured handoff contract; treat either as a summarize call.
      if (
        last.includes('first-person handoff note') ||
        last.includes('Write a handoff so you can continue') ||
        last.includes('You are about to run out of context')
      ) {
        return textResult(`Still too large summary ${String(callCount)}.`);
      }
      throw new APIContextOverflowError(
        400,
        'Context length exceeded',
        `req-overflow-${String(callCount)}`,
      );
    };
    const ctx = testAgent({ generate });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);

    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Retry until overflow guard' }] });
    const events = await ctx.untilTurnEnd();

    expect(countEvents(events, 'compaction.started')).toBe(3);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'turn.ended',
        args: expect.objectContaining({
          reason: 'failed',
          error: expect.objectContaining({
            code: 'context.overflow',
            message: 'Compaction failed to bring the context under the model window after 3 attempts.',
          }),
        }),
      }),
    );
  });

  it('recovers from plain 413 when the estimated request is near the model window', async () => {
    let callCount = 0;
    const generate: GenerateFn = async (_provider, _system, _tools, _history, callbacks) => {
      callCount += 1;
      if (callCount === 1) {
        throw new APIStatusError(413, 'Request Entity Too Large', 'req-plain-413');
      }
      if (callCount === 2) {
        return textResult('Plain 413 compacted summary.');
      }
      await callbacks?.onMessagePart?.({
        type: 'text',
        text: 'Recovered after plain 413 compaction.',
      });
      return textResult('Recovered after plain 413 compaction.');
    };
    const ctx = testAgent({ generate });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: {
        ...CATALOGUED_MODEL_CAPABILITIES,
        max_context_tokens: 1_000,
      },
    });
    ctx.appendExchange(1, 'old user one', `old assistant one ${'x'.repeat(2_400)}`, 20);
    ctx.newEvents();

    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Retry after plain 413' }] });
    const events = await ctx.untilTurnEnd();

    expect(callCount).toBe(3);
    expect(ctx.agent.fullCompaction.getEffectiveMaxContextTokens()).toBeLessThan(1_000);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'compaction.started',
        // Loop25b: reactive CONTEXT_OVERFLOW recovery uses trigger=overflow.
        args: expect.objectContaining({ trigger: 'overflow' }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'turn.ended',
        args: { turnId: 0, reason: 'completed' },
      }),
    );
    await ctx.expectResumeMatches();
  });

  it('does not compact plain 413 when the estimated request is small', async () => {
    const generate: GenerateFn = async () => {
      throw new APIStatusError(413, 'Request Entity Too Large', 'req-small-413');
    };
    const ctx = testAgent({ generate });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: {
        ...CATALOGUED_MODEL_CAPABILITIES,
        max_context_tokens: 200_000,
      },
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.newEvents();

    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'small prompt' }] });
    const events = await ctx.untilTurnEnd();

    expect(eventIndex(events, 'compaction.started')).toBe(-1);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'turn.ended',
        args: expect.objectContaining({ turnId: 0, reason: 'failed' }),
      }),
    );
  });

  it('preserves thinking effort when compacting after provider context overflow', async () => {
    let callCount = 0;
    const records: TelemetryRecord[] = [];
    const providerThinkingEfforts: Array<Parameters<GenerateFn>[0]['thinkingEffort']> = [];
    const generate: GenerateFn = async (provider, _system, _tools, _history, callbacks) => {
      callCount += 1;
      providerThinkingEfforts.push(provider.thinkingEffort);
      if (callCount === 1) {
        throw new APIContextOverflowError(
          400,
          'Context length exceeded',
          'req-thinking-context-overflow',
        );
      }
      if (callCount === 2) {
        return textResult('Thinking compacted summary.');
      }
      if (callCount === 3) {
        await callbacks?.onMessagePart?.({
          type: 'text',
          text: 'Recovered after thinking compaction.',
        });
        return textResult('Recovered after thinking compaction.');
      }
      throw new Error(`Unexpected generate call ${String(callCount)}`);
    };
    const ctx = testAgent({ generate, telemetry: recordingTelemetry(records) });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    ctx.agent.config.update({ thinkingLevel: 'high' });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.newEvents();

    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Retry with thinking preserved' }] });
    await ctx.untilTurnEnd();

    expect(callCount).toBe(3);
    expect(providerThinkingEfforts).toEqual(['high', null, 'high']);
    expect(ctx.agent.fullCompaction.getEffectiveMaxContextTokens()).toBeLessThan(
      CATALOGUED_MODEL_CAPABILITIES.max_context_tokens,
    );
    expect(records).toContainEqual({
      event: 'compaction_finished',
      properties: expect.objectContaining({
        // Loop25b: overflow recovery telemetry source.
        source: 'overflow',
        thinking_level: 'high',
      }),
    });
  });

  it('compacts provider overflow when model context size is unknown', async () => {
    let callCount = 0;
    const compactionMaxCompletionTokens: unknown[] = [];
    const generate: GenerateFn = async (provider, _system, _tools, _history, callbacks) => {
      callCount += 1;
      if (callCount === 1) {
        throw new APIContextOverflowError(400, 'Context length exceeded', 'req-unknown-context');
      }
      if (callCount === 2) {
        compactionMaxCompletionTokens.push(providerMaxCompletionTokens(provider));
        return textResult('Unknown window compacted summary.');
      }
      if (callCount === 3) {
        await callbacks?.onMessagePart?.({
          type: 'text',
          text: 'Recovered with unknown context size.',
        });
        return textResult('Recovered with unknown context size.');
      }
      throw new Error(`Unexpected generate call ${String(callCount)}`);
    };
    const ctx = testAgent({ generate });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    const providerManager = ctx.agent.modelProvider;
    if (providerManager === undefined) throw new Error('Expected provider manager');
    const resolveProviderConfig = providerManager.resolveProviderConfig.bind(providerManager);
    providerManager.resolveProviderConfig = (model) => ({
      ...resolveProviderConfig(model),
      modelCapabilities: UNKNOWN_CAPABILITY,
    });
    expect(ctx.agent.config.modelCapabilities.max_context_tokens).toBe(0);
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.newEvents();

    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Retry without known model window' }] });
    const events = await ctx.untilTurnEnd();

    expect(callCount).toBe(3);
    expect(compactionMaxCompletionTokens).toEqual([32000]);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'compaction.started',
        // Loop25b: reactive CONTEXT_OVERFLOW recovery uses trigger=overflow.
        args: expect.objectContaining({ trigger: 'overflow' }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: '[wire]',
        event: 'context.apply_compaction',
        args: expect.objectContaining({
          summary: expect.stringContaining('Unknown window compacted summary.'),
          compactedCount: 2,
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'turn.ended',
        args: { turnId: 0, reason: 'completed' },
      }),
    );
  });

  it.each<{
    label: string;
    reqId: string;
    summary: string;
    recovery: string;
    env?: string;
    configureModel?: (ctx: TestAgentContext) => void;
    expectedCap: number;
  }>([
    {
      label: 'honors maxOutputSize from model config during compaction',
      reqId: 'req-max-output',
      summary: 'Max output compacted summary.',
      recovery: 'Recovered with max output.',
      configureModel: (ctx) => {
        const models = (ctx as unknown as { kimiConfig: LioraConfig }).kimiConfig.models;
        models![CATALOGUED_PROVIDER.model] = {
          ...models![CATALOGUED_PROVIDER.model]!,
          maxOutputSize: 384000,
        };
      },
      expectedCap: 255_988,
    },
    {
      label: 'uses default 128k hard cap when maxOutputSize is not configured',
      reqId: 'req-default-cap',
      summary: 'Default cap compacted summary.',
      recovery: 'Recovered with default cap.',
      expectedCap: 131_072,
    },
    {
      label: 'honors completion budget env hard caps during compaction',
      reqId: 'req-hard-cap',
      summary: 'Hard cap compacted summary.',
      recovery: 'Recovered with hard cap.',
      env: '8192',
      expectedCap: 8192,
    },
    {
      label: 'honors completion budget env opt-out during compaction',
      reqId: 'req-opt-out',
      summary: 'Opt-out compacted summary.',
      recovery: 'Recovered with opt-out.',
      env: '0',
      expectedCap: 255_988,
    },
  ])(
    'applies the completion-token cap precedence (model config → 128k default → env hard cap → env opt-out) — %s',
    async ({ reqId, summary, recovery, env, configureModel, expectedCap }) => {
      if (env !== undefined) vi.stubEnv('KIMI_MODEL_MAX_COMPLETION_TOKENS', env);
      let callCount = 0;
      const compactionMaxCompletionTokens: unknown[] = [];
      const generate: GenerateFn = async (provider, _system, _tools, _history, callbacks) => {
        callCount += 1;
        if (callCount === 1) {
          throw new APIContextOverflowError(400, 'Context length exceeded', reqId);
        }
        if (callCount === 2) {
          compactionMaxCompletionTokens.push(providerMaxCompletionTokens(provider));
          return textResult(summary);
        }
        await callbacks?.onMessagePart?.({
          type: 'text',
          text: recovery,
        });
        return textResult(recovery);
      };
      const ctx = testAgent({ generate });
      ctx.configure({
        provider: CATALOGUED_PROVIDER,
        modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
      });
      configureModel?.(ctx);
      ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
      ctx.newEvents();

      await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Retry with cap config' }] });
      await ctx.untilTurnEnd();

      expect(callCount).toBe(3);
      expect(compactionMaxCompletionTokens).toEqual([expectedCap]);
    },
  );

  it('ignores filtered assistant placeholders when checking the retained overflow suffix', async () => {
    let callCount = 0;
    const generate: GenerateFn = async (_provider, _system, _tools, _history, callbacks) => {
      callCount += 1;
      if (callCount === 1) {
        throw new APIContextOverflowError(
          400,
          'Context length exceeded',
          'req-placeholder-boundary',
        );
      }
      if (callCount === 2) {
        return textResult('Placeholder compacted summary.');
      }
      if (callCount === 3) {
        await callbacks?.onMessagePart?.({
          type: 'text',
          text: 'Recovered after ignoring the placeholder.',
        });
        return textResult('Recovered after ignoring the placeholder.');
      }
      throw new Error(`Unexpected generate call ${String(callCount)}`);
    };
    const ctx = testAgent({
      generate,
      compactionStrategy: overflowOnlyCompactionStrategy(),
    });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: {
        ...CATALOGUED_MODEL_CAPABILITIES,
        max_context_tokens: 14,
      },
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 1);
    const promptThatFitsWithoutPlaceholder = 'x'.repeat(40);
    ctx.newEvents();

    await ctx.rpc.prompt({ input: [{ type: 'text', text: promptThatFitsWithoutPlaceholder }] });
    const events = await ctx.untilTurnEnd();

    expect(callCount).toBe(3);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'compaction.started',
        // Pre-rot auto (placeholder filtering), not reactive overflow recovery.
        args: expect.objectContaining({ trigger: 'auto' }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: '[wire]',
        event: 'context.apply_compaction',
        args: expect.objectContaining({
          summary: expect.stringContaining('Placeholder compacted summary.'),
          compactedCount: 2,
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'turn.ended',
        args: { turnId: 0, reason: 'completed' },
      }),
    );
  });

  it('emits context.overflow and terminates the turn after too many auto compactions', async () => {
    const ctx = testAgent({ compactionStrategy: alwaysCompactOnce });
    ctx.configure();

    ctx.mockNextResponse({ type: 'text', text: 'First compacted summary.' });
    ctx.mockNextResponse({ type: 'text', text: 'I need a tool.' }, missingToolCall());
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Trigger repeated compaction' }] });

    const events = await ctx.untilTurnEnd();

    // Auto compaction ran once before the turn and blocked it.
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'compaction.started',
        args: expect.objectContaining({ trigger: 'auto' }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'compaction.blocked', args: { turnId: 0 } }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'context.apply_compaction' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'compaction.completed' }),
    );

    // The turn ran a tool step, then the next step hit maxCompactionPerTurn and
    // terminated with context.overflow (not a mock-queue internal error).
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'tool.call.started',
        args: expect.objectContaining({ name: 'MissingTool' }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'turn.step.interrupted',
        args: expect.objectContaining({
          reason: 'error',
          message: expect.stringContaining('Compaction limit exceeded'),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'turn.ended',
        args: expect.objectContaining({
          turnId: 0,
          reason: 'failed',
          error: expect.objectContaining({
            code: 'context.overflow',
            retryable: true,
            message: expect.stringContaining('Compaction limit exceeded'),
          }),
        }),
      }),
    );

    // The terminal error is also surfaced as a top-level error event.
    expect(ctx.newEvents()).toContainEqual(
      expect.objectContaining({
        event: 'error',
        args: expect.objectContaining({
          code: 'context.overflow',
          retryable: true,
          message: expect.stringContaining('Compaction limit exceeded'),
        }),
      }),
    );

    // Two LLM calls were made: the compaction summary, then the post-compaction
    // turn that issued the tool call. Token tallies embedded in the summary text
    // are intentionally not pinned.
    const llmCalls = ctx.llmInputs().inputs;
    expect(llmCalls).toHaveLength(2);
    expect(llmCalls[0]?.history.at(-1)?.role).toBe('user');
    expect(
      llmCalls[1]?.history.some((message) =>
        message.content.some(
          (part) => part.type === 'text' && part.text.includes('First compacted summary.'),
        ),
      ),
    ).toBe(true);
    await ctx.expectResumeMatches();
  });

  it('appends the todo list to the compaction summary', async () => {
    const ctx = testAgent();
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.appendExchange(2, 'recent user two', 'recent assistant two', 80);

    ctx.agent.tools.updateStore('todo', [
      { title: 'Fix the auth bug', status: 'in_progress' },
      { title: 'Add tests', status: 'pending' },
    ]);

    const compacted = new Promise<void>((resolve) => {
      ctx.emitter.once('context.apply_compaction', () => {
        resolve();
      });
    });
    const completed = ctx.once('compaction.completed');

    ctx.mockNextResponse({ type: 'text', text: 'Compacted summary.' });
    await ctx.rpc.beginCompaction({});
    await compacted;
    await completed;

    const summary = compactionSummaryEntry(ctx.compactHistory());
    expectCompactedAssistant(summary, 'Compacted summary.');
    expect(summary?.text).toContain('## TODO List');
    expect(summary?.text).toContain('[in_progress] Fix the auth bug');
    expect(summary?.text).toContain('[pending] Add tests');
    await ctx.expectResumeMatches();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});



function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function eventIndex(events: ReturnType<TestAgentContext['newEvents']>, type: string): number {
  return events.findIndex((event) => {
    if (typeof event !== 'object' || event === null) return false;
    return (event as { readonly event?: unknown }).event === type;
  });
}

function countEvents(events: ReturnType<TestAgentContext['newEvents']>, type: string): number {
  return events.filter((event) => {
    if (typeof event !== 'object' || event === null) return false;
    return (event as { readonly event?: unknown }).event === type;
  }).length;
}

function oauthTestAgentOptions(
  getAccessToken: (options?: { readonly force?: boolean }) => Promise<string>,
): Pick<TestAgentOptions, 'initialConfig' | 'providerManagerOverrides'> {
  return {
    initialConfig: {
      defaultModel: 'kimi-code',
      providers: {
        'managed:kimi-code': {
          type: 'vertexai',
          baseUrl: 'https://api.example/v1',
          oauth: { storage: 'file', key: 'oauth/kimi-code' },
        },
      },
      models: {
        'kimi-code': {
          provider: 'managed:kimi-code',
          model: 'kimi-for-coding',
          maxContextSize: 1_000_000,
        },
      },
    },
    providerManagerOverrides: {
      resolveOAuthTokenProvider: () => ({ getAccessToken }),
    },
  };
}

function providerMaxCompletionTokens(provider: Parameters<GenerateFn>[0]): unknown {
  return (
    provider as {
      readonly modelParameters?: Record<string, unknown>;
    }
  ).modelParameters?.['max_completion_tokens'];
}

function textResult(text: string): Awaited<ReturnType<GenerateFn>> {
  return {
    id: 'mock-compaction-oauth-retry',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      toolCalls: [],
    },
    usage: {
      inputOther: 1,
      output: 1,
      inputCacheRead: 0,
      inputCacheCreation: 0,
    },
    finishReason: 'completed',
    rawFinishReason: 'stop',
  };
}

function mockStreamedMessage(parts: readonly StreamedMessagePart[]): StreamedMessage {
  return {
    get id(): string | null {
      return 'mock-stream';
    },
    get usage() {
      return null;
    },
    finishReason: null,
    rawFinishReason: null,
    async *[Symbol.asyncIterator](): AsyncIterator<StreamedMessagePart> {
      for (const part of parts) {
        yield part;
      }
    },
  };
}

// Runs the REAL kosong generate() over a scripted provider stream so think-only
// and empty responses exercise kosong's actual APIEmptyResponseError path rather
// than a mocked generate function that throws directly.
function realKosongGenerate(
  script: (attempt: number, history: readonly Message[], provider: ChatProvider) => StreamedMessage,
): GenerateFn {
  let attempt = 0;
  return (chat, systemPrompt, tools, history, callbacks, options) => {
    attempt += 1;
    const currentAttempt = attempt;
    const provider: ChatProvider = {
      name: chat.name,
      modelName: chat.modelName,
      thinkingEffort: chat.thinkingEffort,
      generate: () => Promise.resolve(script(currentAttempt, history, chat)),
      withThinking(effort) {
        return { ...provider, thinkingEffort: effort };
      },
    };
    return runKosongGenerate(provider, systemPrompt, tools, history, callbacks, options);
  };
}

const alwaysCompactOnce: CompactionStrategy = {
  shouldCompact: () => true,
  shouldBlock: () => true,
  shouldAsyncCompact: () => false,
  computeCompactCount: (messages: readonly Message[]) => messages.length,
  reduceCompactOnOverflow: (messages: readonly Message[]) => messages.length,
  checkAfterStep: true,
  maxCompactionPerTurn: 1,
  maxOverflowCompactionAttempts: 3,
  asyncTriggerRatio: 0.5,
  frozenZoneSize: 2,
};

const parallelCompactAll: CompactionStrategy = {
  ...alwaysCompactOnce,
  parallelBlockThreshold: 1,
  parallelBlockTarget: 1,
};

function missingToolCall(): ToolCall {
  return {
    type: 'function',
    id: 'call_missing',
    name: 'MissingTool',
    arguments: '{}',
  };
}

function testCompactionStrategy(maxSize: number = 1_000): DefaultCompactionStrategy {
  return new DefaultCompactionStrategy(() => maxSize, {
    ...DEFAULT_COMPACTION_CONFIG,
    reservedContextSize: 0,
    maxRecentMessages: 10,
  });
}

function emptyCompactionPlan(compactedTokens: number): CompactionPlan {
  return {
    algorithmVersion: CONTEXT_COMPACTION_V2_VERSION,
    compactedCount: 1,
    compactedTokens,
    retainedTokens: 0,
    actions: [],
    rawRefs: [],
    qualityWarnings: [],
  };
}

function installRecordingMemory(
  agent: ReturnType<typeof testAgent>['agent'],
): AgentMemoryRuntime & { readonly savedInputs: readonly MemoryCreateInput[] } {
  const savedInputs: MemoryCreateInput[] = [];
  const memory: AgentMemoryRuntime & { readonly savedInputs: readonly MemoryCreateInput[] } = {
    savedInputs,
    isEnabled: () => true,
    search: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    remember: vi.fn(async (input: MemoryCreateInput) => {
      savedInputs.push(input);
      return fakeMemoryRecord(input, savedInputs.length);
    }),
    update: vi.fn(),
    forget: vi.fn().mockResolvedValue(false),
    getInjection: vi.fn().mockResolvedValue(undefined),
    recordTurn: vi.fn().mockResolvedValue([]),
  };
  (agent as unknown as { memory: AgentMemoryRuntime }).memory = memory;
  agent.tools.refreshBuiltinTools();
  return memory;
}

function fakeMemoryRecord(input: MemoryCreateInput, index: number): MemoryRecord {
  const now = Date.now();
  return {
    id: `memory-${String(index)}`,
    kind: input.kind,
    scope: input.scope ?? 'workspace',
    scopeKey: input.scopeKey,
    subject: input.subject,
    content: input.content,
    tags: input.tags ?? [],
    confidence: input.confidence ?? 0.8,
    importance: input.importance ?? 0.5,
    status: 'active',
    source: input.source ?? { kind: 'auto' },
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    validFrom: input.validFrom,
    validTo: input.validTo,
    supersedes: [],
    metadata: input.metadata ?? {},
  };
}

function overflowOnlyCompactionStrategy(maxSize: number = 14): DefaultCompactionStrategy {
  return new DefaultCompactionStrategy(() => maxSize, {
    ...DEFAULT_COMPACTION_CONFIG,
    triggerRatio: Infinity,
    blockRatio: Infinity,
    reservedContextSize: 0,
    maxRecentMessages: 3,
    absoluteTriggerTokens: 200_000,
  });
}

function textMessage(role: 'user' | 'assistant', text: string): Message {
  return {
    role,
    content: [{ type: 'text', text }],
    toolCalls: [],
  };
}

function retainedLiveHistory(
  history: Array<{ readonly role: string; readonly text: string }>,
): Array<{ readonly role: string; readonly text: string }> {
  return history.filter(
    (entry) =>
      !entry.text.includes('# SuperLiora Context Compaction v2 Memory') &&
      !entry.text.startsWith('<system-reminder>') &&
      !entry.text.startsWith('<current-time-reminder>') &&
      !entry.text.startsWith('<auto-mode-') &&
      !entry.text.startsWith('<plan-mode-reminder>'),
  );
}

function compactionSummaryEntry(
  history: Array<{ readonly role: string; readonly text: string }>,
): { readonly role: string; readonly text: string } | undefined {
  return (
    history.find((entry) => entry.text.includes('# SuperLiora Context Compaction v2 Memory'))
    ?? history.find((entry) => entry.text.includes('## Compacted Narrative'))
    ?? history.at(-1)
  );
}

function compactedSummaryText(
  history: Array<{ readonly role: string; readonly text: string }>,
): string {
  return compactionSummaryEntry(history)?.text ?? '';
}

function expectCompactedAssistant(
  entry: { readonly role: string; readonly text: string } | undefined,
  expectedNarrative: string,
): void {
  expect(entry?.role).toBe('user');
  expect(entry?.text).toContain('# SuperLiora Context Compaction v2 Memory');
  expect(entry?.text).toContain(expectedNarrative);
}

function messageText(message: Message | undefined): string {
  return message?.content.map((part) => (part.type === 'text' ? part.text : '')).join('') ?? '';
}

function messageTextsContain(
  messages: readonly Message[] | undefined,
  expectedText: string,
): boolean {
  return messages?.some((message) => messageText(message).includes(expectedText)) ?? false;
}

function contextOSInjectionText(messages: readonly Message[] | undefined): string | undefined {
  return messages
    ?.map(messageText)
    .find((text) => text.includes('<context_os_pages'));
}

function contextOSInjectionBlockText(messages: readonly Message[] | undefined): string | undefined {
  const text = contextOSInjectionText(messages);
  if (text === undefined) return undefined;
  const start = text.indexOf('<context_os_pages');
  const end = text.indexOf('</context_os_pages>');
  if (start === -1 || end === -1) return undefined;
  return text.slice(start, end + '</context_os_pages>'.length);
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? '';
}

function appendLargeToolExchange(ctx: TestAgentContext, index: number): void {
  const stepUuid = `large-tool-step-${String(index)}`;
  const toolCallId = `call_lookup_${String(index)}`;
  ctx.agent.context.appendUserMessage([{ type: 'text', text: `lookup something ${String(index)}` }]);
  ctx.dispatch({
    type: 'context.append_loop_event',
    event: { type: 'step.begin', uuid: stepUuid, turnId: '', step: index },
  });
  ctx.dispatch({
    type: 'context.append_loop_event',
    event: {
      type: 'tool.call',
      uuid: toolCallId,
      turnId: '',
      step: index,
      stepUuid,
      toolCallId,
      name: 'Lookup',
      args: { query: `moon-${String(index)}` },
    },
  });
  ctx.dispatch({
    type: 'context.append_loop_event',
    event: {
      type: 'step.end',
      uuid: stepUuid,
      turnId: '',
      step: index,
      finishReason: 'tool_use',
    },
  });
  ctx.dispatch({
    type: 'context.append_loop_event',
    event: {
      type: 'tool.result',
      parentUuid: toolCallId,
      toolCallId,
      result: { output: `lookup result ${String(index)}\n${'payload '.repeat(160)}` },
    },
  });
}

function hookPayloadLoggerCommand(logPath: string): string {
  // Write the hook script to a file and run it with node, instead of
  // `node -e <json>` — cmd.exe on Windows mangles the escaped quotes in the
  // inline form and corrupts the script before it can run.
  const scriptPath = `${logPath}.cjs`;
  const script = [
    "const fs = require('node:fs');",
    "let input = '';",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => {",
    `  fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(JSON.parse(input)) + '\\n');`,
    '});',
  ].join('');
  writeFileSync(scriptPath, script);
  return `${process.execPath} ${scriptPath}`;
}

function readHookPayloads(logPath: string): Array<Record<string, unknown>> {
  if (!existsSync(logPath)) return [];
  const text = readFileSync(logPath, 'utf-8').trim();
  if (text.length === 0) return [];
  return text.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

function inputHistorySnapshot(history: readonly Message[]): string[] {
  return history.map((message) => {
    const text = message.content
      .map((part) => (part.type === 'text' ? normalizeInputText(part.text) : ''))
      .join('');
    return `${message.role}: ${text}`;
  });
}

function normalizeInputText(text: string): string {
  if (
    text.toLowerCase().includes('compact this conversation context') ||
    text.includes('first-person handoff note') ||
    text.includes('You are about to run out of context') ||
    text.includes('Write a handoff so you can continue') ||
    text.includes('<!-- Compression Priorities (in order) -->')
  ) {
    return '<compaction-instruction>';
  }
  if (text.includes('<current_time>') && text.includes('Authoritative host clock')) {
    return '<current-time-reminder>';
  }
  if (text.includes('Auto permission mode is active.')) return '<auto-mode-enter-reminder>';
  if (text.includes('Auto permission mode is no longer active.')) return '<auto-mode-exit-reminder>';
  if (
    text.includes('Plan mode is active. MUST NOT edit') &&
    text.includes('Plan file:')
  ) {
    return '<plan-mode-reminder>';
  }
  return text;
}
