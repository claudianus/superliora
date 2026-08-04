import { randomUUID } from 'node:crypto';

import type { Logger } from '#/logging/types';
import type { ChatProvider, GenerateOptions, Message, Tool } from '@superliora/kosong';

import type { LLMRequestLogFields } from '../loop';

export type GenerateOptionsWithRequestLogFields = GenerateOptions & {
  readonly requestLogFields?: LLMRequestLogFields;
  readonly runtimeModelAlias?: string;
  readonly runtimeCredentialLabel?: string;
};

/** Correlation id for one generate call (request → open → first_token → end). */
export type LlmRequestId = string;

export class LlmRequestLogger {
  private lastConfigLogSignature: string | undefined;
  /** Reference cache: tool definitions rarely change within a session. */
  private lastToolsRef: readonly Tool[] | undefined;
  private lastToolsSigJson: string | undefined;

  constructor(private readonly log: Logger) {}

  /**
   * Log request start and return a requestId used for lifecycle follow-ups
   * (`llm open`, `llm first_token`, `llm response`, `llm request failed`).
   */
  logRequest(input: {
    readonly provider: ChatProvider;
    readonly modelAlias?: string;
    readonly systemPrompt: string;
    readonly tools: readonly Tool[];
    readonly messages: readonly Message[];
    readonly fields: LLMRequestLogFields | undefined;
  }): LlmRequestId {
    const requestId = randomUUID().slice(0, 8);
    const { provider, modelAlias, systemPrompt, tools, messages, fields } = input;
    const requestLogFields = fields ?? {};
    const config = {
      provider: provider.name,
      model: provider.modelName,
      modelAlias,
      thinkingEffort: provider.thinkingEffort ?? undefined,
      systemPromptChars: systemPrompt.length,
      toolCount: tools.length,
    };
    const signature = JSON.stringify({
      ...config,
      systemPromptHash: fingerprint(systemPrompt),
      toolsHash: fingerprint(this.toolsSignatureJson(tools)),
    });
    if (signature !== this.lastConfigLogSignature) {
      this.lastConfigLogSignature = signature;
      this.log.info('llm config', { requestId, ...requestLogFields, ...config });
    }

    const partialMessageCount = messages.filter((message) => message.partial === true).length;
    const requestFields: Record<string, unknown> = {
      requestId,
      ...requestLogFields,
      provider: provider.name,
      model: provider.modelName,
      ...(modelAlias !== undefined ? { modelAlias } : {}),
    };
    if (partialMessageCount > 0) requestFields['partialMessageCount'] = partialMessageCount;
    this.log.info('llm request', requestFields);
    return requestId;
  }

  /**
   * Serialize tool definitions once per tools-array reference. The signature
   * only feeds log dedup, but the tool schema runs to hundreds of KB, so a
   * full stringify on every generate call would block the event loop on
   * step-heavy turns.
   */
  private toolsSignatureJson(tools: readonly Tool[]): string {
    if (tools === this.lastToolsRef && this.lastToolsSigJson !== undefined) {
      return this.lastToolsSigJson;
    }
    const json = JSON.stringify(toolSignature(tools));
    this.lastToolsRef = tools;
    this.lastToolsSigJson = json;
    return json;
  }

  logOpen(requestId: string, fields?: LLMRequestLogFields): void {
    this.log.info('llm open', { requestId, ...fields, phase: 'stream_open' });
  }

  logFirstToken(requestId: string, fields: LLMRequestLogFields & { readonly ttftMs: number }): void {
    this.log.info('llm first_token', { requestId, ...fields, phase: 'first_token' });
  }

  logResponse(
    requestId: string,
    fields: Record<string, unknown> & { readonly turnStep?: string },
  ): void {
    this.log.info('llm response', { requestId, ...fields, phase: 'complete' });
  }

  logFailure(
    requestId: string,
    fields: Record<string, unknown> & {
      readonly errorName?: string;
      readonly errorMessage?: string;
      readonly elapsedMs?: number;
      readonly phase?: string;
    },
  ): void {
    this.log.warn('llm request failed', { requestId, ...fields });
  }
}

export function splitGenerateOptions(options: GenerateOptionsWithRequestLogFields | undefined): {
  readonly requestLogFields: LLMRequestLogFields | undefined;
  readonly runtimeModelAlias: string | undefined;
  readonly runtimeCredentialLabel: string | undefined;
  readonly generateOptions: GenerateOptions | undefined;
} {
  if (options === undefined) {
    return {
      requestLogFields: undefined,
      runtimeModelAlias: undefined,
      runtimeCredentialLabel: undefined,
      generateOptions: undefined,
    };
  }
  const { requestLogFields, ...generateOptions } = options;
  const { runtimeModelAlias, runtimeCredentialLabel, ...providerGenerateOptions } = generateOptions;
  return {
    requestLogFields,
    runtimeModelAlias,
    runtimeCredentialLabel,
    generateOptions: providerGenerateOptions,
  };
}

function toolSignature(tools: readonly Tool[]) {
  return tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

/**
 * Cheap change-detection fingerprint (FNV-1a + length). The value only
 * dedupes the `llm config` log line — crypto strength is unnecessary and a
 * sha256 over the full system prompt on every request is pure overhead.
 */
function fingerprint(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    const codePoint = content.codePointAt(i);
    if (codePoint === undefined) continue;
    hash ^= codePoint;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${String(content.length)}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
