/**
 * Call-preview orchestration for ToolCallComponent: settled Write/Edit/Bash
 * previews, ExitPlanMode plan box, and streaming-args previews. Pure builders
 * for Write/Edit live in tool-call-preview; this module wires tool-name
 * dispatch and returns components for the caller to add (including staged
 * reveal for settled previews).
 */

import { Text, type Component } from '#/tui/renderer';
import { COMMAND_PREVIEW_LINES } from '#/tui/constant/rendering';
import { STREAMING_ARGS_PREVIEW_MAX_CHARS } from '#/tui/constant/streaming';
import { currentTheme } from '#/tui/theme';
import type { MarkdownTheme } from '#/tui/renderer';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import { PlanBoxComponent } from './plan-box';
import { ShellExecutionComponent } from './shell-execution';
import { extractPartialStringField, str } from './tool-call-format';
import {
  buildEditCallPreviewItems,
  buildStreamingEditComponents,
  buildStreamingWriteItems,
  buildWriteCallPreviewItems,
  resolvePlanBoxStatus,
  resolvePlanForPreview,
  resolvePlanPath,
} from './tool-call-preview';

export function buildSettledCallPreviewComponents(params: {
  readonly toolCall: ToolCallBlockData;
  readonly result: ToolResultBlockData | undefined;
  readonly expanded: boolean;
}): Component[] {
  const { toolCall, result, expanded } = params;
  const name = toolCall.name;

  if (name === 'ExitPlanMode') return [];

  if (result === undefined && toolCall.truncated === true) {
    return [
      new Text(
        currentTheme.dim('Tool call arguments truncated by max_tokens — call never executed.'),
        2,
        0,
      ),
    ];
  }

  if (result === undefined && toolCall.streamingArguments !== undefined) return [];

  const shouldCap = result !== undefined && !expanded;

  if (name === 'Write') {
    const content = str(toolCall.args['content']);
    if (content.length === 0) return [];
    const filePath = str(toolCall.args['file_path'] ?? toolCall.args['path']);
    return buildWriteCallPreviewItems({ content, filePath, expanded });
  }

  if (name === 'Edit') {
    const oldStr = str(toolCall.args['old_string']);
    const newStr = str(toolCall.args['new_string']);
    if (oldStr.length === 0 && newStr.length === 0) return [];
    const filePath = str(toolCall.args['file_path'] ?? toolCall.args['path']);
    return buildEditCallPreviewItems({ oldStr, newStr, filePath, shouldCap });
  }

  if (name === 'Bash' && result === undefined) {
    const command = str(toolCall.args['command']);
    if (command.length === 0) return [];
    return [
      new ShellExecutionComponent({
        command,
        showCommand: true,
        commandPreviewLines: expanded ? undefined : COMMAND_PREVIEW_LINES,
      }),
    ];
  }

  return [];
}

export function buildPlanCallPreviewComponents(params: {
  readonly toolCall: ToolCallBlockData;
  readonly result: ToolResultBlockData | undefined;
  readonly currentPlan: string | undefined;
  readonly planPath: string | undefined;
  readonly markdownTheme: MarkdownTheme;
}): Component[] {
  const { toolCall, result, currentPlan, planPath, markdownTheme } = params;
  const plan = resolvePlanForPreview(str(toolCall.args['plan']), result, currentPlan);
  if (plan.length === 0) return [];
  const path = resolvePlanPath(result, planPath);
  return [
    new PlanBoxComponent(plan, markdownTheme, currentTheme.color('success'), path, {
      status: resolvePlanBoxStatus(toolCall.name, result),
    }),
  ];
}

/** Streaming preview during `tool.call.delta`; Bash may reuse an existing shell node. */
export function buildStreamingCallPreviewComponents(params: {
  readonly toolCall: ToolCallBlockData;
  readonly streamText: string;
  readonly existingShell: ShellExecutionComponent | undefined;
}): { readonly components: Component[]; readonly shell: ShellExecutionComponent | undefined } {
  const { toolCall, streamText, existingShell } = params;
  const name = toolCall.name;
  const previewText = streamText.slice(0, STREAMING_ARGS_PREVIEW_MAX_CHARS);

  if (name === 'Write') {
    const items = buildStreamingWriteItems(previewText);
    return { components: items ?? [], shell: existingShell };
  }

  if (name === 'Edit') {
    return {
      components: buildStreamingEditComponents({
        previewText,
        streamingStartedAtMs: toolCall.streamingStartedAtMs,
      }),
      shell: existingShell,
    };
  }

  if (name === 'Bash') {
    const cmd = extractPartialStringField(previewText, 'command');
    if (cmd === undefined || cmd.length === 0) {
      return { components: [], shell: existingShell };
    }
    const shell = existingShell;
    if (shell === undefined) {
      const created = new ShellExecutionComponent({
        command: cmd,
        showCommand: true,
        commandPreviewLines: COMMAND_PREVIEW_LINES,
      });
      return { components: [created], shell: created };
    }
    shell.setCommand(cmd, COMMAND_PREVIEW_LINES);
    return { components: [shell], shell };
  }

  return { components: [], shell: existingShell };
}
