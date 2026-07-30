import type { ToolUpdate } from '../../loop';
import type { BuiltinTool } from './types';
import type { Agent } from '..';
import { SHELL_FOREGROUND_TIMEOUT_S } from './constants';

export interface ShellCommandHost {
  readonly agent: Agent;
  readonly builtinTools: ReadonlyMap<string, BuiltinTool>;
  readonly shellCommandControllers: Map<string, AbortController>;
}

export async function runShellCommand(
  host: ShellCommandHost,
  command: string,
  commandId?: string,
): Promise<{ stdout: string; stderr: string; isError?: boolean; backgrounded?: boolean }> {
  host.agent.context.appendBashInput(command);
  const bash = host.builtinTools.get('Bash');
  if (bash === undefined) {
    const error = 'Bash tool is not available.';
    host.agent.context.appendBashOutput('', error);
    return { stdout: '', stderr: error, isError: true };
  }
  let stdout = '';
  let stderr = '';
  let isError: boolean | undefined;
  const controller = new AbortController();
  if (commandId !== undefined) host.shellCommandControllers.set(commandId, controller);
  try {
    const execution = await bash.resolveExecution({ command, timeout: SHELL_FOREGROUND_TIMEOUT_S });
    if (!('execute' in execution)) {
      const output =
        typeof execution.output === 'string' ? execution.output : 'Command failed.';
      host.agent.context.appendBashOutput('', output);
      return { stdout: '', stderr: output, isError: true };
    }
    const result = await execution.execute({
      turnId: '',
      toolCallId: 'shell-command',
      signal: controller.signal,
      onUpdate: (update: ToolUpdate) => {
        if (update.kind === 'stdout') stdout += update.text ?? '';
        else if (update.kind === 'stderr') stderr += update.text ?? '';
        else return;
        // Stream the chunk live to the TUI. Transient event — the final
        // output is still recorded once below for resume.
        if (commandId !== undefined) {
          host.agent.emitEvent({ type: 'shell.output', commandId, update });
        }
      },
      onForegroundTaskStart: (taskId: string) => {
        // Surface the background-task id so the TUI can detach (ctrl+b) it.
        if (commandId !== undefined) {
          host.agent.emitEvent({ type: 'shell.started', commandId, taskId });
        }
      },
    });
    isError = result.isError === true;

    // Detached to background (ctrl+b): the BashTool returns the background
    // metadata (task_id / status / output path) — the same payload a normal
    // foreground Bash call returns as its tool result when backgrounded.
    // Inject it as a user-invisible message and immediately send it to the
    // model (mirrors the background-task completion notification, but hidden).
    if (typeof result.output === 'string' && result.output.startsWith('task_id: ')) {
      host.agent.context.injectAndNotify(result.output, {
        kind: 'injection',
        variant: 'shell_command_backgrounded',
      });
      return { stdout: result.output, stderr: '', isError: false, backgrounded: true };
    }

    // When the command fails with no captured stdout/stderr, the failure
    // reason lives in result.output (non-zero exit with no output, timeout,
    // spawn failure). Surface it as stderr so the TUI and replay show what
    // went wrong instead of "(no output)".
    if (
      isError &&
      stdout.length === 0 &&
      stderr.length === 0 &&
      typeof result.output === 'string' &&
      result.output.length > 0
    ) {
      stderr = result.output;
    }
  } catch (error) {
    stderr += error instanceof Error ? error.message : String(error);
    isError = true;
  } finally {
    if (commandId !== undefined) host.shellCommandControllers.delete(commandId);
  }
  host.agent.context.appendBashOutput(stdout, stderr, isError);
  return { stdout, stderr, isError };
}

export function cancelShellCommand(
  shellCommandControllers: Map<string, AbortController>,
  commandId: string,
): void {
  shellCommandControllers.get(commandId)?.abort();
}
