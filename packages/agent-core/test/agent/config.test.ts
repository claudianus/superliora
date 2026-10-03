import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { LocalKaos } from '@superliora/kaos';
import { emptyUsage, type GenerateResult } from '@superliora/kosong';
import { describe, expect, it, onTestFinished } from 'vitest';

import { createCommandKaos, testAgent } from './harness/agent';

function answer(text: string): GenerateResult {
  return {
    id: 'config-response',
    message: { role: 'assistant', content: [{ type: 'text', text }], toolCalls: [] },
    usage: emptyUsage(), finishReason: 'completed', rawFinishReason: 'stop',
  };
}

describe('Agent live config', () => {
  it('persists an explicit provider and thinking update through record replay', async () => {
    const ctx = testAgent();
    ctx.configure({ provider: { type: 'openai', apiKey: 'initial-key', model: 'initial-model' } });
    const nextProvider = { type: 'kimi', apiKey: 'next-key', model: 'next-model' } as const;
    ctx.configureRuntimeModel(nextProvider, {
      image_in: true, video_in: true, audio_in: false, pdf_in: false,
      thinking: true, tool_use: true, max_context_tokens: 262144,
    });
    ctx.agent.config.update({ systemPrompt: 'Operator-provided prompt.', thinkingLevel: 'high' });
    expect(await ctx.rpc.getConfig({})).toMatchObject({
      provider: nextProvider,
      systemPrompt: 'Operator-provided prompt.', thinkingLevel: 'high',
      modelCapabilities: { thinking: true, max_context_tokens: 262144 },
    });
    await ctx.expectResumeMatches();
  });

  it('retains a removed model alias through replay without hiding execution configuration errors', async () => {
    const ctx = testAgent();
    ctx.agent.config.update({ modelAlias: 'removed/model' });
    expect(ctx.agent.config.data()).toMatchObject({ modelAlias: 'removed/model', provider: undefined });
    expect(ctx.agent.providerRouteStatus()).toBeNull();
    expect(() => ctx.agent.config.providerConfig).toThrow();
    await ctx.expectResumeMatches();
  });

  it('changes the execution cwd without mutating the previous Kaos or host cwd', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'liora-agent-cwd-')));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const kaos = await LocalKaos.create();
    const previous = kaos.getcwd();
    const hostCwd = process.cwd();
    const ctx = testAgent({ kaos });
    ctx.agent.config.update({ cwd: directory });
    expect(ctx.agent.config.cwd).toBe(directory);
    expect(ctx.agent.kaos.getcwd()).toBe(directory);
    expect(kaos.getcwd()).toBe(previous);
    expect(process.cwd()).toBe(hostCwd);
    const result = await ctx.agent.tools.runShellCommand("node -e 'process.stdout.write(process.cwd())'");
    expect(result.isError).toBe(false);
    expect(ctx.agent.kaos.normpath(result.stdout)).toBe(directory);
  });

  it('keeps the turn-start provider and prompt until settlement, applying changes to the next turn', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const requests: Array<{ model: string; prompt: string }> = [];
    const ctx = testAgent({
      kaos: createCommandKaos('effect'),
      generate: async (provider, system) => {
        requests.push({ model: provider.modelName, prompt: system });
        if (requests.length === 1) {
          entered.resolve();
          await release.promise;
          return {
            ...answer(''),
            message: { role: 'assistant', content: [], toolCalls: [{ type: 'function', id: 'config-bash', name: 'Bash', arguments: '{"command":"printf effect"}' }] },
            finishReason: 'tool_calls', rawFinishReason: 'tool_calls',
          };
        }
        return answer('answer');
      },
    });
    ctx.configure();
    const originalPrompt = ctx.agent.config.systemPrompt;
    ctx.agent.permission.setMode('yolo');
    ctx.agent.turn.prompt([{ type: 'text', text: 'Run the command' }]);
    const turn = ctx.agent.turn.waitForCurrentTurn();
    await entered.promise;
    ctx.configureRuntimeModel({ type: 'kimi', apiKey: 'changed-key', model: 'changed-model' });
    ctx.agent.config.update({ systemPrompt: 'Changed operator prompt.' });
    release.resolve();
    expect((await turn).event.reason).toBe('completed');
    expect(requests).toEqual([
      { model: 'mock-model', prompt: originalPrompt },
      { model: 'mock-model', prompt: originalPrompt },
    ]);
    ctx.agent.turn.prompt([{ type: 'text', text: 'Start another turn' }]);
    expect((await ctx.agent.turn.waitForCurrentTurn()).event.reason).toBe('completed');
    expect(requests.at(-1)).toEqual({ model: 'changed-model', prompt: 'Changed operator prompt.' });
  });
});
