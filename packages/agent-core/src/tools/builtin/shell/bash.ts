/**
 * BashTool — execute shell commands.
 *
 * Invokes bash (POSIX) according to an injected `Environment`. On Windows
 * the shell is Git Bash; the path is resolved by `detectEnvironment`.
 *
 * Dependencies injected via constructor:
 *   - `Kaos`        — shell execution abstraction (exec / execWithEnv)
 *   - `cwd`         — default working directory for commands
 *   - `Environment` — cross-platform probe (shellName / shellPath)
 *   - `BackgroundManager` — task lifecycle manager for foreground/background commands
 *
 * Execution goes through Kaos, never directly via node:child_process.
 *
 * Hardening:
 *   - `args.timeout` (seconds) and the ambient `signal` both stop the
 *     manager-owned process task on either edge.
 *   - stdin is closed immediately so interactive commands (`cat`, `read`,
 *     `python -c 'input()'`) receive EOF instead of hanging.
 *   - Two-phase kill is owned by BackgroundManager: SIGTERM → grace → SIGKILL.
 *   - stdout/stderr are captured by ProcessBackgroundTask for task output;
 *     foreground runs pass a callback to collect chunks for this call.
 */

import type { Kaos, KaosProcess } from '@superliora/kaos';

import { ProcessBackgroundTask, type BackgroundManager } from '../../../agent/background';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution, ToolUpdate } from '../../../loop/types';
import { renderPrompt } from '../../../utils/render-prompt';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesGlobRuleSubject } from '../../support/rule-match';
import {
  type ExecutableToolResultBuilderResult,
  ToolResultBuilder,
} from '../../support/result-builder';
import { appendTextToolMeta } from '../../support/text-result-meta';
import {
  buildShellChildEnv,
  type ShellEnvFilterPolicy,
} from '../../policies/shell-env';
import {
  detectSandboxCwd,
  detectShellSandboxPath,
  formatShellSandboxPathError,
} from '../../policies/shell-sandbox-path';
import {
  detectShellSensitivePath,
  formatShellSensitivePathError,
} from '../../policies/shell-sensitive-path';
import type { WorkspaceConfig } from '../../support/workspace';
import bashDescriptionTemplate from './bash.md?raw';
import {
  backgroundResultMessage,
  BashInputSchema,
  closeProcessStdin,
  DEFAULT_BACKGROUND_TIMEOUT_S,
  foregroundDescription,
  formatTimeoutLabel,
  MS_PER_SECOND,
  normalizeTimeoutMs,
  rewriteWindowsNullRedirect,
  shellQuote,
  SHELL_TIMEOUT_VARS,
  USER_INTERRUPT_REASON,
  windowsPathToPosixPath,
  type BashInput,
} from './bash-support';

export {
  BashInputSchema,
  BashOutputSchema,
  type BashInput,
  type BashOutput,
} from './bash-support';

function renderBashDescription(shellName: string): string {
  return renderPrompt(bashDescriptionTemplate, { ...SHELL_TIMEOUT_VARS, SHELL_NAME: shellName });
}


export class BashTool implements BuiltinTool<BashInput> {
  readonly name = 'Bash' as const;
  readonly description: string;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(BashInputSchema);

  private readonly isWindowsBash: boolean;

  private readonly shellEnvPolicy: ShellEnvFilterPolicy;

  private readonly pathPrefix: readonly string[];

  private readonly workspace: WorkspaceConfig | undefined;
  private readonly ensureSandboxReady: (() => Promise<void>) | undefined;

  constructor(
    private readonly kaos: Kaos,
    private readonly cwd: string,
    private readonly backgroundManager: BackgroundManager,
    options?: {
      /** Shell env secret filter; default strips KEY/SECRET/TOKEN name patterns. */
      shellEnvPolicy?: ShellEnvFilterPolicy | undefined;
      /** Directories prepended to PATH (e.g. enabled plugin `bin/`). */
      pathPrefix?: readonly string[] | undefined;
      /** Await the host's requested process sandbox before executing. */
      ensureSandboxReady?: () => Promise<void>;
      /** Path-sandbox ceiling for cwd and command path tokens. */
      workspace?: WorkspaceConfig | undefined;
    },
  ) {
    this.isWindowsBash = this.kaos.osEnv.osKind === 'Windows';
    this.shellEnvPolicy = options?.shellEnvPolicy ?? {};
    this.pathPrefix = options?.pathPrefix ?? [];
    this.workspace = options?.workspace;
    this.ensureSandboxReady = options?.ensureSandboxReady;
    this.description = renderBashDescription(this.kaos.osEnv.shellName);
  }

