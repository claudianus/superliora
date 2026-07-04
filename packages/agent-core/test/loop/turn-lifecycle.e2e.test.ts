/**
 * Turn-level lifecycle invariants of `runTurn`.
 *
 * These tests treat the loop as a black box: they drive `runTurn` only
 * through its public input contract and assert against the public output
 * (`TurnResult`, `LoopEvent`s, transcript writes, `Tool.execute`
 * calls). Internal modules / classes / file layout are intentionally not
 * referenced.
 */

import { inputTotal } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import { ErrorCodes, LioraError } from '../../src/errors';
import type { Logger, LogPayload } from '../../src/logging';
import {
  makeEndTurnResponse,
  makeMaxTokensResponse,
  makeResponse,
  makeTextParts,
  makeToolCall,
  makeToolUseResponse,
} from './fixtures/fake-llm';
import { runTurn, runTurnExpectingThrow } from './fixtures/helpers';
import { EchoTool } from './fixtures/tools';

interface CapturedLogEntry {
  readonly level: 'error' | 'warn' | 'info' | 'debug';
  readonly message: string;
  readonly payload?: LogPayload;
}

describe('runTurn — turn lifecycle', () => {
  it('returns end_turn after a single non-tool step', async () => {
    const { result, llm, sink } = await runTurn({
      responses: [makeEndTurnResponse('hello', { inputOther: 5, output: 7 })],
    });

    expect(result.stopReason).toBe('end_turn');
    expect(result.steps).toBe(1);
    expect(inputTotal(result.usage)).toBe(5);
    expect(result.usage.output).toBe(7);
    expect(llm.callCount).toBe(1);
    // step.begin and step.end at minimum, in that order
    expect(sink.count('step.begin')).toBe(1);
    expect(sink.count('step.end')).toBe(1);
    const types = sink.typesIn();
    expect(types.indexOf('step.begin')).toBeLessThan(types.indexOf('step.end'));
  });

  it('emits selected provider route metadata on step completion', async () => {
    const { sink } = await runTurn({
      responses: [
        {
          ...makeEndTurnResponse('hello', { inputOther: 5, output: 7 }),
          providerRouteSelection: {
            modelAlias: 'backup',
            providerName: 'anthropic',
            credentialLabel: 'api_key:2',
            providerModel: 'claude-backup',
            baseUrl: 'https://anthropic.example/v1',
          },
        },
      ],
    });

    expect(sink.byType('step.end')[0]?.providerRouteSelection).toEqual({
      modelAlias: 'backup',
      providerName: 'anthropic',
      credentialLabel: 'api_key:2',
      providerModel: 'claude-backup',
      baseUrl: 'https://anthropic.example/v1',
    });
  });

  it('continues across tool_use steps until end_turn', async () => {
    const echo = new EchoTool();
    const { result, llm, sink, context } = await runTurn({
      tools: [echo],
      responses: [
        makeToolUseResponse([makeToolCall('echo', { text: 'hi' }, 'tc-1')], {
          inputOther: 1,
          output: 2,
        }),
        makeToolUseResponse([makeToolCall('echo', { text: 'again' }, 'tc-2')], {
          inputOther: 3,
          output: 4,
        }),
        makeEndTurnResponse('done', { inputOther: 5, output: 6 }),
      ],
    });

    expect(result.stopReason).toBe('end_turn');
    expect(result.steps).toBe(3);
    expect(inputTotal(result.usage)).toBe(1 + 3 + 5);
    expect(result.usage.output).toBe(2 + 4 + 6);
    expect(llm.callCount).toBe(3);
    expect(echo.calls.map((c) => c.id)).toEqual(['tc-1', 'tc-2']);
    // Three step envelopes were recorded
    expect(context.stepBegins().map((s) => s.step)).toEqual([1, 2, 3]);
    expect(context.stepEnds().map((s) => s.step)).toEqual([1, 2, 3]);
    // tool_use never escapes as the final stopReason
    expect(sink.byType('step.end').length).toBe(3);
  });

  it('returns max_tokens when the LLM signals it', async () => {
    const { result, sink } = await runTurn({
      responses: [makeMaxTokensResponse('partial...', { inputOther: 10, output: 20 })],
    });

    expect(result.stopReason).toBe('max_tokens');
    expect(result.steps).toBe(1);
    expect(result.usage).toEqual({
      inputOther: 10,
      output: 20,
      inputCacheRead: 0,
      inputCacheCreation: 0,
    });
    expect(sink.count('turn.interrupted')).toBe(0);
  });

  it('logs structured provider timing when stream stats are available', async () => {
    const { logger, entries } = captureLogs();

    await runTurn({
      turnId: 'turn-timing',
      log: logger,
      responses: [
        {
          ...makeEndTurnResponse('hello', { inputOther: 3, output: 11 }),
          streamTiming: {
            firstTokenLatencyMs: 50,
            requestBuildMs: 7,
            serverFirstTokenMs: 43,
            streamDurationMs: 120,
            serverDecodeMs: 80,
            clientConsumeMs: 40,
          },
        },
      ],
    });

    expect(entries).toEqual([
      {
        level: 'info',
        message: 'llm response',
        payload: {
          turnStep: 'turn-timing/1',
          ttftMs: 50,
          requestBuildMs: 7,
          serverFirstTokenMs: 43,
          streamDurationMs: 120,
          serverDecodeMs: 80,
          clientConsumeMs: 40,
          outputTokens: 11,
        },
      },
    ]);
  });

  it('preserves provider terminal diagnostics when no tool calls are present', async () => {
    const { result, sink } = await runTurn({
      responses: [
        {
          ...makeResponse(makeTextParts('blocked'), [], 'filtered'),
          rawFinishReason: 'content_filter',
        },
      ],
    });

    const stepEnd = sink.byType('step.end')[0];
    expect(result.stopReason).toBe('filtered');
    expect(stepEnd?.finishReason).toBe('filtered');
    expect(stepEnd?.providerFinishReason).toBe('filtered');
    expect(stepEnd?.rawFinishReason).toBe('content_filter');
  });

  it('treats provider tool_calls without tool call structure as unknown', async () => {
    const { result } = await runTurn({
      responses: [makeResponse(makeTextParts('done'), [], 'tool_use')],
    });

    expect(result.stopReason).toBe('unknown');
  });

  it('derives tool_use from tool call structure when provider reports completed', async () => {
    const echo = new EchoTool();
    const { result, llm } = await runTurn({
      tools: [echo],
      responses: [
        makeResponse([], [makeToolCall('echo', { text: 'hi' }, 'tc-completed')], 'end_turn'),
        makeEndTurnResponse('done'),
      ],
    });

    expect(result.stopReason).toBe('end_turn');
    expect(llm.callCount).toBe(2);
    expect(echo.calls.map((c) => c.id)).toEqual(['tc-completed']);
  });

  it('does not execute tool calls when provider reports a terminal diagnostic', async () => {
    const echo = new EchoTool();
    const { result, sink } = await runTurn({
      tools: [echo],
      responses: [
        makeResponse(
          makeTextParts('blocked'),
          [makeToolCall('echo', { text: 'should-not-run' }, 'tc-filtered')],
          'filtered',
        ),
      ],
    });

    expect(result.stopReason).toBe('filtered');
    expect(echo.calls).toEqual([]);
    expect(sink.count('tool.call')).toBe(0);
    expect(sink.count('tool.result')).toBe(0);
  });

  it('throws LioraError(loop.max_steps_exceeded) when steps reach maxSteps', async () => {
    const echo = new EchoTool();
    const { error, sink } = await runTurnExpectingThrow({
      maxSteps: 2,
      tools: [echo],
      responses: [
        makeToolUseResponse([makeToolCall('echo', { text: '1' }, 'a')]),
        makeToolUseResponse([makeToolCall('echo', { text: '2' }, 'b')]),
        // The loop throws before requesting a third step.
      ],
    });

    expect(error).toBeInstanceOf(LioraError);
    expect((error as LioraError).code).toBe(ErrorCodes.LOOP_MAX_STEPS_EXCEEDED);
    expect((error as LioraError).details).toEqual({ maxSteps: 2 });
    // turn.interrupted{reason:'max_steps'} is emitted before the throw
    const interruptedTypes = sink.byType('turn.interrupted').map((e) => e.reason);
    expect(interruptedTypes).toContain('max_steps');
  });

  it('does not enforce a max step limit when maxSteps is 0', async () => {
    const echo = new EchoTool();
    const { result } = await runTurn({
      maxSteps: 0,
      tools: [echo],
      responses: [
        makeToolUseResponse([makeToolCall('echo', { text: '1' }, 'a')]),
        makeToolUseResponse([makeToolCall('echo', { text: '2' }, 'b')]),
        makeEndTurnResponse('done'),
      ],
    });

    expect(result.stopReason).toBe('end_turn');
    expect(result.steps).toBe(3);
    expect(echo.calls).toEqual([
      { id: 'a', turnId: 'turn-1', args: { text: '1' } },
      { id: 'b', turnId: 'turn-1', args: { text: '2' } },
    ]);
  });

  it('does not enforce a max step limit when maxSteps is omitted', async () => {
    const echo = new EchoTool();
    const { result } = await runTurn({
      tools: [echo],
      responses: [
        makeToolUseResponse([makeToolCall('echo', { text: '1' }, 'a')]),
        makeToolUseResponse([makeToolCall('echo', { text: '2' }, 'b')]),
        makeToolUseResponse([makeToolCall('echo', { text: '3' }, 'c')]),
        makeToolUseResponse([makeToolCall('echo', { text: '4' }, 'd')]),
        makeEndTurnResponse('done'),
      ],
    });

    expect(result.stopReason).toBe('end_turn');
    expect(result.steps).toBe(5);
    expect(echo.calls).toEqual([
      { id: 'a', turnId: 'turn-1', args: { text: '1' } },
      { id: 'b', turnId: 'turn-1', args: { text: '2' } },
      { id: expect.any(String), turnId: 'turn-1', args: { text: '3' } },
      { id: expect.any(String), turnId: 'turn-1', args: { text: '4' } },
    ]);
  });

  it('aggregates usage across steps including cache fields', async () => {
    const echo = new EchoTool();
    const { result } = await runTurn({
      tools: [echo],
      responses: [
        makeToolUseResponse([makeToolCall('echo', { text: 'a' })], {
          inputOther: 70,
          output: 50,
          inputCacheRead: 10,
          inputCacheCreation: 20,
        }),
        makeEndTurnResponse('done', {
          inputOther: 4,
          output: 3,
          inputCacheRead: 1,
          inputCacheCreation: 2,
        }),
      ],
    });

    expect(inputTotal(result.usage)).toBe(107);
    expect(result.usage.output).toBe(53);
    expect(result.usage.inputCacheRead).toBe(11);
    expect(result.usage.inputCacheCreation).toBe(22);
  });
});

function captureLogs(): { readonly logger: Logger; readonly entries: CapturedLogEntry[] } {
  const entries: CapturedLogEntry[] = [];
  const logger: Logger = {
    error: (message, payload) => {
      entries.push({ level: 'error', message, payload });
    },
    warn: (message, payload) => {
      entries.push({ level: 'warn', message, payload });
    },
    info: (message, payload) => {
      entries.push({ level: 'info', message, payload });
    },
    debug: (message, payload) => {
      entries.push({ level: 'debug', message, payload });
    },
    createChild: () => logger,
  };
  return { logger, entries };
}
