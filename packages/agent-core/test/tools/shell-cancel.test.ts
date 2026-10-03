import { Readable, type Writable } from 'node:stream';

import type { Environment, KaosProcess } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';

import { BashTool } from '../../src/tools/builtin/shell/bash';
import { createBackgroundManager } from '../agent/background/helpers';
import { executeTool } from './fixtures/execute-tool';
import { createFakeKaos } from './fixtures/fake-kaos';

const posixEnv: Environment = {
  osKind: 'Linux',
  osArch: 'x86_64',
  osVersion: 'test',
  shellPath: '/bin/bash',
  shellName: 'bash',
};

describe('BashTool cancellation contract', () => {
  it('keeps cancellation pending through actual process exit and cleanup', async () => {
    const exited = Promise.withResolvers<number>();
    const cleaned = Promise.withResolvers<void>();
    const kill = vi.fn(async () => {});
    const proc: KaosProcess = {
      stdin: { end: vi.fn(), write: vi.fn() } as unknown as Writable,
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      pid: 501,
      exitCode: null,
      wait: vi.fn(() => exited.promise),
      kill,
      dispose: vi.fn(() => cleaned.promise),
    };
    const execWithEnv = vi.fn().mockResolvedValue(proc);
    const controller = new AbortController();
    const { manager } = createBackgroundManager();
    const tool = new BashTool(
      createFakeKaos({ execWithEnv, osEnv: posixEnv }),
      '/workspace',
      manager,
    );

    const running = executeTool(tool, {
      turnId: '0',
      toolCallId: 'tc_cancel',
      args: { command: 'sleep 2 && printf should-not-exist > cancel_output.txt' },
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(proc.stdin.end).toHaveBeenCalled();
    });
    let settled = false;
    void running.then(() => { settled = true; });
    controller.abort();
    try {
      await vi.waitFor(() => {
        expect(kill).toHaveBeenCalledWith('SIGTERM');
      });
      const taskId = manager.list(false)[0]!.taskId;
      expect(manager.getTask(taskId)).toMatchObject({ status: 'running', exitCode: null });
      expect(proc.dispose).not.toHaveBeenCalled();
      expect(settled).toBe(false);

      exited.resolve(143);
      await vi.waitFor(() => {
        expect(proc.dispose).toHaveBeenCalled();
      });
      expect(manager.getTask(taskId)).toMatchObject({ status: 'running' });
      expect(settled).toBe(false);

      cleaned.resolve();
      const result = await running;
      expect(manager.getTask(taskId)).toMatchObject({ status: 'killed', exitCode: 143 });
      expect(result).toMatchObject({ isError: true });
      expect(result.output).toContain('Interrupted by user');
    } finally {
      exited.resolve(143);
      cleaned.resolve();
      await running;
    }
  });
});
