import type { Event, HookResultEvent } from '@superliora/sdk';

import { tln } from '#/cli/i18n';
import type { PromptOutputFormat } from './options';
import type { PromptOutput } from './run-prompt-io';

const PROMPT_BLOCK_BULLET = '• ';
const PROMPT_BLOCK_INDENT = '  ';
const PROMPT_PROGRESS_DELAY_MS = 2_000;

export type PromptProviderRouteSelection = NonNullable<
  Extract<Event, { readonly type: 'turn.step.completed' }>['providerRouteSelection']
>;

export interface PromptTurnWriter {
  startProgress(): void;
  writeAssistantDelta(delta: string): void;
  writeHookResult(event: HookResultEvent): void;
  writeThinkingDelta(delta: string): void;
  writeToolCall(toolCallId: string, name: string, args: unknown): void;
  writeToolCallDelta(
    toolCallId: string,
    name: string | undefined,
    argumentsPart: string | undefined,
  ): void;
  writeToolResult(toolCallId: string, output: unknown): void;
  writeProviderRouteSelection(selection: PromptProviderRouteSelection): void;
  flushAssistant(): void;
  discardAssistant(): void;
  finish(): void;
}

export class PromptTranscriptWriter implements PromptTurnWriter {
  private readonly assistantWriter: PromptBlockWriter;
  private readonly thinkingWriter: PromptBlockWriter;
  private progressTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    stdout: PromptOutput,
    private readonly stderr: PromptOutput,
    private readonly showThinking: boolean,
  ) {
    this.assistantWriter = new PromptBlockWriter(stdout);
    this.thinkingWriter = new PromptBlockWriter(stderr);
  }

  startProgress(): void {
    if (this.showThinking || this.progressTimer !== undefined) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = undefined;
      this.stderr.write(tln('cli.runtime.prompt.working'));
    }, PROMPT_PROGRESS_DELAY_MS);
  }

  writeAssistantDelta(delta: string): void {
    this.clearPendingProgress();
    this.thinkingWriter.finish();
    this.assistantWriter.write(delta);
  }

  writeHookResult(event: HookResultEvent): void {
    this.clearPendingProgress();
    this.thinkingWriter.finish();
    this.assistantWriter.finish();
    this.assistantWriter.write(formatHookResultPlain(event));
    this.assistantWriter.finish();
  }

  writeThinkingDelta(delta: string): void {
    if (!this.showThinking) return;
    this.thinkingWriter.write(delta);
  }

  writeToolCall(): void {
    this.clearPendingProgress();
  }

  writeToolCallDelta(): void {}

  writeToolResult(): void {}

  writeProviderRouteSelection(): void {}

  flushAssistant(): void {}

  discardAssistant(): void {}

  finish(): void {
    this.clearPendingProgress();
    this.thinkingWriter.finish();
    this.assistantWriter.finish();
  }

  private clearPendingProgress(): void {
    if (this.progressTimer === undefined) return;
    clearTimeout(this.progressTimer);
    this.progressTimer = undefined;
  }
}

interface PromptJsonToolCall {
  type: 'function';
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface PromptJsonAssistantMessage {
  role: 'assistant';
  content?: string;
  tool_calls?: PromptJsonToolCall[];
}

interface PromptJsonToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

interface PromptJsonResumeMetaMessage {
  role: 'meta';
  type: 'session.resume_hint';
  session_id: string;
  command: string;
  content: string;
}

interface PromptJsonProviderRouteSelectionMessage {
  role: 'meta';
  type: 'provider.route_selection';
  model_alias: string;
  provider_model: string;
  provider_name?: string;
  credential_label?: string;
  base_url?: string;
}

export function writeResumeHint(
  sessionId: string,
  outputFormat: PromptOutputFormat,
  stdout: PromptOutput,
  stderr: PromptOutput,
): void {
  const command = `liora -r ${sessionId}`;
  const content = `To resume this session: ${command}`;
  if (outputFormat === 'stream-json') {
    const message: PromptJsonResumeMetaMessage = {
      role: 'meta',
      type: 'session.resume_hint',
      session_id: sessionId,
      command,
      content,
    };
    stdout.write(`${JSON.stringify(message)}\n`);
    return;
  }
  stderr.write(`${content}\n`);
}

export class PromptJsonWriter implements PromptTurnWriter {
  private assistantText = '';
  private readonly toolCalls: PromptJsonToolCall[] = [];

  constructor(private readonly stdout: PromptOutput) {}

  startProgress(): void {}

  writeAssistantDelta(delta: string): void {
    this.assistantText += delta;
  }

  writeHookResult(event: HookResultEvent): void {
    this.flushAssistant();
    this.writeJsonLine({
      role: 'assistant',
      content: formatHookResultPlain(event),
    });
  }

  writeThinkingDelta(): void {}

  writeToolCall(toolCallId: string, name: string, args: unknown): void {
    const existing = this.toolCalls.find((toolCall) => toolCall.id === toolCallId);
    if (existing !== undefined) {
      existing.function.name = name;
      existing.function.arguments = stringifyJsonValue(args);
      return;
    }
    this.toolCalls.push({
      type: 'function',
      id: toolCallId,
      function: {
        name,
        arguments: stringifyJsonValue(args),
      },
    });
  }

