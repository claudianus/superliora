import { randomUUID } from 'node:crypto';

import type { StreamedMessagePart } from '#/message';
import type { FinishReason, StreamedMessage } from '#/provider';
import type { TokenUsage } from '#/usage';

import type { CursorStreamEvent } from './client';

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
    for await (const event of events) {
      switch (event.type) {
        case 'text':
          yield { type: 'text', text: event.text };
          break;
        case 'think':
          yield { type: 'think', think: event.text };
          break;
        case 'tool_call': {
          sawTool = true;
          const id = event.toolCallId && event.toolCallId.length > 0 ? event.toolCallId : randomUUID();
          yield {
            type: 'function',
            id,
            name: event.name,
            arguments: null,
            _streamIndex: 0,
          };
          yield {
            type: 'tool_call_part',
            argumentsPart: event.inputJson,
            index: 0,
          };
          this._finishReason = 'tool_calls';
          this._rawFinishReason = 'tool_calls';
          return;
        }
        case 'end':
          if (!sawTool) {
            this._finishReason = 'completed';
            this._rawFinishReason = 'completed';
          }
          return;
        default: {
          const exhaustive: never = event;
          void exhaustive;
        }
      }
    }
    if (!sawTool) {
      this._finishReason = 'completed';
      this._rawFinishReason = 'completed';
    }
  }
}
