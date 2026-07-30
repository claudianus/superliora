import type { SlashCommandHost } from '../hub/dispatch';
import { openModelPickerForProvider } from './model-picker';

/** Cloud-hosted Claude model presets for Bedrock and Vertex AI. */
const CLOUD_CLAUDE_MODELS = [
  {
    id: 'claude-sonnet-4-20250514',
    bedrockId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    vertexId: 'claude-sonnet-4@20250514',
    displayName: 'Claude Sonnet 4',
    maxContextSize: 200000,
    capabilities: ['thinking', 'tool_use', 'image_in'],
  },
  {
    id: 'claude-opus-4-20250514',
    bedrockId: 'us.anthropic.claude-opus-4-20250514-v1:0',
    vertexId: 'claude-opus-4@20250514',
    displayName: 'Claude Opus 4',
    maxContextSize: 200000,
    capabilities: ['thinking', 'tool_use', 'image_in'],
  },
] as const;

/**
 * Connects a cloud-hosted Claude provider (Amazon Bedrock or Google Vertex AI).
 * Unlike API-key or OAuth providers, these authenticate through the cloud
 * platform's standard credential chain (AWS IAM / GCP ADC), so no secret is
 * stored — only the provider config + model aliases.
 */
export async function connectCloudProvider(
  host: SlashCommandHost,
  cloudKind: 'bedrock' | 'vertex_claude',
): Promise<void> {
  const isBedrock = cloudKind === 'bedrock';
  const providerId = isBedrock ? 'anthropic-bedrock' : 'anthropic-vertex';
  const credentialHint = isBedrock
    ? 'Requires AWS credentials (aws configure or AWS_ACCESS_KEY_ID env). Enable Anthropic models in the Bedrock console.'
    : 'Requires GCP credentials (gcloud auth application-default login). Enable Claude in the Vertex AI Model Garden.';

  host.showStatus(credentialHint);

  const config = await host.harness.getConfig();
  if (config.providers[providerId] !== undefined) {
    await host.harness.removeProvider(providerId);
  }
  const freshConfig = await host.harness.getConfig();
  // No apiKey — the SDK resolves credentials from the cloud credential chain.
  freshConfig.providers[providerId] = {
    type: cloudKind,
    apiKey: '',
  };

  // Write model aliases using the cloud-specific model id convention.
  const models = freshConfig.models ?? {};
  for (const preset of CLOUD_CLAUDE_MODELS) {
    const modelId = isBedrock ? preset.bedrockId : preset.vertexId;
    models[`${providerId}/${preset.id}`] = {
      provider: providerId,
      model: modelId,
      maxContextSize: preset.maxContextSize,
      capabilities: [...preset.capabilities],
      displayName: preset.displayName,
    };
  }
  freshConfig.models = models;

  await host.harness.setConfig({
    providers: freshConfig.providers,
    models: freshConfig.models,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: providerId, method: 'cloud' });
  host.showStatus(
    `Connected: ${isBedrock ? 'Anthropic via Bedrock' : 'Anthropic via Vertex AI'}`,
    'success',
  );

  await openModelPickerForProvider(host, providerId);
}
