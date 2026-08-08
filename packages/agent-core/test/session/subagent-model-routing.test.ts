import { describe, expect, it } from 'vitest';

import { resolveSubagentModelSelection } from '../../src/session/subagent/subagent-model-routing';
import { testAgent } from '../agent/harness/agent';

const PROVIDER = {
  type: 'kimi' as const,
  apiKey: 'test-key',
};

function model(
  name: string,
  capabilities: readonly string[],
  inputCost: number,
): {
  provider: string;
  model: string;
  maxContextSize: number;
  capabilities: readonly string[];
  cost: { input: number };
} {
  return {
    provider: 'test-provider',
    model: name,
    maxContextSize: 128_000,
    capabilities,
    cost: { input: inputCost },
  };
}

describe('subagent role model routing', () => {
  it('applies explicit coding and planning overrides', () => {
    const context = testAgent({
      initialConfig: {
        providers: { 'test-provider': PROVIDER },
        models: {
          'code-pro': model('code-pro', ['tool_use', 'thinking'], 8),
          'plan-pro': model('plan-pro', ['tool_use', 'thinking'], 12),
        },
        loopControl: {
          codingModel: 'code-pro',
          planningModel: 'plan-pro',
        },
      },
    });
    context.configure();

    expect(resolveSubagentModelSelection(context.agent, 'coder')).toMatchObject({
      alias: 'code-pro',
      role: 'coding',
      source: 'explicit',
    });
    expect(resolveSubagentModelSelection(context.agent, 'plan')).toMatchObject({
      alias: 'plan-pro',
      role: 'planning',
      source: 'explicit',
    });
  });

  it('automatically selects by worker role and applies role thinking', () => {
    const context = testAgent({
      initialConfig: {
        providers: { 'test-provider': PROVIDER },
        models: {
          'cheap-haiku': model('cheap-haiku', ['tool_use', 'thinking'], 0.1),
          opus: model('opus', ['tool_use', 'thinking'], 10),
        },
      },
    });
    context.configure();

    expect(resolveSubagentModelSelection(context.agent, 'explore')).toMatchObject({
      alias: 'cheap-haiku',
      role: 'exploration',
      thinkingLevel: 'low',
      source: 'auto',
    });
    expect(resolveSubagentModelSelection(context.agent, 'coder')).toMatchObject({
      alias: 'opus',
      role: 'coding',
      thinkingLevel: 'high',
      source: 'auto',
    });
    expect(resolveSubagentModelSelection(context.agent, 'plan')).toMatchObject({
      alias: 'opus',
      role: 'planning',
      thinkingLevel: 'max',
      source: 'auto',
    });
    expect(resolveSubagentModelSelection(context.agent, 'goal-driver')).toMatchObject({
      alias: 'opus',
      role: 'coding',
      source: 'auto',
    });
  });

  it('reads role overrides from a live config after session creation', () => {
    const context = testAgent({
      initialConfig: {
        providers: { 'test-provider': PROVIDER },
        models: {
          'code-pro': model('code-pro', ['tool_use', 'thinking'], 8),
        },
      },
    });
    context.configure();
    context.configureLoopControl({ codingModel: 'code-pro' });

    expect(resolveSubagentModelSelection(context.agent, 'coder')).toMatchObject({
      alias: 'code-pro',
      source: 'explicit',
    });
  });

  it('preferVision overrides a text-only coding alias with a vision catalog model', () => {
    const context = testAgent({
      initialConfig: {
        providers: { 'test-provider': PROVIDER },
        models: {
          'code-text': model('code-text', ['tool_use', 'thinking'], 8),
          'vision-pro': model('vision-pro', ['tool_use', 'thinking', 'image_in'], 9),
        },
        loopControl: {
          codingModel: 'code-text',
        },
      },
    });
    context.configure();

    expect(resolveSubagentModelSelection(context.agent, 'coder')).toMatchObject({
      alias: 'code-text',
      source: 'explicit',
    });
    expect(
      resolveSubagentModelSelection(context.agent, 'coder', undefined, { preferVision: true }),
    ).toMatchObject({
      alias: 'vision-pro',
      source: 'vision',
    });
  });

  it('preferVision keeps an alias that already has image_in', () => {
    const context = testAgent({
      initialConfig: {
        providers: { 'test-provider': PROVIDER },
        models: {
          'code-vision': model('code-vision', ['tool_use', 'thinking', 'image_in'], 8),
          'other-vision': model('other-vision', ['tool_use', 'image_in'], 9),
        },
        loopControl: {
          codingModel: 'code-vision',
        },
      },
    });
    context.configure();

    expect(
      resolveSubagentModelSelection(context.agent, 'coder', undefined, { preferVision: true }),
    ).toMatchObject({
      alias: 'code-vision',
      source: 'explicit',
    });
  });

  it('honors deepseek planning override even when the alias is unhealthy', () => {
    const context = testAgent({
      initialConfig: {
        providers: {
          'test-provider': PROVIDER,
          // No apiKey → providerHasAnyCredential is false → was previously skipped.
          deepseek: { type: 'openai', baseUrl: 'https://api.deepseek.example/v1' },
        },
        models: {
          'deepseek/flash': {
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            maxContextSize: 128_000,
            capabilities: ['tool_use', 'thinking'],
            cost: { input: 0.14 },
          },
          opus: model('opus', ['tool_use', 'thinking'], 10),
        },
        loopControl: {
          planningModel: 'deepseek/flash',
        },
      },
    });
    context.configure();

    expect(resolveSubagentModelSelection(context.agent, 'plan')).toMatchObject({
      alias: 'deepseek/flash',
      role: 'planning',
      source: 'explicit',
    });
  });
});