  resolveExecution(args: BashInput): ToolExecution {
    const preview = args.command.length > 50 ? `${args.command.slice(0, 50)}…` : args.command;
    return {
      accesses: ToolAccesses.all(),
      description: args.run_in_background
        ? `Starting background: ${preview}`
        : `Running: ${preview}`,
      display: {
        kind: 'command',
        command: args.command,
        cwd: args.cwd ?? this.cwd,
        description: args.description,
        language: 'bash',
      },
      approvalRule: literalRulePattern(this.name, args.command),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.command),
      execute: ({ signal, onUpdate, onForegroundTaskStart }) =>
        this.execution(args, signal, onUpdate, onForegroundTaskStart),
    };
  }

  private spawn(kaos: Kaos, command: string): Promise<KaosProcess> {
    const shellCwd = this.isWindowsBash ? windowsPathToPosixPath(kaos.getcwd()) : kaos.getcwd();
    const shellArgs = [
      kaos.osEnv.shellPath,
      '-c',
      `cd ${shellQuote(shellCwd)} && ${command}`,
    ];

    const noninteractiveEnv: Record<string, string> = {
      NO_COLOR: '1',
      TERM: 'dumb',
      // Default to '0' so git fails fast on private remotes if a TTY happens
      // to be inherited; honour an explicit ambient value when the user has
      // set one. Re-applied after secret filtering so it always wins.
      GIT_TERMINAL_PROMPT: process.env['GIT_TERMINAL_PROMPT'] ?? '0',
      SHELL: kaos.osEnv.shellPath,
    };

    // Ambient env is secret-filtered before noninteractive knobs so child
    // shells never inherit *KEY*/*SECRET*/*TOKEN* names (values never logged).
    const mergedEnv = buildShellChildEnv(process.env, noninteractiveEnv, this.shellEnvPolicy);
    if (this.pathPrefix.length > 0) {
      const sep = this.isWindowsBash ? ';' : ':';
      // Windows env blocks spell the variable `Path`. Writing a second
      // case-variant of the same name leaves it defined twice, and the stale
      // copy can win — losing exactly the runtime/plugin dirs this prefix
      // exists to add. Rewrite the spelling that is actually there.
      const pathKey =
        mergedEnv['Path'] !== undefined && mergedEnv['PATH'] === undefined ? 'Path' : 'PATH';
      const existing = mergedEnv[pathKey] ?? mergedEnv['PATH'] ?? mergedEnv['Path'] ?? '';
      const merged = [...this.pathPrefix, existing].filter((part) => part.length > 0).join(sep);
      mergedEnv[pathKey] = merged;
      // Mirror under the other spelling at the same value so POSIX-style
      // consumers of `PATH` see the prefix too; equal values cannot conflict.
      if (pathKey === 'Path' && mergedEnv['PATH'] === undefined) {
        mergedEnv['PATH'] = merged;
      }
    }
    return kaos.execWithEnv(shellArgs, mergedEnv);
  }

  private async execution(
    args: BashInput,
    signal: AbortSignal,
    onUpdate?: ((update: ToolUpdate) => void) | undefined,
    onForegroundTaskStart?: ((taskId: string) => void) | undefined,
  ): Promise<ExecutableToolResult> {
    const startsInBackground = args.run_in_background === true;
    const foregroundTimeoutMs = normalizeTimeoutMs(args.timeout, false);
    signal.throwIfAborted();
    await this.ensureSandboxReady?.();
    signal.throwIfAborted();
    if (args.command.length === 0) return { isError: true, output: 'Command cannot be empty.' };
    const sensitivePath = detectShellSensitivePath(args.command);
    if (sensitivePath !== undefined) return { isError: true, output: formatShellSensitivePathError(sensitivePath) };
    if (startsInBackground && !args.description?.trim()) {
      return { isError: true, output: 'description is required when run_in_background is true.' };
    }
    const rawCommand = args.command;
    const command = this.isWindowsBash ? rewriteWindowsNullRedirect(rawCommand) : rawCommand;
    const effectiveCwd = args.cwd ?? this.cwd;
    if (this.workspace !== undefined) {
      const cwdHit = detectSandboxCwd(effectiveCwd, this.workspace, this.kaos);
      if (cwdHit !== undefined) {
        return { isError: true, output: formatShellSandboxPathError(cwdHit) };
      }
      const pathHit = detectShellSandboxPath(command, {
        cwd: effectiveCwd,
        workspace: this.workspace,
        kaos: this.kaos,
      });
      if (pathHit !== undefined) {
        return { isError: true, output: formatShellSandboxPathError(pathHit) };
      }
    }
    const description = startsInBackground ? args.description!.trim() : foregroundDescription(args);
    const timeoutMs = startsInBackground
      ? args.disable_timeout
        ? undefined
        : normalizeTimeoutMs(args.timeout, true)
      : foregroundTimeoutMs;

    const builder = new ToolResultBuilder();
    const executionKaos = this.kaos.withCwd(effectiveCwd);
    const processCwd = executionKaos.getcwd();
    let proc: KaosProcess;
    try {
      proc = await this.spawn(executionKaos, command);
    } catch (error) {
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
    closeProcessStdin(proc);

    let collectForegroundOutput = !startsInBackground;
    let foregroundOutputPersisted = false;
    let foregroundTaskId: string | undefined;
    const onProcessOutput = startsInBackground
      ? undefined
      : (kind: 'stdout' | 'stderr', text: string): void => {
          if (!collectForegroundOutput) return;
          onUpdate?.({ kind, text });
          builder.write(text);
          if (!foregroundOutputPersisted && builder.truncated && foregroundTaskId !== undefined) {
            this.backgroundManager.persistOutput(foregroundTaskId);
            foregroundOutputPersisted = true;
          }
        };

    const task = new ProcessBackgroundTask(proc, command, description, processCwd, onProcessOutput);
    let taskId: string;
    try {
      taskId = this.backgroundManager.registerTask(
        task,
        {
          detached: startsInBackground,
          timeoutMs,
          // Detaching (ctrl+b) moves a foreground command to the background;
          // give it the background timeout so it is not still bounded by the
          // shorter foreground deadline.
          detachTimeoutMs: DEFAULT_BACKGROUND_TIMEOUT_S * MS_PER_SECOND,
          signal: startsInBackground ? undefined : signal,
        },
      );
      foregroundTaskId = startsInBackground ? undefined : taskId;
    } catch (error) {
      collectForegroundOutput = false;
      try {
        await task.settleAbandonedProcess(error);
      } catch (cleanupError) {
        const ownedTaskId = this.backgroundManager.retainUnsettledTask(task);
        return {
          isError: true,
          output: `${error instanceof Error ? error.message : String(error)}\nNative cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\nOwned task: ${ownedTaskId}`,
        };
      }
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
    if (proc.terminalId !== undefined) onUpdate?.({ kind: 'custom', customData: { terminalId: proc.terminalId } });

    // Foreground `!` shell commands surface their task id so the TUI can detach
    // (ctrl+b) this exact task. Background runs are already detached.
    if (!startsInBackground) onForegroundTaskStart?.(taskId);

    if (startsInBackground) {
      return this.backgroundStartedResult(taskId, proc, description, {
        title: 'Background task started',
        brief: `Started ${taskId}`,
      });
    }

    try {
      const release = await this.backgroundManager.waitForForegroundRelease(taskId);
      if (release === 'detached') {
        collectForegroundOutput = false;
        return this.backgroundStartedResult(
          taskId,
          proc,
          description,
          {
            title: 'Task moved to background',
            brief: `Backgrounded ${taskId}`,
          },
          builder,
        );
      }

      return await this.foregroundCompletionResult(
        taskId,
        proc,
        builder,
        foregroundTimeoutMs,
      );
    } finally {
      collectForegroundOutput = false;
    }
  }


  private async foregroundCompletionResult(
    taskId: string,
    proc: KaosProcess,
    builder: ToolResultBuilder,
    foregroundTimeoutMs: number,
  ): Promise<ExecutableToolResult> {
    const current = this.backgroundManager.getTask(taskId);
    const exitCode = current?.kind === 'process' ? current.exitCode : proc.exitCode;
    let result: ExecutableToolResultBuilderResult;
    if (current?.status === 'timed_out') {
      const timeoutLabel = formatTimeoutLabel(foregroundTimeoutMs);
      result = builder.error(`Command killed by timeout (${timeoutLabel})`, {
        brief: `Killed by timeout (${timeoutLabel})`,
      });
    } else if (current?.status === 'killed' && current.stopReason === USER_INTERRUPT_REASON) {
      result = builder.error(USER_INTERRUPT_REASON, { brief: USER_INTERRUPT_REASON });
    } else if (
      (current?.status === 'failed' || current?.status === 'killed') &&
      current.stopReason !== undefined
    ) {
      result = builder.error(current.stopReason, { brief: current.stopReason });
    } else if (exitCode === 0) {
      result = builder.ok('Command executed successfully.');
    } else {
      if (builder.nChars === 0) builder.write(`Process exited with code ${String(exitCode)}`);
      result = builder.error(`Command failed with exit code: ${String(exitCode)}.`, {
        brief: `Failed with exit code: ${String(exitCode)}`,
      });
    }
    const withDisplay: ExecutableToolResultBuilderResult = {
      ...result,
      resultDisplay: { kind: 'command_output', exit_code: exitCode, stdout: result.output },
    };
    return this.addForegroundOutputReference(taskId, withDisplay);
  }


  private async addForegroundOutputReference(
    taskId: string,
    result: ExecutableToolResultBuilderResult,
  ): Promise<ExecutableToolResult> {
    if (!result.truncated) return result;
    const output = await this.backgroundManager.getOutputSnapshot(taskId, 0);
    if (!output.fullOutputAvailable || output.outputPath === undefined) return result;

    const reference =
      `\n\n[Full output saved]\n` +
      `task_id: ${taskId}\n` +
      `output_path: ${output.outputPath}\n` +
      `output_size_bytes: ${String(output.outputSizeBytes)}\n` +
      'next_step: Use Bash to read output_path, or SessionControl(operation="wait", id="' + taskId + '", timeout=0).';
    return {
      ...result,
      output: appendTextToolMeta(`${result.output}${reference}`, {
        tool: this.name,
        mode: 'foreground',
        truncated: result.truncated,
        partial: result.truncated,
        summary: result.message,
        nextStep: 'Use Bash or SessionControl to inspect saved output.',
      }),
    };
  }

  private backgroundStartedResult(
    taskId: string,
    proc: KaosProcess,
    description: string,
    labels: { title: string; brief: string },
    builder = new ToolResultBuilder(),
  ): ExecutableToolResult {
    const status = this.backgroundManager.getTask(taskId)?.status ?? 'running';
    const metadata =
      `task_id: ${taskId}\n` +
      `pid: ${String(proc.pid)}\n` +
      `description: ${description}\n` +
      `status: ${status}\n` +
      `automatic_notification: true\n` +
      'control: SessionControl can wait for output or stop this task.';

    const foregroundResult = builder.ok('');
    const foregroundOutput = foregroundResult.output.length > 0 ? foregroundResult.output : '';
    const message = backgroundResultMessage(labels.title, foregroundResult.message);
    const result: ExecutableToolResult & {
      readonly message: string;
      readonly brief: string;
      readonly truncated: boolean;
    } = {
      isError: false,
      output:
        foregroundOutput.length === 0
          ? metadata
          : `${metadata}\n\nforeground_output:\n${foregroundOutput}`,
      message,
      brief: labels.brief,
      truncated: foregroundResult.truncated,
    };
    return {
      ...result,
      output: appendTextToolMeta(result.output as string, {
        tool: this.name,
        mode: 'background',
        truncated: foregroundResult.truncated,
        partial: foregroundOutput.length > 0,
        summary: message,
        nextStep: 'SessionControl can wait for output or stop this task.',
      }),
    };
  }

}
