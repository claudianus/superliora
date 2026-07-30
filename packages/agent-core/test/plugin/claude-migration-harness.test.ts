import { access, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PluginManager } from '../../src/plugin/manager';
import { parseManifest } from '../../src/plugin/manifest';
import { missingRequiredUserConfigKeys } from '../../src/plugin/user-config';
import { runWorkflowScript } from '../../src/plugin/workflow-runtime';
import { discoverWorkflowScripts } from '../../src/plugin/workflow-discover';
import { PluginChannelRuntime } from '../../src/plugin/channel-runtime';
import { satisfiesRange } from '../../src/plugin/dependencies';
import { hookIfMatches } from '../../src/plugin/hook-if';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/claude-migration',
);

describe('claude migration harness', () => {
  it('installs basic-layout fixture with skills and commands', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'mig-home-'));
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    const record = await manager.install(path.join(FIXTURES, 'basic-layout'));
    expect(record.id).toBe('basic-layout');
    expect(record.manifest?.skills.length).toBeGreaterThan(0);
    const commands = await manager.enabledCommands();
    expect(commands.some((c) => c.name === 'ping' || c.name.endsWith(':ping'))).toBe(true);
    await access(manager.pluginDataDir('basic-layout'));
  });

  it('loads hooks-only fixture hooks', async () => {
    const parsed = await parseManifest(path.join(FIXTURES, 'hooks-only'));
    expect(parsed.manifest?.hooks.length).toBeGreaterThan(0);
    expect(parsed.manifest?.hooks[0]?.event).toBe('PreToolUse');
  });

  it('surfaces missing required userConfig for mcp-data fixture', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'mig-home-'));
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    const record = await manager.install(path.join(FIXTURES, 'mcp-data'));
    const missing = missingRequiredUserConfigKeys(
      record.manifest?.userConfig,
      record.capabilities?.userConfig,
    );
    expect(missing).toContain('token');
    await manager.setUserConfigValues('mcp-data', { token: 'secret' });
    const after = manager.get('mcp-data');
    expect(
      missingRequiredUserConfigKeys(after?.manifest?.userConfig, after?.capabilities?.userConfig),
    ).toEqual([]);
  });

  it('runs workflow-js fixture with agent/pipeline', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(FIXTURES, 'workflow-js/workflows/audit-demo.js'), 'utf8'),
    );
    const result = await runWorkflowScript({
      source,
      filePath: 'audit-demo.js',
      agent: async (prompt, options) => {
        if (options?.schema !== undefined) {
          return { files: ['a.ts'] };
        }
        return { ok: true, prompt };
      },
    });
    expect(result.meta.name).toBe('audit-demo');
    expect(result.agentCalls).toBeGreaterThanOrEqual(2);
    expect(result.value).toEqual({ audits: [{ ok: true, prompt: 'Audit a.ts' }] });
  });

  it('discovers project .claude/workflows for migration', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'mig-proj-'));
    const wfDir = path.join(project, '.claude', 'workflows');
    await mkdir(wfDir, { recursive: true });
    await writeFile(
      path.join(wfDir, 'local-wf.js'),
      `export const meta = { name: 'local-wf', description: 'x' }\nreturn 1\n`,
      'utf8',
    );
    const found = await discoverWorkflowScripts({
      pluginWorkflows: [],
      projectDir: project,
      homeDir: path.join(project, 'no-home'),
    });
    expect(found.some((f) => f.name === 'local-wf' && f.source === 'project')).toBe(true);
  });

  it('channel runtime injects inbound notifications when opted in', async () => {
    const steered: string[] = [];
    const agent = {
      hooks: { fireAndForgetTrigger: async () => [] },
      turn: {
        steer: (parts: { type: string; text: string }[]) => {
          steered.push(parts.map((p) => p.text).join(''));
        },
      },
    };
    const runtime = new PluginChannelRuntime(agent as never, ['alerts'], true);
    runtime.handleNotification('alerts', 'notifications/claude/channel', {
      content: 'build failed',
    });
    expect(steered.some((t) => t.includes('build failed'))).toBe(true);
  });

  it('satisfies ^ and ~ dependency ranges', () => {
    expect(satisfiesRange('2.1.5', '^2.1.0')).toBe(true);
    expect(satisfiesRange('3.0.0', '^2.1.0')).toBe(false);
    expect(satisfiesRange('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2.0')).toBe(false);
  });

  it('evaluates hook if filters', () => {
    expect(hookIfMatches('Bash(git *)', { toolName: 'Bash', toolInput: { command: 'git status' } })).toBe(
      true,
    );
    expect(hookIfMatches('Bash(git *)', { toolName: 'Bash', toolInput: { command: 'rm -rf /' } })).toBe(
      false,
    );
    expect(hookIfMatches('Edit(*.ts)', { toolName: 'Write', toolInput: { file_path: 'a.ts' } })).toBe(
      false,
    );
  });
});
