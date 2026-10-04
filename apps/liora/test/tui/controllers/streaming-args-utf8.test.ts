import { describe, expect, it } from 'vitest';
import { STREAMING_ARGS_PREVIEW_MAX_BYTES as CAP } from '#/tui/constant/streaming';
import { accumulateStreamingToolCallDelta, type StreamingUIToolRegistryState } from '#/tui/controllers/streaming-ui/tool-registry';
import { ToolCallSubagentState } from '#/tui/components/messages/tool-call/subagent-state';
import { extractPartialStringField } from '#/tui/components/messages/tool-call/format';
import { parseStreamingArgs } from '#/tui/utils/event-payload';

function streams() {
  const main = {
    streamingToolCallArguments: new Map(), activeToolCalls: new Map(),
    flushState: { pendingToolCallFlushIds: new Set(), dirtyMarksSinceFlush: 0 },
  } as unknown as StreamingUIToolRegistryState;
  const child = new ToolCallSubagentState();
  return {
    append(delta: string) {
      accumulateStreamingToolCallDelta(main, 'main', 'Bash', delta);
      child.appendSubToolCallDelta({ id: 'child', name: 'Bash', argumentsPart: delta });
    },
    texts() {
      return [main.streamingToolCallArguments.get('main')!.argumentsText, child.ongoingSubCalls.get('child')!.streamingArguments!];
    },
    child,
  };
}

describe('main and worker UTF-8 argument prefixes', () => {
  it('bounds CJK to 64 KiB and freezes a two-byte gap without ASCII backfill', () => {
    const stream = streams();
    const prefix = '{"command":"' + 'a'.repeat(CAP - 14);
    expect(Buffer.byteLength(prefix)).toBe(CAP - 2);
    stream.append(prefix);
    stream.append('界');
    stream.append('x"}');
    for (const text of stream.texts()) {
      expect(text).toBe(prefix);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(CAP);
      expect(text.isWellFormed()).toBe(true);
    }
    const huge = streams();
    huge.append('界'.repeat(CAP));
    const frozen = huge.texts();
    for (const text of frozen) expect(Buffer.byteLength(text)).toBe(65535);
    huge.append('x');
    expect(huge.texts()).toEqual(frozen);
  });

  it('keeps an initial emoji and CJK prefix frozen with one spare byte', () => {
    const stream = streams();
    const prefix = '😀é' + '界'.repeat((CAP - 7) / 3);
    expect(Buffer.byteLength(prefix)).toBe(CAP - 1);
    stream.append(prefix);
    stream.append('界');
    stream.append('A');
    expect(stream.texts()).toEqual([prefix, prefix]);
  });

  it.each([0, CAP - 16, CAP - 15])('holds a split high surrogate with %i padding bytes', (padding) => {
    const stream = streams();
    const prefix = '{"command":"' + 'a'.repeat(padding);
    stream.append(prefix + '\uD83D');
    expect(stream.texts()).toEqual([prefix, prefix]);
    stream.append('\uDE00');
    const expected = Buffer.byteLength(prefix) + 4 <= CAP ? prefix + '😀' : prefix;
    expect(stream.texts()).toEqual([expected, expected]);
    stream.append('x');
    for (const text of stream.texts()) {
      expect(text.isWellFormed()).toBe(true);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(CAP);
      if (expected === prefix) expect(text).toBe(prefix);
    }
  });

  it('decodes escaped pairs across deltas without exposing a dangling surrogate', () => {
    const stream = streams();
    stream.append('{"command":"echo \\uD83D');
    for (const text of stream.texts()) expect(extractPartialStringField(text, 'command')).toBe('echo ');
    expect(stream.child.subToolActivities.get('child')!.args['command']).toBe('echo ');
    stream.append('\\uDE');
    for (const text of stream.texts()) expect(extractPartialStringField(text, 'command')).toBe('echo ');
    stream.append('00"}');
    for (const text of stream.texts()) {
      expect(extractPartialStringField(text, 'command')).toBe('echo 😀');
      expect(parseStreamingArgs(text)['command']).toBe('echo 😀');
    }
    expect(stream.child.subToolActivities.get('child')!.args['command']).toBe('echo 😀');
  });
});
