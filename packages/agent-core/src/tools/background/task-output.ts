/**
 * TaskOutputTool — read output from a background task.
 *
 * Returns structured task metadata plus a fixed-size tail preview of the
 * task's output. The full, never-truncated output lives on disk at
 * `output_path`; the caller is always pointed at the `Read` tool to page
 * through the complete log, and the preview also carries a banner when it
 * has been truncated to a tail.
 *
 * For terminal tasks the output also surfaces why the task ended:
 * `stop_reason` records the concrete reason; `terminal_reason` classifies
 * timeout vs. explicit stop vs. failure for callers that need stable labels.
 *
 * Multi-wait: pass `task_ids` (≤20) with `wait_mode` `all` | `any` to block
 * on several background tasks (AC5 wait multi).
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../agent/tool';
import {
  type BackgroundManager,
  isBackgroundTaskTerminal,
  MAX_MULTI_WAIT_TASKS,
  MultiWaitLimitError,
  type BackgroundTaskInfo,
  type BackgroundTaskOutputSnapshot,
  type BackgroundTaskStatus,
} from '../../agent/background';
import type { ExecutableToolResult, ToolExecution } from '../../loop/types';
import { toInputJsonSchema } from '../support/input-schema';
import { matchesGlobRuleSubject } from '../support/rule-match';
import { formatPlainObject } from './format';
import TASK_OUTPUT_DESCRIPTION from './task-output.md?raw';

/**
 * Maximum bytes of output included inline as a preview. Output larger
 * than this is truncated to its tail; the full log is read separately
 * via the `Read` tool with the returned `output_path`.
 */
const OUTPUT_PREVIEW_BYTES = 32 * 1024; // 32 KiB

/** Number of lines the paging hint suggests reading per `Read` call. */
const PAGING_HINT_LINES = 300;

// ── Input schema ─────────────────────────────────────────────────────

export const TaskOutputInputSchema = z
  .object({
    task_id: z.string().optional().describe('The background task ID to inspect (single-task mode).'),
    task_ids: z
      .array(z.string())
      .max(MAX_MULTI_WAIT_TASKS)
      .optional()
      .describe(
        `Multiple background task IDs (≤${String(MAX_MULTI_WAIT_TASKS)}) for wait_any / wait_all. Mutually exclusive with a different single task_id unless task_id is also listed.`,
      ),
    wait_mode: z
      .enum(['single', 'all', 'any'])
      .default('single')
      .optional()
      .describe(
        'Wait strategy when task_ids is set: all = wait_all, any = wait_any. Default single uses task_id.',
      ),
    block: z
      .boolean()
      .default(false)
      .describe('Whether to wait for the task(s) to finish before returning.')
      .optional(),
    timeout: z
      .number()
      .int()
      .min(0)
      .max(3600)
      .default(30)
      .describe('Maximum number of seconds to wait when block=true.')
      .optional(),
  })
  .superRefine((val, ctx) => {
    const hasSingle = val.task_id !== undefined && val.task_id.trim() !== '';
    const hasMulti = val.task_ids !== undefined && val.task_ids.length > 0;
    if (!hasSingle && !hasMulti) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide task_id or task_ids.',
        path: ['task_id'],
      });
    }
    if (hasMulti && ! (val.wait_mode === 'all' || val.wait_mode === 'any')) {
      // allow default single when only one id in task_ids
      if ((val.task_ids?.length ?? 0) > 1 && (val.wait_mode === undefined || val.wait_mode === 'single')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'wait_mode must be "all" or "any" when multiple task_ids are provided.',
          path: ['wait_mode'],
        });
      }
    }
  });

export type TaskOutputInput = z.Infer<typeof TaskOutputInputSchema>;

// ── Implementation ───────────────────────────────────────────────────

function retrievalStatus(
  status: BackgroundTaskStatus,
  block: boolean | undefined,
): 'success' | 'timeout' | 'not_ready' {
  if (isBackgroundTaskTerminal(status)) return 'success';
  return block ? 'timeout' : 'not_ready';
}

function terminalReason(info: BackgroundTaskInfo): 'timed_out' | 'stopped' | 'failed' | undefined {
  if (info.status === 'timed_out') return 'timed_out';
  if (info.status === 'killed' && info.stopReason !== undefined) return 'stopped';
  if (info.status === 'failed' && info.stopReason !== undefined) return 'failed';
  return undefined;
}

function fullOutputHint(output: BackgroundTaskOutputSnapshot): string | undefined {
  if (!output.fullOutputAvailable || output.outputPath === undefined) return undefined;
  if (output.truncated) {
    return (
      `Only the last ${String(OUTPUT_PREVIEW_BYTES)} bytes are shown above. ` +
      'Use the Read tool with the output_path to page through the full log ' +
      `(parameters: path, line_offset, n_lines; read about ${String(PAGING_HINT_LINES)} ` +
      'lines per page).'
    );
  }
  return (
    'The preview above is the complete output. Use the Read tool with the output_path ' +
    'if you need to re-read the full log later ' +
    `(parameters: path, line_offset, n_lines; read about ${String(PAGING_HINT_LINES)} ` +
    'lines per page).'
  );
}

