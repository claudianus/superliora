import { constants } from 'node:os';
import type { Readable } from 'node:stream';
import type {
  AgentSideConnection, CreateTerminalRequest, TerminalHandle,
  TerminalOutputResponse, WaitForTerminalExitResponse,
} from '@agentclientprotocol/sdk';
import type { Kaos } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';
import { AcpKaos } from '../src/kaos-acp';
import { AcpTerminalProcess } from '../src/terminal-process';
import {
  toolProgressToSessionUpdate, toolResultToSessionUpdate,
  subagentToolProgressToSessionUpdate, subagentToolResultToSessionUpdate,
} from '../src/convert/events-map';

function terminalFixture() {
  const exited = Promise.withResolvers<WaitForTerminalExitResponse>();
  const output = Promise.withResolvers<TerminalOutputResponse>();
  const terminal = {
    id: 'editor-terminal',
    waitForExit: vi.fn(() => exited.promise),
    currentOutput: vi.fn(() => output.promise),
    kill: vi.fn(async () => ({})),
    release: vi.fn(async () => ({})),
  };
  return { exited, output, terminal, handle: terminal as unknown as TerminalHandle };
}

async function collect(stream: Readable) {
  let text = '';
  for await (const chunk of stream) text += Buffer.from(chunk).toString('utf8');
  return text;
}

function innerFixture() {
  const exec = vi.fn(async () => { throw new Error('Unexpected local execution'); });
  const execWithEnv = vi.fn(async () => { throw new Error('Unexpected local execution'); });
  const inner: Partial<Kaos> = {
    getcwd: () => '/workspace',
    withEnv: () => inner as Kaos,
    withCwd: () => inner as Kaos,
    exec,
    execWithEnv,
  };
  return { inner: inner as Kaos, exec, execWithEnv };
}

