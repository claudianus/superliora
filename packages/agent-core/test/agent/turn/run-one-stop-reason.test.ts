import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../../src/agent';
import { TurnTelemetry } from '../../../src/agent/turn/telemetry';
import { runOneTurnFlow } from '../../../src/agent/turn/run-one';
import * as stepLoop from '../../../src/agent/turn/step-loop';
import { USER_PROMPT_ORIGIN } from '../../../src/agent/context';
import { testKaos } from '../../fixtures/test-kaos';

vi.mock('../../../src/agent/turn/step-loop', async (importOriginal) => {
  const actual = await importOriginal<typeof stepLoop>();
  return { ...actual };
});

describe('runOneTurnFlow — turn.ended stopReason propagation', () => {
  it('marks turn.ended with stopReason max_tokens when the provider truncated the output', async () => {
    vi.spyOn(stepLoop, 'runTurnStepLoop').mockResolvedValue('max_tokens');
    const agent = new Agent({ kaos: testKaos });
    const emitted: unknown[] = [];
    vi.spyOn(agent, 'emitEvent').mockImplementation((event) => {
      emitted.push(event);
    });

    const result = await runOneTurnFlow(
      {
        agent,
        turnTelemetry: new TurnTelemetry(agent),
        assistantThinkScrubber: { reset: () => {} },
        flushSteerBuffer: () => false,
        getActiveTurn: () => null,
        releaseActiveTurn: () => {},
      },
      1,
      [{ type: 'text', text: 'continue this long answer' }],
      USER_PROMPT_ORIGIN,
      new AbortController().signal,
    );

    const ended = result.event as { type: string; reason: string; stopReason?: string };
    expect(ended.type).toBe('turn.ended');
    expect(ended.reason).toBe('completed');
    expect(ended.stopReason).toBe('max_tokens');
    const emittedEnded = emitted.find(
      (event) => (event as { type: string }).type === 'turn.ended',
    ) as { stopReason?: string } | undefined;
    expect(emittedEnded?.stopReason).toBe('max_tokens');
    vi.restoreAllMocks();
  });

  it('omits stopReason for a normal end_turn turn', async () => {
    vi.spyOn(stepLoop, 'runTurnStepLoop').mockResolvedValue('end_turn');
    const agent = new Agent({ kaos: testKaos });
    const emitted: unknown[] = [];
    vi.spyOn(agent, 'emitEvent').mockImplementation((event) => {
      emitted.push(event);
    });

    const result = await runOneTurnFlow(
      {
        agent,
        turnTelemetry: new TurnTelemetry(agent),
        assistantThinkScrubber: { reset: () => {} },
        flushSteerBuffer: () => false,
        getActiveTurn: () => null,
        releaseActiveTurn: () => {},
      },
      1,
      [{ type: 'text', text: 'hi' }],
      USER_PROMPT_ORIGIN,
      new AbortController().signal,
    );

    const ended = result.event as { type: string; reason: string; stopReason?: string };
    expect(ended.type).toBe('turn.ended');
    expect(ended.reason).toBe('completed');
    expect('stopReason' in ended && ended.stopReason !== undefined).toBe(false);
    vi.restoreAllMocks();
  });
});
