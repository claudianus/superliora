import { randomUUID } from 'node:crypto';

import type { StreamedMessagePart } from '#/message';
import type { FinishReason, StreamedMessage } from '#/provider';
import type { TokenUsage } from '#/usage';

import type { CursorStreamEvent } from './client';
import { recoverToolCallsFromCursorText, sanitizeCursorAssistantText } from './sanitize';

export class CursorStreamedMessage implements StreamedMessage {
  private _id: string | null = randomUUID();
  private _usage: TokenUsage | null = null;
  private _finishReason: FinishReason | null = null;
  private _rawFinishReason: string | null = null;
  private readonly _iter: AsyncGenerator<StreamedMessagePart>;

  constructor(events: AsyncIterable<CursorStreamEvent>) {
    this._iter = this._convert(events);
  }

  get id(): string | null {
    return this._id;
  }

  get usage(): TokenUsage | null {
    return this._usage;
  }

  get finishReason(): FinishReason | null {
    return this._finishReason;
  }

  get rawFinishReason(): string | null {
    return this._rawFinishReason;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamedMessagePart> {
    yield* this._iter;
  }

  private async *_convert(
    events: AsyncIterable<CursorStreamEvent>,
  ): AsyncGenerator<StreamedMessagePart> {
    let sawTool = false;
    let toolIndex = 0;
    let textBuf = '';
    let holdForProtocol = false;
    const emittedKeys = new Set<string>();

    const emitTool = function* (
      name: string,
      inputJson: string,
      toolCallId: string | undefined,
      index: number,
    ): Generator<StreamedMessagePart> {
      const key = `${name}:${inputJson}`;
      if (emittedKeys.has(key)) return;
      emittedKeys.add(key);
      const id = toolCallId && toolCallId.length > 0 ? toolCallId : randomUUID();
      yield {
        type: 'function',
        id,
        name,
        arguments: null,
        _streamIndex: index,
      };
      yield {
        type: 'tool_call_part',
        argumentsPart: inputJson,
        index,
      };
    };

    const flushHeldText = function* (): Generator<StreamedMessagePart> {
      if (textBuf.length === 0) return;
      const raw = textBuf;
      textBuf = '';
      holdForProtocol = false;
      const recovered = recoverToolCallsFromCursorText(raw);
      const clean = sanitizeCursorAssistantText(raw);
      if (clean.length > 0) {
        yield { type: 'text', text: clean };
      }
      for (const call of recovered) {
        sawTool = true;
        yield* emitTool(call.name, call.inputJson, call.toolCallId, toolIndex++);
      }
    };

    for await (const event of events) {
      switch (event.type) {
        case 'text': {
          if (
            !holdForProtocol &&
            (event.text.includes('<') || event.text.includes('mcp_superliora'))
          ) {
            holdForProtocol = true;
          }
          if (holdForProtocol) {
            textBuf += event.text;
          } else {
            yield { type: 'text', text: event.text };
          }
          break;
        }
        case 'think':
          yield { type: 'think', think: event.text };
          break;
        case 'tool_call': {
          yield* flushHeldText();
          sawTool = true;
          yield* emitTool(event.name, event.inputJson, event.toolCallId, toolIndex++);
          break;
        }
        case 'end': {
          yield* flushHeldText();
          if (sawTool) {
            this._finishReason = 'tool_calls';
            this._rawFinishReason = 'tool_calls';
          } else {
            this._finishReason = 'completed';
            this._rawFinishReason = 'completed';
          }
          return;
        }
        default: {
          const exhaustive: never = event;
          void exhaustive;
        }
      }
    }

    yield* flushHeldText();
    if (sawTool) {
      this._finishReason = 'tool_calls';
      this._rawFinishReason = 'tool_calls';
    } else {
      this._finishReason = 'completed';
      this._rawFinishReason = 'completed';
    }
  }
}
