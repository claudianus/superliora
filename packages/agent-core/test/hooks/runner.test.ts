import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

const RUNNER_MODULE = '../../src/session/hooks/runner' as string;

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface HookResult {
  action: 'allow' | 'block';
  message?: string;
  reason?: string;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  structuredOutput?: boolean;
}

type RunHook = (
  command: string,
  input: Record<string, unknown>,
  options: { timeout: number; cwd?: string; args?: readonly string[] },
) => Promise<HookResult>;

async function importRunHook(): Promise<RunHook> {
  const mod = (await import(RUNNER_MODULE)) as { runHook: RunHook };
  return mod.runHook;
}

describe('runHook process runner', () => {
  it('returns allow when the hook exits 0 and captures stdout', async () => {
    const runHook = await importRunHook();
    const result = await runHook('echo ok', { tool_name: 'Shell' }, { timeout: 5 });
    expect(result.action).toBe('allow');
    expect(result.stdout?.trim()).toBe('ok');
  });

  it('parses stdout JSON message into a hook result message', async () => {
    const runHook = await importRunHook();
    const result = await runHook("node -e \"process.stdout.write(JSON.stringify({message:'hook says hi'}))\"", {}, { timeout: 5 });
    expect(result.action).toBe('allow');
    expect(result.message).toBe('hook says hi');
    expect(result.structuredOutput).toBe(true);
  });

  it('marks structured stdout JSON without message as empty hook output', async () => {
    const runHook = await importRunHook();

    const emptyObject = await runHook("node -e \"process.stdout.write('{}')\"", {}, { timeout: 5 });    expect(emptyObject.action).toBe('allow');
    expect(emptyObject.message).toBeUndefined();
    expect(emptyObject.structuredOutput).toBe(true);

    const emptyHookSpecificOutput = await runHook(
      "node -e \"process.stdout.write(JSON.stringify({hookSpecificOutput:{}}))\"",
      {},
      { timeout: 5 },
    );
    expect(emptyHookSpecificOutput.action).toBe('allow');
    expect(emptyHookSpecificOutput.message).toBeUndefined();
    expect(emptyHookSpecificOutput.structuredOutput).toBe(true);
  });

  it('returns block when the hook exits 2 and captures stderr as the reason', async () => {
    const runHook = await importRunHook();
    const result = await runHook(
      "node -e \"process.stderr.write('blocked');process.exit(2)\"",
      { tool_name: 'Shell' },
      { timeout: 5 },
    );
    expect(result.action).toBe('block');
    expect(result.reason).toContain('blocked');
  });

  it('returns allow on non-zero, non-2 exit codes (e.g. exit 1)', async () => {
    const runHook = await importRunHook();
    const result = await runHook('exit 1', { tool_name: 'Shell' }, { timeout: 5 });
    expect(result.action).toBe('allow');
  });

  it('returns allow with timedOut=true when the command exceeds the timeout', async () => {
    const runHook = await importRunHook();
    const result = await runHook(
      process.execPath,
      { tool_name: 'Shell' },
      { timeout: 1, args: ['-e', 'setTimeout(() => {}, 20_000)'] },
    );
    expect(result.action).toBe('allow');
    expect(result.timedOut).toBe(true);
  });

  it('parses stdout JSON permissionDecision=deny into a block result with the supplied reason', async () => {
    const runHook = await importRunHook();
    const cmd =
      "node -e \"process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'use rg'}}))\"";
    const result = await runHook(cmd, { tool_name: 'Bash' }, { timeout: 5 });
    expect(result.action).toBe('block');
    expect(result.reason).toBe('use rg');
  });

  it('parses JSON continue:false into a halt result with stopReason', async () => {
    const runHook = await importRunHook();
    const cmd =
      "node -e \"process.stdout.write(JSON.stringify({continue:false,stopReason:'stop worker'}))\"";
    const result = await runHook(cmd, { hook_event_name: 'TaskCreated' }, { timeout: 5 });
    expect(result.action).toBe('allow');
    expect(result.halt).toBe(true);
    expect(result.stopReason).toBe('stop worker');
  });

  it('parses JSON systemMessage on allow', async () => {
    const runHook = await importRunHook();
    const cmd =
      "node -e \"process.stdout.write(JSON.stringify({systemMessage:'watch this'}))\"";
    const result = await runHook(cmd, {}, { timeout: 5 });
    expect(result.action).toBe('allow');
    expect(result.systemMessage).toBe('watch this');
  });

  it('writes the input payload to the hook process stdin as JSON', async () => {
    const runHook = await importRunHook();
    const cmd =
      'node -e "let s=\\"\\";process.stdin.on(\\"data\\",d=>s+=d);process.stdin.on(\\"end\\",()=>{const o=JSON.parse(s);process.stdout.write(o.tool_name);})"';
    const result = await runHook(cmd, { tool_name: 'WriteFile' }, { timeout: 5 });
    expect(result.stdout?.trim()).toBe('WriteFile');
  });
});

/**
 * The exec-form split exists because `shell: true` hands the whole line to
 * cmd.exe, which truncates an executable path at its first space
 * (`C:\Program Files\...\node.exe` -> "not recognized" on Windows). The probe
 * behind it had a discarded `isFile()` result, so any existing path including a
 * directory looked like an executable, and it resolved relative paths against
 * process.cwd() rather than the hook's cwd.
 */
describe('leadingExecutablePath', () => {
  async function probe(): Promise<(command: string, cwd?: string) => string | undefined> {
    const mod = (await import(RUNNER_MODULE)) as {
      leadingExecutablePath: (command: string, cwd?: string) => string | undefined;
    };
    return mod.leadingExecutablePath;
  }

  it('does not treat a directory as an executable', async () => {
    const leading = await probe();
    const dir = mkdtempSync(join(tmpdir(), 'hook-dir-'));
    dirs.push(dir);
    // A spaced directory name with no slash in the first token, so the
    // probe's own tokenization lands on it. A discarded `isFile()` result
    // accepts it, the hook takes the exec-form branch, and the spawn dies with
    // EISDIR instead of running through the shell.
    mkdirSync(join(dir, 'my tools'), { recursive: true });
    expect(leading('my tools', dir)).toBeUndefined();
    expect(leading('my tools --flag', dir)).toBeUndefined();
  });

  it('does not take over a space-free executable', async () => {
    const leading = await probe();
    const dir = mkdtempSync(join(tmpdir(), 'hook-plain-'));
    dirs.push(dir);
    const file = join(dir, 'hook-script');
    writeFileSync(file, '#!/bin/sh\n', 'utf-8');
    // The plain shell form already handles this and may use shell syntax.
    expect(leading('hook-script --flag', dir)).toBeUndefined();
  });

  it('leaves an already quoted command to the shell', async () => {
    const leading = await probe();
    expect(leading('"C:\\Program Files\\node.exe" script.js', process.cwd())).toBeUndefined();
  });

  it('resolves a relative executable against the hook cwd, not process cwd', async () => {
    const leading = await probe();
    const dir = mkdtempSync(join(tmpdir(), 'hook-cwd-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'my tools'), { recursive: true });
    writeFileSync(join(dir, 'my tools', 'run.sh'), '#!/bin/sh\n', 'utf-8');
    // Only resolvable when `cwd` is honoured; against process.cwd() it is not.
    expect(leading('my tools/run.sh --flag', dir)).toBe(join('my tools', 'run.sh'));
  });
});
