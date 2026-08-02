import { createHash, randomUUID } from 'node:crypto';

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
      toolsHash: fingerprint(JSON.stringify(toolSignature(tools))),
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

function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
