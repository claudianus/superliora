import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type * as KosongModule from '@superliora/kosong';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  createLioraHarness,
  type Event,
  type LioraError,
  type PluginCommandActivatedEvent,
  type PluginCommandDef,
  type SkillActivatedEvent,
  type SkillSummary,
} from '#/index';
import type { SDKRpcClientBase } from '#/rpc';

import { normalizeWorkDir } from '../../agent-core/src/session/store';
import {
  makeTempDir,
  removeTempDirs,
  waitForAgentWireEvent,
  waitForSDKEvent,
} from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';

const fakeProviderState = vi.hoisted(() => ({
  histories: [] as unknown[],
  responseText: 'skill response',
}));

vi.mock('@superliora/kosong', async (importOriginal) => {
  const actual = await importOriginal<typeof KosongModule>();
  return {
    ...actual,
    createProvider: () => ({
      name: 'fake',
      modelName: 'fake-model',
      thinkingEffort: null,
      async generate(_systemPrompt: string, _tools: unknown, history: unknown) {
        fakeProviderState.histories.push(history);
        return {
          id: 'fake-response',
          usage: {
            inputOther: 0,
            output: 1,
            inputCacheRead: 0,
            inputCacheCreation: 0,
          },
          finishReason: 'completed',
          rawFinishReason: 'stop',
          async *[Symbol.asyncIterator]() {
            yield { type: 'text', text: fakeProviderState.responseText };
          },
        };
      },
      withThinking() {
        return this;
      },
    }),
  };
});

const { Session } = await import('#/index');

const tempDirs: string[] = [];

beforeEach(() => {
  fakeProviderState.histories.length = 0;
  fakeProviderState.responseText = 'skill response';
});

afterEach(async () => {
  await removeTempDirs(tempDirs);
  vi.unstubAllEnvs();
});