function resolveTaskIdList(args: TaskOutputInput): string[] {
  const ids: string[] = [];
  if (args.task_ids !== undefined) {
    for (const id of args.task_ids) {
      const trimmed = id.trim();
      if (trimmed !== '') ids.push(trimmed);
    }
  }
  if (args.task_id !== undefined && args.task_id.trim() !== '') {
    const single = args.task_id.trim();
    if (!ids.includes(single)) ids.unshift(single);
  }
  return ids;
}

export class TaskOutputTool implements BuiltinTool<TaskOutputInput> {
  readonly name = 'TaskOutput' as const;
  readonly description: string = TASK_OUTPUT_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TaskOutputInputSchema);

  constructor(private readonly manager: BackgroundManager) {}

  resolveExecution(args: TaskOutputInput): ToolExecution {
    const ids = resolveTaskIdList(args);
    const label =
      ids.length <= 1
        ? `Reading output of task ${ids[0] ?? '?'}`
        : `Waiting on ${String(ids.length)} tasks (${args.wait_mode ?? 'all'})`;
    return {
      description: label,
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, ids.join(',')),
      execute: () => this.execute(args),
    };
  }

  private async execute(args: TaskOutputInput): Promise<ExecutableToolResult> {
    const ids = resolveTaskIdList(args);
    if (ids.length === 0) {
      return { isError: true, output: 'Task not found: (empty id)' };
    }

    const timeoutMs = (args.timeout ?? 30) * 1000;
    const multiMode =
      ids.length > 1
        ? args.wait_mode === 'any'
          ? 'any'
          : 'all'
        : args.wait_mode === 'any' || args.wait_mode === 'all'
          ? args.wait_mode
          : 'single';

    try {
      if (args.block === true && multiMode === 'all') {
        await this.manager.waitAll(ids, timeoutMs);
      } else if (args.block === true && multiMode === 'any') {
        await this.manager.waitAny(ids, timeoutMs);
      } else if (args.block === true && multiMode === 'single') {
        await this.manager.wait(ids[0]!, timeoutMs);
      }
    } catch (error) {
      if (error instanceof MultiWaitLimitError) {
        return { isError: true, output: error.message };
      }
      throw error;
    }

    if (multiMode === 'single' || ids.length === 1) {
      return this.snapshotOne(ids[0]!, args.block);
    }

    const snapshots: unknown[] = [];
    for (const id of ids) {
      const info = this.manager.getTask(id);
      if (!info) {
        snapshots.push({ taskId: id, error: 'not_found' });
        continue;
      }
      const output = await this.manager.getOutputSnapshot(id, OUTPUT_PREVIEW_BYTES);
      snapshots.push({
        retrievalStatus: retrievalStatus(info.status, args.block),
        taskId: id,
        status: info.status,
        terminalReason: terminalReason(info),
        outputPath: output.outputPath,
        outputPreviewBytes: output.previewBytes,
        outputTruncated: output.truncated,
      });
    }

    return {
      output: [
        formatPlainObject({
          waitMode: multiMode,
          taskCount: ids.length,
          tasks: snapshots,
        }),
      ].join('\n'),
      isError: false,
      message: 'Multi-task snapshot retrieved.',
    };
  }

  private async snapshotOne(
    taskId: string,
    block: boolean | undefined,
  ): Promise<ExecutableToolResult> {
    const current = this.manager.getTask(taskId);
    if (!current) {
      return { isError: true, output: `Task not found: ${taskId}` };
    }

    const output = await this.manager.getOutputSnapshot(taskId, OUTPUT_PREVIEW_BYTES);

    const lines = [
      formatPlainObject({
        retrievalStatus: retrievalStatus(current.status, block),
        ...current,
        outputPath: output.outputPath,
        terminalReason: terminalReason(current),
        outputSizeBytes: output.outputSizeBytes,
        outputPreviewBytes: output.previewBytes,
        outputTruncated: output.truncated,
        fullOutputAvailable: output.fullOutputAvailable,
        fullOutputTool:
          output.fullOutputAvailable && output.outputPath !== undefined ? 'Read' : undefined,
        fullOutputHint: fullOutputHint(output),
      }),
      '',
    ];

    if (output.truncated) {
      lines.push(
        output.fullOutputAvailable && output.outputPath !== undefined
          ? `[Truncated. Full output: ${output.outputPath}]`
          : '[Truncated. No persisted full log is available for this task.]',
      );
    }
    lines.push('[output]', output.preview || '[no output available]');

    return {
      output: lines.join('\n'),
      isError: false,
      message: 'Task snapshot retrieved.',
    };
  }
}
