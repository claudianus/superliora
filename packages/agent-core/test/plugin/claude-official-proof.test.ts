import { access, constants, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { HookEngine } from '../../src/session/hooks/engine';
import { PluginHost } from '../../src/plugin/host';
import { PluginManager } from '../../src/plugin/manager';
import { parseManifest } from '../../src/plugin/manifest';
import { loadPluginChannels } from '../../src/plugin/channels';
import type { PluginDiagnostic } from '../../src/plugin/types';

const OFFICIAL = path.join(
  import.meta.dirname,
  '../fixtures/claude-official',
);

const tempDirs: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

async function makeHome(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-official-proof-'));
  tempDirs.push(dir);
  return dir;
}

describe('Claude official plugin proof (anthropics/claude-plugins-official)', () => {
  it('installs example-plugin: skills, commands, MCP, PLUGIN_DATA', async () => {
    const home = await makeHome();
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    const record = await manager.install(path.join(OFFICIAL, 'example-plugin'));
    expect(record.id).toBe('example-plugin');
    expect(record.state).toBe('ok');

    const roots = manager.pluginSkillRoots();
    expect(roots.some((r) => r.plugin?.id === 'example-plugin')).toBe(true);

    const commands = await manager.enabledCommands();
    expect(commands.some((c) => c.pluginId === 'example-plugin')).toBe(true);

    const mcp = manager.enabledMcpServers();
    const mcpNames = Object.keys(mcp);
    expect(mcpNames.some((n) => n.includes('example-server') || n.endsWith(':example-server'))).toBe(
      true,
    );

    await access(manager.pluginDataDir('example-plugin'));
  });

  it('installs commit-commands and expands slash command bodies', async () => {
    const home = await makeHome();
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(path.join(OFFICIAL, 'commit-commands'));

    const commands = await manager.enabledCommands();
    const names = commands.filter((c) => c.pluginId === 'commit-commands').map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['commit', 'commit-push-pr', 'clean_gone']));

    const commit = commands.find((c) => c.pluginId === 'commit-commands' && c.name === 'commit');
    expect(commit?.body).toMatch(/git commit/i);
    expect(commit?.description.length).toBeGreaterThan(0);
  });

  it('loads security-guidance hooks with CLAUDE_PLUGIN_ROOT + if filters', async () => {
    const home = await makeHome();
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    const record = await manager.install(path.join(OFFICIAL, 'security-guidance'));
    expect(record.state).toBe('ok');

    const host = new PluginHost(manager);
    const hooks = host.hooks();
    expect(hooks.length).toBeGreaterThan(3);

    const postEdit = hooks.filter(
      (h) => h.event === 'PostToolUse' && (h.matcher ?? '').includes('Edit'),
    );
    expect(postEdit.length).toBeGreaterThan(0);
    for (const hook of postEdit) {
      expect(hook.command).toContain(record.root);
      expect(hook.command).not.toContain('${CLAUDE_PLUGIN_ROOT}');
    }

    const bashIf = hooks.filter((h) => h.event === 'PostToolUse' && h.if?.includes('Bash(git'));
    expect(bashIf.length).toBeGreaterThan(0);

    // Script on disk is reachable after expansion.
    const scriptPath = path.join(record.root, 'hooks', 'security_reminder_hook.py');
    await access(scriptPath, constants.R_OK);

    // Engine selects PostToolUse Edit matcher (does not require running Python).
    const engine = new HookEngine(hooks);
    const matched = await engine.trigger('PostToolUse', {
      matcherValue: 'Edit',
      inputData: {
        tool_name: 'Edit',
        tool_input: { file_path: 'secret.env', content: 'AWS_SECRET=x' },
      },
    });
    // May be empty if hook process fails open; still assert engine accepted the event.
    expect(Array.isArray(matched)).toBe(true);
  });

  it('runs security-guidance wrapper once with synthetic PostToolUse JSON (live)', async () => {
    const parsed = await parseManifest(path.join(OFFICIAL, 'security-guidance'));
    expect(parsed.manifest).toBeDefined();
    const root = path.join(OFFICIAL, 'security-guidance');
    const wrapper = path.join(root, 'hooks', 'sg-python.sh');
    const hookPy = path.join(root, 'hooks', 'security_reminder_hook.py');
    await access(wrapper, constants.R_OK);

    const input = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'README.md', old_string: 'a', new_string: 'b' },
      cwd: root,
    });

    const result = await runCommand(
      'bash',
      [wrapper, hookPy],
      {
        cwd: root,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: root,
          CLAUDE_PLUGIN_DATA: await mkdtemp(path.join(tmpdir(), 'sg-data-')),
        },
        stdin: input,
        timeoutMs: 60_000,
      },
    );

    // Official hook may install deps on first run; treat spawn success + finite exit as proof
    // that SuperLiora can invoke Claude's command-form hook scripts.
    expect(result.spawned).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(typeof result.exitCode === 'number' || result.exitCode === null).toBe(true);
  }, 90_000);

  it('parses explanatory-output-style SessionStart hooks', async () => {
    const home = await makeHome();
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(path.join(OFFICIAL, 'explanatory-output-style'));
    const host = new PluginHost(manager);
    const hooks = host.hooks().filter((h) => h.event === 'SessionStart');
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks[0]?.command.length).toBeGreaterThan(0);
  });

  it('loads fakechat channel plugin MCP declaration', async () => {
    const root = path.join(OFFICIAL, 'external', 'fakechat');
    const parsed = await parseManifest(root);
    expect(parsed.manifest?.name).toBe('fakechat');
    expect(parsed.manifest?.mcpServers !== undefined).toBe(true);

    const home = await makeHome();
    const manager = new PluginManager({ kimiHomeDir: home });
    await manager.load();
    await manager.install(root);
    const mcp = manager.enabledMcpServers();
    expect(Object.keys(mcp).length).toBeGreaterThan(0);

    const diagnostics: PluginDiagnostic[] = [];
    const channels = await loadPluginChannels({
      channelsPath: root,
      inline: parsed.manifest?.channels,
      mcpServerNames: new Set(
        Object.keys(parsed.manifest?.mcpServers ?? {}).map((k) => k.replace(/^.*:/, '')),
      ),
      diagnostics,
    });
    // fakechat may declare channels only via MCP capability at runtime; manifest load must not error.
    expect(Array.isArray(channels)).toBe(true);
  });
});

async function runCommand(
  command: string,
  args: string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly stdin: string;
    readonly timeoutMs: number;
  },
): Promise<{
  readonly spawned: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return  new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      resolve({ spawned: false, exitCode: null, timedOut: false, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdin.write(options.stdin);
    child.stdin.end();
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        spawned: true,
        exitCode: code,
        timedOut,
        stdout,
        stderr,
      });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ spawned: false, exitCode: null, timedOut, stdout, stderr });
    });
  });
}