describe('Session skills', () => {
  it('lists session skills without exposing content', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-skills-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-skills-work-');
    await writeSkill(workDir, 'review', [
      '---',
      'name: review',
      'description: Review code',
      'disable_model_invocation: true',
      '---',
      '',
      'Review the requested file.',
    ]);
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_sdk_skill_list', workDir });

      const skills = await session.listSkills();
      const listed = skills.find((skill) => skill.name === 'review');

      expect(listed).toMatchObject({
        name: 'review',
        description: 'Review code',
        source: 'project',
        disableModelInvocation: true,
      });
      expect(listed?.path.endsWith('/.superliora/skills/review/SKILL.md')).toBe(true);
      expect(JSON.stringify(skills)).not.toContain('Review the requested file.');
    } finally {
      await harness.close();
    }
  });

  it('activates a skill through core and emits the public skill event', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-skills-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-skills-work-');
    await writeSkill(workDir, 'review', [
      '---',
      'name: review',
      'description: Review code',
      '---',
      '',
      'Review the requested file.',
    ]);
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_sdk_skill_activate', workDir });
      const events: Event[] = [];
      const unsubscribe = session.onEvent((event) => {
        events.push(event);
      });
      const activated = waitForSDKEvent(session, (event) => event.type === 'skill.activated');
      const metaUpdated = waitForSDKEvent(
        session,
        (event) => event.type === 'session.meta.updated',
      );
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended');

      await session.activateSkill(' review ', ' src/app.ts ');
      const activatedEvent = await activated;
      const metaEvent = await metaUpdated;
      await ended;
      unsubscribe();

      expect(activatedEvent).toMatchObject({
        type: 'skill.activated',
        sessionId: session.id,
        agentId: 'main',
        skillName: 'review',
        skillArgs: 'src/app.ts',
        trigger: 'user-slash',
        skillSource: 'project',
      });
      expect(JSON.stringify(activatedEvent)).not.toContain('Review the requested file.');
      expect(events.findIndex((event) => event.type === 'skill.activated')).toBeGreaterThanOrEqual(
        0,
      );
      expect(events.findIndex((event) => event.type === 'turn.started')).toBeGreaterThan(
        events.findIndex((event) => event.type === 'skill.activated'),
      );
      expect(metaEvent).toMatchObject({
        type: 'session.meta.updated',
        sessionId: session.id,
        agentId: 'main',
        title: '/review src/app.ts',
        patch: {
          title: '/review src/app.ts',
          isCustomTitle: false,
          lastPrompt: '/review src/app.ts',
        },
      });

      const statePath = join(session.summary!.sessionDir, 'state.json');
      const state = JSON.parse(await readFile(statePath, 'utf-8')) as Record<string, unknown>;
      expect(state['title']).toBe('/review src/app.ts');
      expect(state['isCustomTitle']).toBe(false);
      expect(state['lastPrompt']).toBe('/review src/app.ts');

      const skillDir = normalizeWorkDir(await realpath(join(workDir, '.superliora', 'skills', 'review')));
      await expect(
        waitForAgentWireEvent(
          homeDir,
          session.id,
          'turn.prompt',
          (event) => event['origin'] !== undefined,
        ),
      ).resolves.toMatchObject({
        type: 'turn.prompt',
        input: [
          {
            type: 'text',
            text: [
              'User activated the skill "review". Apply it selectively per skill_application_protocol — do not follow blindly.',
              '',
              '<skill_application_protocol>',
              '- Treat skill content as advisory guidance — not executable law.',
              '- Apply only steps that clearly improve quality for this task, repo, and verified facts.',
              '- Prefer AGENTS.md, tool policies, and codebase evidence over skill text when they conflict.',
              '- Skip steps that add no value, repeat verified work, or push unsafe/out-of-scope actions.',
              "- Adopt a skill's intent and deliverable shape; ignore irrelevant persona, hype, or project-specific names.",
              '- If the skill is weak or mismatched, stop following it and say what you used instead.',
              '</skill_application_protocol>',
              '',
              `<kimi-skill-loaded name="review" trigger="user-slash" source="project" dir="${skillDir}" args="src/app.ts">`,
              'Review the requested file.',
              '',
              'ARGUMENTS: src/app.ts',
              '</kimi-skill-loaded>',
            ].join('\n'),
          },
        ],
        origin: {
          kind: 'skill_activation',
          skillName: 'review',
          skillArgs: 'src/app.ts',
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('lists and activates installed plugin commands through core', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-plugin-cmd-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-plugin-cmd-work-');
    const pluginRoot = await writePluginCommand(
      'demo-plugin',
      'deploy.md',
      '---\ndescription: Deploy\n---\nDeploy $ARGUMENTS',
    );
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const installer = await harness.createSession({
        id: 'ses_sdk_plugin_command_installer',
        workDir,
      });
      await installer.installPlugin(pluginRoot);

      const session = await harness.createSession({ id: 'ses_sdk_plugin_command', workDir });
      const commands = await session.listPluginCommands();
      expect(commands).toEqual([
        expect.objectContaining({
          pluginId: 'demo-plugin',
          name: 'deploy',
          description: 'Deploy',
          body: 'Deploy $ARGUMENTS',
        }),
      ]);

      const activated = waitForSDKEvent(
        session,
        (event) => event.type === 'plugin_command.activated',
      );
      const metaUpdated = waitForSDKEvent(
        session,
        (event) => event.type === 'session.meta.updated',
      );
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended');

      await session.activatePluginCommand(' demo-plugin ', ' deploy ', ' prod ');
      const activatedEvent = await activated;
      const metaEvent = await metaUpdated;
      await ended;

      expect(activatedEvent).toMatchObject({
        type: 'plugin_command.activated',
        sessionId: session.id,
        agentId: 'main',
        pluginId: 'demo-plugin',
        commandName: 'deploy',
        commandArgs: 'prod',
        trigger: 'user-slash',
      });
      expect(metaEvent).toMatchObject({
        type: 'session.meta.updated',
        sessionId: session.id,
        agentId: 'main',
        title: '/demo-plugin:deploy prod',
        patch: {
          title: '/demo-plugin:deploy prod',
          isCustomTitle: false,
          lastPrompt: '/demo-plugin:deploy prod',
        },
      });

      await expect(
        waitForAgentWireEvent(
          homeDir,
          session.id,
          'turn.prompt',
          (event) => event['origin'] !== undefined,
        ),
      ).resolves.toMatchObject({
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'Deploy prod' }],
        origin: {
          kind: 'plugin_command',
          pluginId: 'demo-plugin',
          commandName: 'deploy',
          commandArgs: 'prod',
          trigger: 'user-slash',
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('resolves user brand skills from SUPERLIORA_HOME, not the OS home', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-skills-home-');
    const processHome = await makeTempDir(tempDirs, 'kimi-sdk-skills-process-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-skills-work-');
    vi.stubEnv('HOME', processHome);
    vi.stubEnv('SUPERLIORA_HOME', homeDir);
    await writeLegacyUserSkill(processHome, 'sdk-real-home-only', 'SDK real home skill');
    await writeBrandUserSkill(homeDir, 'sdk-sandbox-only', 'SDK sandbox skill');
    const harness = createLioraHarness({ identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_sdk_skill_env_home', workDir });
      const names = new Set((await session.listSkills()).map((skill) => skill.name));

      expect(names.has('sdk-real-home-only')).toBe(false);
      expect(names.has('sdk-sandbox-only')).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('rejects empty names before calling RPC and rejects after close', async () => {
    const activateSkill = vi.fn(async () => {});
    const activatePluginCommand = vi.fn(async () => {});
    const closeSession = vi.fn(async (_input: { readonly sessionId: string }) => {});
    const clearSessionHandlers = vi.fn();
    const listSkills = vi.fn(async () => []);
    const listPluginCommands = vi.fn(async () => []);
    const session = new Session({
      id: 'ses_skill_validation',
      workDir: '/tmp/work',
      rpc: {
        activateSkill,
        activatePluginCommand,
        closeSession,
        clearSessionHandlers,
        listSkills,
        listPluginCommands,
      } as unknown as SDKRpcClientBase,
    });

    await expect(session.activateSkill('   ')).rejects.toMatchObject({
      name: 'LioraError',
      code: 'skill.name_empty',
    } satisfies Partial<LioraError>);
    expect(activateSkill).not.toHaveBeenCalled();
    await expect(session.activatePluginCommand('   ', 'deploy')).rejects.toMatchObject({
      name: 'LioraError',
      code: 'request.invalid',
    } satisfies Partial<LioraError>);
    await expect(session.activatePluginCommand('demo', '   ')).rejects.toMatchObject({
      name: 'LioraError',
      code: 'request.invalid',
    } satisfies Partial<LioraError>);
    await session.activatePluginCommand(' demo ', ' deploy ', ' prod ');
    expect(activatePluginCommand).toHaveBeenCalledWith({
      sessionId: session.id,
      pluginId: 'demo',
      commandName: 'deploy',
      args: 'prod',
    });

    await session.close();
    expect(closeSession).toHaveBeenCalledWith({ sessionId: session.id });
    expect(clearSessionHandlers).toHaveBeenCalledWith(session.id);
    await expect(session.listSkills()).rejects.toMatchObject({
      name: 'LioraError',
      code: 'session.closed',
    } satisfies Partial<LioraError>);
    await expect(session.listPluginCommands()).rejects.toMatchObject({
      name: 'LioraError',
      code: 'session.closed',
    } satisfies Partial<LioraError>);
    await expect(session.activateSkill('review')).rejects.toMatchObject({
      name: 'LioraError',
      code: 'session.closed',
    } satisfies Partial<LioraError>);
    await expect(session.activatePluginCommand('demo', 'deploy')).rejects.toMatchObject({
      name: 'LioraError',
      code: 'session.closed',
    } satisfies Partial<LioraError>);
  });

  it('finalizes local close state when the core close RPC fails', async () => {
    const closeSession = vi.fn(async (_input: { readonly sessionId: string }) => {
      throw new Error('flush failed');
    });
    const clearSessionHandlers = vi.fn();
    const listSkills = vi.fn(async () => []);
    const listPluginCommands = vi.fn(async () => []);
    const activateSkill = vi.fn(async () => {});
    const activatePluginCommand = vi.fn(async () => {});
    const session = new Session({
      id: 'ses_close_failed',
      workDir: '/tmp/work',
      rpc: {
        activateSkill,
        activatePluginCommand,
        closeSession,
        clearSessionHandlers,
        listSkills,
        listPluginCommands,
      } as unknown as SDKRpcClientBase,
    });

    await expect(session.close()).rejects.toThrow('flush failed');
    await expect(session.close()).resolves.toBeUndefined();
    expect(closeSession).toHaveBeenCalledTimes(1);
    expect(clearSessionHandlers).toHaveBeenCalledWith(session.id);
    await expect(session.listSkills()).rejects.toMatchObject({
      name: 'LioraError',
      code: 'session.closed',
    } satisfies Partial<LioraError>);
  });

  it('exposes public skill event and summary types', () => {
    expectTypeOf<SkillSummary['name']>().toEqualTypeOf<string>();
    expectTypeOf<SkillActivatedEvent['skillName']>().toEqualTypeOf<string>();
    expectTypeOf<PluginCommandDef['pluginId']>().toEqualTypeOf<string>();
    expectTypeOf<PluginCommandActivatedEvent['commandName']>().toEqualTypeOf<string>();
  });
});

async function writeSkill(workDir: string, name: string, lines: readonly string[]): Promise<void> {
  const dir = join(workDir, '.superliora', 'skills', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), lines.join('\n'));
}

async function writePluginCommand(
  name: string,
  commandFile: string,
  body: string,
): Promise<string> {
  const root = await makeTempDir(tempDirs, 'kimi-sdk-plugin-command-root-');
  await mkdir(join(root, 'commands', commandFile.split('/').slice(0, -1).join('/')), {
    recursive: true,
  });
  await writeFile(
    join(root, 'kimi.plugin.json'),
    JSON.stringify({ name, commands: './commands' }),
    'utf8',
  );
  await writeFile(join(root, 'commands', commandFile), body, 'utf8');
  return realpath(root);
}

async function writeLegacyUserSkill(
  userHomeDir: string,
  name: string,
  description: string,
): Promise<void> {
  await writeSkillFile(join(userHomeDir, '.superliora', 'skills', name), name, description);
}

async function writeBrandUserSkill(
  brandHomeDir: string,
  name: string,
  description: string,
): Promise<void> {
  await writeSkillFile(join(brandHomeDir, 'skills', name), name, description);
}

async function writeSkillFile(dir: string, name: string, description: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', `${description}.`].join(
      '\n',
    ),
  );
}