describe('native editor terminal execution', () => {
  it('uses the actual command, cwd and environment without inventing a PID', async () => {
    const fixture = terminalFixture();
    const local = innerFixture();
    const requests: CreateTerminalRequest[] = [];
    const conn = {
      createTerminal: vi.fn(async (request: CreateTerminalRequest) => {
        requests.push(request);
        return fixture.handle;
      }),
    } as unknown as AgentSideConnection;
    const env = { FLAG: 'initial' };
    const kaos = new AcpKaos(conn, 'session-one', local.inner, { terminal: true }).withEnv(env);
    env.FLAG = 'updated';
    const proc = await kaos.execWithEnv(['/bin/bash', '-c', 'printf hello'], { EXTRA: 'value' });
    expect(requests).toEqual([{
      sessionId: 'session-one', command: '/bin/bash', args: ['-c', 'printf hello'],
      cwd: '/workspace', env: [{ name: 'FLAG', value: 'updated' }, { name: 'EXTRA', value: 'value' }],
    }]);
    expect(local.execWithEnv).not.toHaveBeenCalled();
    expect(proc.pid).toBeUndefined();
    expect(proc.terminalId).toBe('editor-terminal');
    expect(proc.exitCode).toBeNull();
    const stdout = collect(proc.stdout);
    const stderr = collect(proc.stderr);
    fixture.exited.resolve({ exitCode: 0 });
    fixture.output.resolve({ output: 'hello', truncated: false });
    await expect(proc.wait()).resolves.toBe(0);
    await expect(stdout).resolves.toBe('hello');
    await expect(stderr).resolves.toBe('');
    expect(proc.outputTruncated).toBe(false);
    await proc.dispose();
    expect(fixture.terminal.release).toHaveBeenCalledTimes(1);
  });

  it('never falls back to local execution after an editor creation error', async () => {
    const local = innerFixture();
    const error = new Error('Editor unavailable');
    const conn = { createTerminal: vi.fn(async () => { throw error; }) } as unknown as AgentSideConnection;
    const kaos = new AcpKaos(conn, 'session-one', local.inner, { terminal: true });
    await expect(kaos.exec('/bin/bash', '-c', 'pwd')).rejects.toBe(error);
    expect(local.exec).not.toHaveBeenCalled();
    expect(local.execWithEnv).not.toHaveBeenCalled();
  });

  it('keeps cancellation and disposal pending until exit and final capture settle', async () => {
    const fixture = terminalFixture();
    const proc = new AcpTerminalProcess(fixture.handle);
    const stdout = collect(proc.stdout);
    const stderr = collect(proc.stderr);
    const disposal = proc.dispose();
    let disposed = false;
    void disposal.then(() => { disposed = true; });
    await proc.kill();
    expect(fixture.terminal.kill).toHaveBeenCalledTimes(1);
    expect(fixture.terminal.release).not.toHaveBeenCalled();
    expect(proc.exitCode).toBeNull();
    expect(disposed).toBe(false);
    fixture.exited.resolve({ signal: 'SIGTERM' });
    await Promise.resolve();
    expect(fixture.terminal.release).not.toHaveBeenCalled();
    fixture.output.resolve({ output: 'retained tail', truncated: true });
    await expect(proc.wait()).resolves.toBe(128 + constants.signals.SIGTERM);
    await expect(stdout).resolves.toBe('retained tail');
    await expect(stderr).resolves.toContain('Editor truncated terminal output');
    await disposal;
    expect(proc.outputTruncated).toBe(true);
    expect(fixture.terminal.release).toHaveBeenCalledTimes(1);
    await proc.dispose();
    expect(fixture.terminal.release).toHaveBeenCalledTimes(1);
  });

  it('rejects missing exit status instead of reporting successful execution', async () => {
    const fixture = terminalFixture();
    const proc = new AcpTerminalProcess(fixture.handle);
    proc.stdout.resume();
    proc.stderr.resume();
    fixture.exited.resolve({});
    fixture.output.resolve({ output: '', truncated: false });
    await expect(proc.wait()).rejects.toThrow('without an exit code or known signal');
    expect(proc.exitCode).toBeNull();
    await expect(proc.dispose()).rejects.toThrow('without an exit code or known signal');
    expect(fixture.terminal.release).toHaveBeenCalledTimes(1);
    expect(proc.resourcesSettled).toBe(true);
  });

  it('does not release remote ownership when native exit confirmation fails', async () => {
    const fixture = terminalFixture();
    const proc = new AcpTerminalProcess(fixture.handle);
    expect(proc.resourcesSettled).toBeUndefined();
    proc.stdout.resume();
    proc.stderr.resume();
    fixture.exited.reject(new Error('Terminal transport disconnected'));
    await expect(proc.wait()).rejects.toThrow('transport disconnected');
    await expect(proc.dispose()).rejects.toThrow('transport disconnected');
    expect(proc.resourcesSettled).toBe(false);
    expect(fixture.terminal.release).not.toHaveBeenCalled();
  });
  it('reports unsettled resources when confirmed exit is followed by a release error', async () => {
    const fixture = terminalFixture();
    fixture.terminal.release.mockRejectedValueOnce(new Error('Editor release failed'));
    const proc = new AcpTerminalProcess(fixture.handle);
    proc.stdout.resume();
    proc.stderr.resume();
    fixture.exited.resolve({ exitCode: 0 });
    fixture.output.resolve({ output: '', truncated: false });
    await expect(proc.wait()).resolves.toBe(0);
    await expect(proc.dispose()).rejects.toThrow('Editor release failed');
    expect(proc.exitCode).toBe(0);
    expect(proc.resourcesSettled).toBe(false);
  });
  it('re-observes only the same terminal after an explicit stop following a failed wait', async () => {
    const fixture = terminalFixture();
    const retryExit = Promise.withResolvers<WaitForTerminalExitResponse>();
    fixture.terminal.waitForExit
      .mockImplementationOnce(() => fixture.exited.promise)
      .mockImplementationOnce(() => retryExit.promise);
    const proc = new AcpTerminalProcess(fixture.handle);
    proc.stdout.resume();
    proc.stderr.resume();
    const initialWait = proc.wait();
    fixture.exited.reject(new Error('Initial exit observation failed'));
    await expect(initialWait).rejects.toThrow('Initial exit observation failed');
    await expect(proc.dispose()).rejects.toThrow('Initial exit observation failed');
    expect(proc.resourcesSettled).toBe(false);
    expect(fixture.terminal.waitForExit).toHaveBeenCalledTimes(1);
    expect(fixture.terminal.release).not.toHaveBeenCalled();

    await proc.kill();
    expect(fixture.terminal.kill).toHaveBeenCalledTimes(1);
    expect(fixture.terminal.waitForExit).toHaveBeenCalledTimes(2);
    expect(proc.exitCode).toBeNull();
    expect(proc.resourcesSettled).toBe(false);
    const disposal = proc.dispose();
    expect(fixture.terminal.release).not.toHaveBeenCalled();
    retryExit.resolve({ exitCode: 143 });
    await expect(proc.wait()).resolves.toBe(143);
    await disposal;
    expect(proc.resourcesSettled).toBe(true);
    expect(fixture.terminal.release).toHaveBeenCalledTimes(1);
    expect(fixture.terminal.currentOutput).not.toHaveBeenCalled();
    await expect(initialWait).rejects.toThrow('Initial exit observation failed');
  });

  it('retains actual terminal content through tool progress and completion', () => {
    const accumulator: { output: string; terminalId?: string } = { output: '' };
    const progress = toolProgressToSessionUpdate('session-one', {
      type: 'tool.progress', turnId: 4, toolCallId: 'bash-one',
      update: { kind: 'custom', customData: { terminalId: 'editor-terminal' } },
    }, accumulator);
    expect(progress?.update).toMatchObject({
      sessionUpdate: 'tool_call_update', toolCallId: '4:bash-one',
      content: [{ type: 'terminal', terminalId: 'editor-terminal' }],
    });
    expect(toolProgressToSessionUpdate('session-one', {
      type: 'tool.progress', turnId: 4, toolCallId: 'bash-one',
      update: { kind: 'stdout', text: 'already displayed in editor terminal' },
    }, accumulator)).toBeNull();
    const result = toolResultToSessionUpdate('session-one', {
      type: 'tool.result', turnId: 4, toolCallId: 'bash-one',
      output: 'actual Bash result', isError: false,
    }, accumulator.terminalId);
    expect(result.update).toMatchObject({
      status: 'completed', rawOutput: 'actual Bash result',
      content: [{ type: 'terminal', terminalId: 'editor-terminal' }],
    });
  });
  it('preserves the real worker terminal identity through progress and completion', () => {
    const accumulator: { output: string; terminalId?: string } = { output: '' };
    const progress = subagentToolProgressToSessionUpdate('session-one', {
      type: 'subagent.tool_progress', subagentId: 'worker-one', toolCallId: 'bash-one',
      kind: 'status', terminalId: 'worker-terminal',
    }, accumulator);
    expect(progress?.update).toMatchObject({
      toolCallId: 'sub:worker-one:bash-one',
      content: [{ type: 'terminal', terminalId: 'worker-terminal' }],
    });
    expect(subagentToolProgressToSessionUpdate('session-one', {
      type: 'subagent.tool_progress', subagentId: 'worker-one', toolCallId: 'bash-one',
      kind: 'stdout', textPreview: 'already displayed in worker terminal',
    }, accumulator)).toBeNull();
    const result = subagentToolResultToSessionUpdate('session-one', {
      type: 'subagent.tool_result', subagentId: 'worker-one', toolCallId: 'bash-one',
      name: 'Bash', resultPreview: 'actual worker result', isError: false,
    }, accumulator.terminalId);
    expect(result.update).toMatchObject({
      status: 'completed',
      content: [{ type: 'terminal', terminalId: 'worker-terminal' }],
    });
  });
});
