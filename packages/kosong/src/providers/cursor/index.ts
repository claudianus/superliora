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
import { resolveCursorAgentOrigin } from './agent-url';
import { CursorAgentClient } from './client';
import { CURSOR_API_BASE_URL } from './constants';
import { convertCursorError } from './errors';
import type { CursorAgentTool } from './frames';
import { renderCursorPrompt } from './prompt';
import { CursorStreamedMessage } from './stream';
import { resolveCursorClientVersion } from './version';

export interface CursorOptions {
  readonly model: string;
  readonly apiKey?: string;
  /**
   * AgentService/Run origin. Auth-API hosts (`api2.cursor.sh`) are ignored and
   * replaced by GetServerConfig. Override with `CURSOR_AGENT_BASE_URL`.
   */
  readonly baseUrl?: string;
  /** Auth/catalog host for GetServerConfig (default `https://api2.cursor.sh`). */
  readonly apiBaseUrl?: string;
  readonly defaultHeaders?: Record<string, string>;
  /** Advertised `x-cursor-client-version`; defaults to env or a local CLI build. */
  readonly clientVersion?: string;
  /** Working directory sent in Cursor environment context. */
  readonly cwd?: string;
}

export class CursorChatProvider implements ChatProvider {
  readonly name = 'cursor';

  private readonly _model: string;
  private readonly _apiKey: string | undefined;
  private readonly _baseUrl: string | undefined;
  private readonly _apiBaseUrl: string;
  private readonly _defaultHeaders: Record<string, string> | undefined;
  private readonly _clientVersion: string;
  private readonly _cwd: string;
  private readonly _thinkingEffort: ThinkingEffort | null;

  constructor(options: CursorOptions, thinkingEffort: ThinkingEffort | null = null) {
    const apiKey = options.apiKey ?? process.env['CURSOR_ACCESS_TOKEN'];
    this._apiKey = apiKey === undefined || apiKey.length === 0 ? undefined : apiKey;
    const configured = options.baseUrl?.trim();
    this._baseUrl = configured !== undefined && configured.length > 0 ? configured : undefined;
    this._apiBaseUrl = options.apiBaseUrl?.trim() || CURSOR_API_BASE_URL;
    this._defaultHeaders = options.defaultHeaders;
    this._model = options.model;
    this._clientVersion = resolveCursorClientVersion(options.clientVersion);
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
        ...(this._baseUrl === undefined ? {} : { baseUrl: this._baseUrl }),
        apiBaseUrl: this._apiBaseUrl,
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

    let agentOrigin: string;
    try {
      // Per-request base URL wins (rotated session hosts).
      const configuredBaseUrl = options?.auth?.baseUrl ?? this._baseUrl;
      agentOrigin = await resolveCursorAgentOrigin({
        token: apiKey,
        ...(configuredBaseUrl === undefined ? {} : { configuredBaseUrl }),
        apiBaseUrl: this._apiBaseUrl,
        clientVersion: this._clientVersion,
        signal: options?.signal,
      });
    } catch (error) {
      throw convertCursorError(error);
    }

    const client = new CursorAgentClient({
      baseUrl: agentOrigin,
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
export {
  encodeConnectFrame,
  ConnectFrameDecoder,
  parseConnectEndError,
  parseHttp2Trailers,
  unwrapConnectPayload,
} from './connect';
export {
  CURSOR_PROVIDER_ID,
  CURSOR_API_BASE_URL,
  CURSOR_AGENT_FALLBACK_URL,
  CURSOR_CLIENT_VERSION_DEFAULT,
} from './constants';
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
export {
  convertCursorError,
  isCursorBadModelError,
  isCursorClientVersionError,
  isCursorRegionRoutingError,
} from './errors';
export {
  parseGetServerConfigAgentUrl,
  resolveCursorAgentOrigin,
  invalidateCursorAgentOriginCache,
} from './agent-url';
export {
  explicitCursorAgentOrigin,
  isCursorAuthApiOrigin,
  isCursorDefaultFallbackOrigin,
  normalizeCursorAgentOrigin,
} from './hosts';
export { buildCursorIdentityHeaders, mergeCursorProtocolHeaders } from './headers';
export {
  createCursorChecksumHeader,
  obfuscateCursorTimestamp,
  parseCursorWindowsMachineGuid,
} from './identity';
export { cursorEnvironmentOs, cursorEnvironmentShell, cursorIsWorkingDirHome } from './env';
export {
  resolveCursorClientVersion,
  discoverLocalCursorClientVersion,
  cursorAgentVersionsDirs,
} from './version';
