/**
 * Cursor AgentService Connect-RPC chat provider.
 *
 * Uses reverse-engineered Cursor CLI wire details (HTTP/2 Connect + protobuf).
 * Unofficial — Cursor may change endpoints / client-version gates at any time.
 */

import type { Message } from '#/message';
import type {
  ChatProvider,
  GenerateOptions,
  StreamedMessage,
  ThinkingEffort,
} from '#/provider';
import type { Tool } from '#/tool';
import { ChatProviderError } from '#/errors';

import { mergeRequestHeaders, requireProviderApiKey } from '../request-auth';
import { CursorAgentClient } from './client';
import type { CursorAgentTool } from './frames';
import { renderCursorPrompt } from './prompt';
import { CursorStreamedMessage } from './stream';

export interface CursorOptions {
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly defaultHeaders?: Record<string, string>;
  /** Advertised `x-cursor-client-version`; defaults to env or a recent CLI build. */
  readonly clientVersion?: string;
  /** Working directory sent in Cursor environment context. */
  readonly cwd?: string;
}

/** Matches opencodex v2.10 Cursor provider baseUrl. */
const DEFAULT_BASE_URL = 'https://api2.cursor.sh';
const DEFAULT_CLIENT_VERSION = 'cli-2026.07.08-0c04a8a';

export class CursorChatProvider implements ChatProvider {
  readonly name = 'cursor';

  private readonly _model: string;
  private readonly _apiKey: string | undefined;
  private readonly _baseUrl: string;
  private readonly _defaultHeaders: Record<string, string> | undefined;
  private readonly _clientVersion: string;
  private readonly _cwd: string;
  private readonly _thinkingEffort: ThinkingEffort | null;

  constructor(options: CursorOptions, thinkingEffort: ThinkingEffort | null = null) {
    const apiKey = options.apiKey ?? process.env['CURSOR_ACCESS_TOKEN'];
    this._apiKey = apiKey === undefined || apiKey.length === 0 ? undefined : apiKey;
    this._baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;
    this._defaultHeaders = options.defaultHeaders;
    this._model = options.model;
    this._clientVersion =
      options.clientVersion?.trim() ||
      process.env['SUPERLIORA_CURSOR_CLIENT_VERSION']?.trim() ||
      DEFAULT_CLIENT_VERSION;
    this._cwd = options.cwd?.trim() || process.cwd();
    this._thinkingEffort = thinkingEffort;
  }

  get modelName(): string {
    return this._model;
  }

  get thinkingEffort(): ThinkingEffort | null {
    return this._thinkingEffort;
  }

  withThinking(effort: ThinkingEffort): ChatProvider {
    return new CursorChatProvider(
      {
        model: this._model,
        ...(this._apiKey === undefined ? {} : { apiKey: this._apiKey }),
        baseUrl: this._baseUrl,
        ...(this._defaultHeaders === undefined ? {} : { defaultHeaders: this._defaultHeaders }),
        clientVersion: this._clientVersion,
        cwd: this._cwd,
      },
      effort,
    );
  }

  async generate(
    systemPrompt: string,
    tools: Tool[],
    history: Message[],
    options?: GenerateOptions,
  ): Promise<StreamedMessage> {
    const apiKey = requireProviderApiKey('cursor', options?.auth, this._apiKey);
    const headers = mergeRequestHeaders(this._defaultHeaders, options?.auth?.headers);
    const prompt = renderCursorPrompt(systemPrompt, history);
    if (prompt.trim().length === 0) {
      throw new ChatProviderError('cursor: empty prompt after rendering history.');
    }

    const client = new CursorAgentClient({
      baseUrl: this._baseUrl,
      clientVersion: this._clientVersion,
      ...(headers === undefined ? {} : { defaultHeaders: headers }),
    });

    const agentTools: CursorAgentTool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema:
        Object.keys(tool.parameters).length > 0
          ? tool.parameters
          : { type: 'object', properties: {} },
    }));

    const events = client.run(
      apiKey,
      {
        prompt,
        modelId: this._model,
        cwd: this._cwd,
        mode: 1,
        tools: agentTools,
      },
      {
        signal: options?.signal,
      },
    );

    return new CursorStreamedMessage(events);
  }
}

export { buildRunFrames, heartbeatFrame } from './frames';
export { encodeConnectFrame, ConnectFrameDecoder } from './connect';
export { CURSOR_PROVIDER_ID } from './constants';
export {
  extractAnswerText,
  extractReasoningText,
  extractToolCall,
  extractExecMessage,
  extractInteractionQuery,
  extractKvMessage,
  normalizeCursorToolName,
} from './extract';
export {
  encodeInteractionQueryReply,
  encodeKvReply,
  encodeNativeExecReject,
  encodeRequestContextReply,
  encodeExecStreamClose,
} from './replies';
export { recoverToolCallsFromCursorText, sanitizeCursorAssistantText } from './sanitize';
export {
  ensureCursorGrokWirePrefix,
  rewriteCursorLegacyFastSuffix,
  stripCursorWirePrefix,
  toCursorWireModelId,
} from './model-id';
export { renderCursorPrompt } from './prompt';
export {
  encodeProtobufValue,
  decodeProtobufValue,
  fieldLd,
  fieldStr,
  fieldVarint,
  concatBytes,
} from './proto';
