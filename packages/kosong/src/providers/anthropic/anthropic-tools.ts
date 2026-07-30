import type { Tool } from '#/tool';
import type { Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages/messages.js';

export interface AnthropicToolParam extends AnthropicTool {
  cache_control?: { type: 'ephemeral' } | null;
}

export function convertTool(tool: Tool): AnthropicToolParam {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as AnthropicTool['input_schema'],
  };
}
