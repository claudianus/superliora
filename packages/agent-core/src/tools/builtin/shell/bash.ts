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

import type { Kaos } from '@superliora/kaos';

import { ProcessBackgroundTask, type BackgroundManager } from '../../../agent/background';
import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution, ToolUpdate } from '../../../loop/types';
import { renderPrompt } from '../../../utils/render-prompt';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesGlobRuleSubject } from '../../support/rule-match';
import {
  type ExecutableToolResultBuilderResult,
  ToolResultBuilder,
} from '../../support/result-builder';
import { appendTextToolMeta } from '../../support/text-result-meta';
import type { ToolStore } from '../../store';
import { archiveContent } from '../context/context-archive';
import { compressShellOutput } from '../context/context-terse';
import {
  buildShellChildEnv,
  type ShellEnvFilterPolicy,
} from '../../policies/shell-env';
import {
  detectShellDedicatedBypass,
  formatShellDedicatedBypassError,
} from '../../policies/shell-dedicated-bypass';
import {
  detectShellSensitivePath,
  formatShellSensitivePathError,
} from '../../policies/shell-sensitive-path';
import bashDescriptionTemplate from './bash.md?raw';
import {
  backgroundResultMessage,
  BashInputSchema,
  closeProcessStdin,
  DEFAULT_BACKGROUND_TIMEOUT_S,
  DEFAULT_TIMEOUT_S,
  foregroundDescription,
  formatTimeoutLabel,
  killSpawnedProcess,
  MS_PER_SECOND,
  MAX_TIMEOUT_S,
  normalizeTimeoutMs,
  rewriteWindowsNullRedirect,
  shellQuote,
  shouldCompressOutput,
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

function withoutBackgroundDescription(description: string): string {
  return description
    .replace(
      /\r?\n\r?\n\*\*Background:\*\*[\s\S]*?Users inspect tasks via `\/tasks`\./,
      '\n\nBackground execution is disabled for this agent. Do not set `run_in_background=true`.',
    )
    .replace(
      /\r?\n\r?\nIf `run_in_background=true`,[\s\S]*?Users inspect tasks via `\/tasks`\./,
      '\n\nBackground execution is disabled for this agent. Do not set `run_in_background=true`.',
    )
    .replace(
      /\r?\n\r?\nIf `run_in_background=true`,[\s\S]*?point them to the `\/tasks` command, which opens an interactive panel; it has no subcommands\./,
      '\n\nBackground execution is disabled for this agent. Do not set `run_in_background=true`.',
    )
    .replace(
      ` For possibly long-running foreground commands, set the \`timeout\` argument in seconds. Foreground commands default to ${String(DEFAULT_TIMEOUT_S)}s and allow up to ${String(MAX_TIMEOUT_S)}s.`,
      ` For possibly long-running commands, set the \`timeout\` argument in seconds. The default is ${String(DEFAULT_TIMEOUT_S)}s; foreground commands allow up to ${String(MAX_TIMEOUT_S)}s.`,
    )
    .replace(
      /\r?\n- Prefer `run_in_background=true`[\s\S]*?conversation to continue before the command finishes\./,
      '\n- Do not set `run_in_background=true`; background task management tools are not available.',
    );
}

export class BashTool implements BuiltinTool<BashInput> {
  readonly name = 'Bash' as const;
  readonly description: string;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(BashInputSchema);

  private readonly isWindowsBash: boolean;

  private readonly allowBackground: boolean;

  private readonly store: ToolStore | undefined;

  private readonly shellEnvPolicy: ShellEnvFilterPolicy;

  constructor(
    private readonly kaos: Kaos,
    private readonly cwd: string,
    private readonly backgroundManager: BackgroundManager,
    options?: {
      allowBackground?: boolean | undefined;
      store?: ToolStore | undefined;
      /** Shell env secret filter; default strips KEY/SECRET/TOKEN name patterns. */
      shellEnvPolicy?: ShellEnvFilterPolicy | undefined;
    },
  ) {
    this.isWindowsBash = this.kaos.osEnv.osKind === 'Windows';
    this.allowBackground = options?.allowBackground ?? true;
    this.store = options?.store;
    this.shellEnvPolicy = options?.shellEnvPolicy ?? {};
    const rendered = renderBashDescription(this.kaos.osEnv.shellName);
    this.description = this.allowBackground ? rendered : withoutBackgroundDescription(rendered);
  }

  resolveExecution(args: BashInput): ToolExecution {
    const preview = args.command.length > 50 ? `${args.command.slice(0, 50)}…` : args.command;
    return {
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

  private spawn(effectiveCwd: string, command: string): Promise<KaosProcess> {
    const shellCwd = this.isWindowsBash ? windowsPathToPosixPath(effectiveCwd) : effectiveCwd;
    const shellArgs = [
      this.kaos.osEnv.shellPath,
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
      SHELL: this.kaos.osEnv.shellPath,
    };

    // Ambient env is secret-filtered before noninteractive knobs so child
    // shells never inherit *KEY*/*SECRET*/*TOKEN* names (values never logged).
    const mergedEnv = buildShellChildEnv(process.env, noninteractiveEnv, this.shellEnvPolicy);
    return this.kaos.execWithEnv(shellArgs, mergedEnv);
  }

  private async execution(
    args: BashInput,
    signal: AbortSignal,
    onUpdate?: ((update: ToolUpdate) => void) | undefined,
    onForegroundTaskStart?: ((taskId: string) => void) | undefined,
  ): Promise<ExecutableToolResult> {
    const validationError = this.validateRunRequest(args, signal);
    if (validationError !== undefined) return validationError;

    const startsInBackground = args.run_in_background === true;
    const foregroundTimeoutMs = normalizeTimeoutMs(args.timeout, false);
    const command = this.isWindowsBash ? rewriteWindowsNullRedirect(args.command) : args.command;
    const effectiveCwd = args.cwd ?? this.cwd;
    const description = startsInBackground ? args.description!.trim() : foregroundDescription(args);
    const timeoutMs = startsInBackground
      ? args.disable_timeout
        ? undefined
        : normalizeTimeoutMs(args.timeout, true)
      : foregroundTimeoutMs;

    const builder = new ToolResultBuilder();
    let proc: KaosProcess;
    try {
      proc = await this.spawn(effectiveCwd, command);
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

    let taskId: string;
    try {
      taskId = this.backgroundManager.registerTask(
        new ProcessBackgroundTask(proc, command, description, onProcessOutput),
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
      await killSpawnedProcess(proc);
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }

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
          'foreground_detached',
        );
      }

      return await this.foregroundCompletionResult(taskId, proc, builder, foregroundTimeoutMs, args);
    } finally {
      collectForegroundOutput = false;
    }
  }

  private validateRunRequest(
    args: BashInput,
    signal: AbortSignal,
  ): ExecutableToolResult | undefined {
    if (signal.aborted) return { isError: true, output: 'Aborted before command started' };
    if (args.command.length === 0) return { isError: true, output: 'Command cannot be empty.' };
    // Sensitive paths hard-deny before dedicated-tool redirects (no force hatch).
    const sensitivePath = detectShellSensitivePath(args.command);
    if (sensitivePath !== undefined) {
      return {
        isError: true,
        output: formatShellSensitivePathError(sensitivePath),
      };
    }
    const dedicatedBypass = detectShellDedicatedBypass(args.command);
    if (dedicatedBypass !== undefined) {
      return {
        isError: true,
        output: formatShellDedicatedBypassError(dedicatedBypass),
      };
    }
    if (args.run_in_background !== true) return undefined;
    if (!this.allowBackground) {
      return {
        isError: true,
        output:
          'Background execution is not available for this agent because TaskOutput and TaskStop are not enabled.',
      };
    }
    if (!args.description?.trim()) {
      return {
        isError: true,
        output: 'description is required when run_in_background is true.',
      };
    }
    return undefined;
  }

  private async foregroundCompletionResult(
    taskId: string,
    proc: KaosProcess,
    builder: ToolResultBuilder,
    foregroundTimeoutMs: number,
    args: BashInput,
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
    return this.addForegroundOutputReference(taskId, this.maybeCompressForegroundResult(args, result));
  }

  private maybeCompressForegroundResult(
    args: BashInput,
    result: ExecutableToolResultBuilderResult,
  ): ExecutableToolResultBuilderResult {
    if (!shouldCompressOutput(args, result.output) || result.output.length === 0) return result;
    const compressed = compressShellOutput({
      stdout: result.output,
      stderr: '',
      command: args.command,
    });
    if (compressed.overflow === undefined || this.store === undefined) {
      return {
        ...result,
        output:
          compressed.savedPercent > 0
            ? appendTextToolMeta(compressed.text, {
                tool: this.name,
                mode: 'foreground',
                truncated: result.truncated,
                partial: true,
                summary: `Shell output compressed (~${String(compressed.savedPercent)}% saved).`,
                nextStep: 'Use compress_output=false to keep raw output next time.',
              })
            : result.output,
      };
    }
    const archived = archiveContent({
      store: this.store,
      content: compressed.overflow,
      label: `bash:${args.command.slice(0, 80)}`,
    });
    return {
      ...result,
      output: appendTextToolMeta(
        `${compressed.text}\n${archived.marker}\nrecover: LioraExpand(id="${archived.id}")`,
        {
          tool: this.name,
          mode: 'foreground',
          truncated: result.truncated,
          partial: true,
          summary: `Shell output compressed and archived (~${String(compressed.savedPercent)}% saved).`,
          nextStep: 'Use LioraExpand to inspect archived overflow, or compress_output=false for raw output.',
        },
      ),
    };
  }

  private async addForegroundOutputReference(
    taskId: string,
    result: ExecutableToolResultBuilderResult,
  ): Promise<ExecutableToolResult> {
    if (!result.truncated) return result;
    const output = await this.backgroundManager.getOutputSnapshot(taskId, 0);
    if (!output.fullOutputAvailable || output.outputPath === undefined) return result;

    const taskOutputHint = this.allowBackground
      ? `, or TaskOutput(task_id="${taskId}", block=false)`
      : '';
    const reference =
      `\n\n[Full output saved]\n` +
      `task_id: ${taskId}\n` +
      `output_path: ${output.outputPath}\n` +
      `output_size_bytes: ${String(output.outputSizeBytes)}\n` +
      `next_step: Use Read with output_path to page through the full log${taskOutputHint}.`;
    return {
      ...result,
      output: appendTextToolMeta(`${result.output}${reference}`, {
        tool: this.name,
        mode: 'foreground',
        truncated: result.truncated,
        partial: result.truncated,
        summary: result.message,
        nextStep: 'Use Read with output_path or TaskOutput to inspect saved output.',
      }),
    };
  }

  private backgroundStartedResult(
    taskId: string,
    proc: KaosProcess,
    description: string,
    labels: { title: string; brief: string },
    builder = new ToolResultBuilder(),
    scenario: 'background_started' | 'foreground_detached' = 'background_started',
  ): ExecutableToolResult {
    const status = this.backgroundManager.getTask(taskId)?.status ?? 'running';
    const metadata =
      `task_id: ${taskId}\n` +
      `pid: ${String(proc.pid)}\n` +
      `description: ${description}\n` +
      `status: ${status}\n` +
      `automatic_notification: true\n` +
      this.nextStepLines(scenario) +
      'human_shell_hint: Tell the human to run /tasks to open the interactive background-task panel.';

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
        nextStep: 'Do not wait on the task; continue working until the completion notification arrives.',
      }),
    };
  }

  private nextStepLines(
    scenario: 'background_started' | 'foreground_detached',
  ): string {
    if (scenario === 'foreground_detached') {
      // The user explicitly moved a foreground call to the background to avoid
      // blocking the current turn. Steer the model away from waiting on it.
      // Only mention TaskOutput when the tool is actually available.
      const avoid = this.allowBackground ? 'do NOT wait, poll, or call TaskOutput on it' : 'do NOT wait or poll';
      return (
        'next_step: The task now runs in the background. You will be automatically notified ' +
        `when it completes — ${avoid}; continue with your current work.\n`
      );
    }
    // background_started: the model chose to launch in the background. Same anti-wait
    // stance — immediately waiting on a background task is just a blocked turn, so do
    // not invite a TaskOutput peek here.
    if (!this.allowBackground) {
      return 'next_step: You will be automatically notified when it completes.\n';
    }
    return (
      'next_step: The completion arrives automatically in a later turn — do NOT wait, poll, ' +
      'or call TaskOutput on it; continue with your current work.\n' +
      'next_step: Use TaskStop only if the task must be cancelled.\n'
    );
  }
}
