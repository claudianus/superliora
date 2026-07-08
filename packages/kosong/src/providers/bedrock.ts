/**
 * BedrockChatProvider — Claude on Amazon Bedrock.
 *
 * Reuses {@link AnthropicChatProvider}'s entire message/stream pipeline (the
 * three Anthropic SDK siblings share the same `messages` API surface) by
 * injecting a Bedrock-backed client via `clientFactory`. Auth is delegated to
 * the Bedrock SDK's standard AWS credential chain (`~/.aws/credentials`, env
 * vars, instance profile, SSO, `AWS_BEARER_TOKEN_BEDROCK`).
 *
 * Model IDs on Bedrock differ from the direct API (e.g.
 * `us.anthropic.claude-sonnet-4-20250514-v1:0`); the caller supplies the
 * region-appropriate ID.
 */

import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';

import { AnthropicChatProvider, type AnthropicOptions } from './anthropic';
import type { ProviderRequestAuth } from '../provider';

export interface BedrockOptions extends Omit<AnthropicOptions, 'baseUrl' | 'clientFactory'> {
  /** AWS region (e.g. `us-east-1`). Read from `AWS_REGION` / `BEDROCK_REGION` when omitted. */
  readonly awsRegion?: string;
  /**
   * Optional explicit AWS access key. When omitted the Bedrock SDK resolves
   * credentials from its standard chain.
   */
  readonly awsAccessKey?: string;
  /** Optional explicit AWS secret key. */
  readonly awsSecretKey?: string;
  /** Optional AWS session token (for temporary credentials). */
  readonly awsSessionToken?: string;
}

/**
 * Builds a Bedrock SDK client. Credentials are passed explicitly when provided;
 * otherwise the SDK auto-discovers them from the environment.
 */
function buildBedrockClient(options: BedrockOptions): AnthropicBedrock {
  const region = options.awsRegion ?? process.env['AWS_REGION'] ?? process.env['BEDROCK_REGION'];
  if (options.awsAccessKey !== undefined && options.awsSecretKey !== undefined) {
    return new AnthropicBedrock({
      awsRegion: region,
      awsAccessKey: options.awsAccessKey,
      awsSecretKey: options.awsSecretKey,
      ...(options.awsSessionToken !== undefined ? { awsSessionToken: options.awsSessionToken } : {}),
    });
  }
  // No explicit credentials — let the Bedrock SDK resolve its standard chain.
  return new AnthropicBedrock({ awsRegion: region });
}

export class BedrockChatProvider extends AnthropicChatProvider {
  constructor(options: BedrockOptions) {
    // Inject a Bedrock client factory so AnthropicChatProvider's generate/stream
    // logic uses Bedrock under the hood. The three SDK clients share the same
    // messages API surface but have distinct TypeScript types; the cast is safe
    // because the Anthropic SDK family guarantees runtime compatibility.
    super({
      model: options.model,
      stream: options.stream,
      defaultMaxTokens: options.defaultMaxTokens,
      betaFeatures: options.betaFeatures,
      defaultHeaders: options.defaultHeaders,
      metadata: options.metadata,
      adaptiveThinking: options.adaptiveThinking,
      betaApi: options.betaApi,
      apiKey: '',
      clientFactory: (() =>
        buildBedrockClient(options)) as unknown as (auth: ProviderRequestAuth) => never,
    } as unknown as AnthropicOptions);
    this.name = 'bedrock';
  }
}