  writeToolCallDelta(
    toolCallId: string,
    name: string | undefined,
    argumentsPart: string | undefined,
  ): void {
    const toolCall = this.findOrCreateToolCall(toolCallId, name ?? '');
    if (name !== undefined) {
      toolCall.function.name = name;
    }
    if (argumentsPart !== undefined) {
      toolCall.function.arguments += argumentsPart;
    }
  }

  writeToolResult(toolCallId: string, output: unknown): void {
    this.flushAssistant();
    this.writeJsonLine({
      role: 'tool',
      tool_call_id: toolCallId,
      content: stringifyToolOutput(output),
    });
  }

  writeProviderRouteSelection(selection: PromptProviderRouteSelection): void {
    this.flushAssistant();
    this.writeJsonLine({
      role: 'meta',
      type: 'provider.route_selection',
      model_alias: selection.modelAlias,
      provider_model: selection.providerModel,
      ...(selection.providerName !== undefined ? { provider_name: selection.providerName } : {}),
      ...(selection.credentialLabel !== undefined
        ? { credential_label: selection.credentialLabel }
        : {}),
      ...(selection.baseUrl !== undefined ? { base_url: selection.baseUrl } : {}),
    });
  }

  flushAssistant(): void {
    if (this.assistantText.length === 0 && this.toolCalls.length === 0) return;
    const message: PromptJsonAssistantMessage = {
      role: 'assistant',
      content: this.assistantText.length > 0 ? this.assistantText : undefined,
      tool_calls: this.toolCalls.length > 0 ? [...this.toolCalls] : undefined,
    };
    this.writeJsonLine(message);
    this.discardAssistant();
  }

  discardAssistant(): void {
    this.assistantText = '';
    this.toolCalls.length = 0;
  }

  finish(): void {
    this.flushAssistant();
  }

  private findOrCreateToolCall(toolCallId: string, name: string): PromptJsonToolCall {
    const existing = this.toolCalls.find((toolCall) => toolCall.id === toolCallId);
    if (existing !== undefined) return existing;
    const toolCall: PromptJsonToolCall = {
      type: 'function',
      id: toolCallId,
      function: {
        name,
        arguments: '',
      },
    };
    this.toolCalls.push(toolCall);
    return toolCall;
  }

  private writeJsonLine(
    message:
      | PromptJsonAssistantMessage
      | PromptJsonToolMessage
      | PromptJsonProviderRouteSelectionMessage,
  ): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

class PromptBlockWriter {
  private started = false;
  private atLineStart = false;
  private lineWidth = 0;
  private readonly wrapWidth: number | undefined;

  constructor(private readonly output: PromptOutput) {
    this.wrapWidth =
      typeof output.columns === 'number' && output.columns > PROMPT_BLOCK_INDENT.length + 1
        ? output.columns
        : undefined;
  }

  write(chunk: string): void {
    if (chunk.length === 0) return;
    let rendered = this.start();
    for (const char of chunk) {
      if (this.atLineStart && char !== '\n') {
        rendered += PROMPT_BLOCK_INDENT;
        this.atLineStart = false;
        this.lineWidth = PROMPT_BLOCK_INDENT.length;
      }
      const charWidth = visibleCharWidth(char);
      if (
        this.wrapWidth !== undefined &&
        !this.atLineStart &&
        char !== '\n' &&
        this.lineWidth + charWidth > this.wrapWidth
      ) {
        rendered += `\n${PROMPT_BLOCK_INDENT}`;
        this.lineWidth = PROMPT_BLOCK_INDENT.length;
      }
      rendered += char;
      if (char === '\n') {
        this.atLineStart = true;
        this.lineWidth = 0;
      } else {
        this.lineWidth += charWidth;
      }
    }
    this.output.write(rendered);
  }

  finish(): void {
    if (!this.started) return;
    this.output.write(this.atLineStart ? '\n' : '\n\n');
    this.started = false;
    this.atLineStart = false;
    this.lineWidth = 0;
  }

  private start(): string {
    if (this.started) return '';
    this.started = true;
    this.atLineStart = false;
    this.lineWidth = PROMPT_BLOCK_BULLET.length;
    return PROMPT_BLOCK_BULLET;
  }
}

function visibleCharWidth(char: string): number {
  return char === '\t' ? 4 : 1;
}

function formatHookResultPlain(event: HookResultEvent): string {
  return `${formatHookResultTitle(event)}\n\n${formatHookResultBody(event)}`;
}

function formatHookResultTitle(event: HookResultEvent): string {
  return `${event.hookEvent} hook${event.blocked === true ? ' blocked' : ''}`;
}

function formatHookResultBody(event: HookResultEvent): string {
  const content = event.content.trim();
  return content.length === 0 ? '(empty)' : content;
}

function stringifyJsonValue(value: unknown): string {
  if (typeof value === 'string') return value;
  const json = JSON.stringify(value);
  return json ?? '';
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  const json = JSON.stringify(output);
  return json ?? String(output);
}

export function createPromptTurnWriter(
  outputFormat: PromptOutputFormat,
  stdout: PromptOutput,
  stderr: PromptOutput,
  showThinking: boolean,
): PromptTurnWriter {
  return outputFormat === 'stream-json'
    ? new PromptJsonWriter(stdout)
    : new PromptTranscriptWriter(stdout, stderr, showThinking);
}
