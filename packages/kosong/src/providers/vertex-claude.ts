/**
 * VertexClaudeChatProvider — Claude on Google Cloud Vertex AI.
 *
 * Reuses {@link AnthropicChatProvider}'s entire message/stream pipeline by
 * injecting a Vertex-backed client via `clientFactory`. Auth is delegated to
 * the Vertex SDK's Application Default Credentials (ADC) chain
 * (`gcloud auth application-default login`, service account JSON, GCE metadata).
 *
 * Model IDs on Vertex use the `claude-<model>@<date>` convention
 * (e.g. `claude-sonnet-4@20250514`); the caller supplies the project/region
 * appropriate ID.
 */

import AnthropicVertex from '@anthropic-ai/vertex-sdk';

import { AnthropicChatProvider, type AnthropicOptions } from './anthropic';
import type { ProviderRequestAuth } from '../provider';

export interface VertexClaudeOptions
  extends Omit<AnthropicOptions, 'baseUrl' | 'clientFactory'> {
  /** GCP project id. Read from `GOOGLE_VERTEX_PROJECT` when omitted. */
  readonly projectId?: string;
  /** GCP region (e.g. `us-east5`). Read from `GOOGLE_VERTEX_REGION` when omitted. */
  readonly region?: string;
}

function buildVertexClient(options: VertexClaudeOptions): AnthropicVertex {
  return new AnthropicVertex({
    projectId: options.projectId ?? process.env['GOOGLE_VERTEX_PROJECT'],
    region: options.region ?? process.env['GOOGLE_VERTEX_REGION'],
  });
}

export class VertexClaudeChatProvider extends AnthropicChatProvider {
  constructor(options: VertexClaudeOptions) {
    // Inject a Vertex client factory so AnthropicChatProvider's generate/stream
    // logic uses Vertex AI under the hood. The three SDK clients share the same
    // messages API surface but have distinct TypeScript types; the cast is safe.
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
        buildVertexClient(options)) as unknown as (auth: ProviderRequestAuth) => never,
    } as unknown as AnthropicOptions);
    this.name = 'vertex_claude';
  }
}
