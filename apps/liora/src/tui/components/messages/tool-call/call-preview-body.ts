/** Bash command previews, including partial streamed JSON arguments. */

import { Text, type Component } from '#/tui/renderer';
import { COMMAND_PREVIEW_LINES } from '#/tui/constant/rendering';
import { STREAMING_ARGS_PREVIEW_MAX_CHARS } from '#/tui/constant/streaming';
import { currentTheme } from '#/tui/theme';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import { ShellExecutionComponent } from '../shell/shell-execution';
import { extractPartialStringField, str } from './format';

export function buildSettledCallPreviewComponents(params: {
  readonly toolCall: ToolCallBlockData;
  readonly result: ToolResultBlockData | undefined;
  readonly expanded: boolean;
}): Component[] {
  const { toolCall, result, expanded } = params;
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


  if (toolCall.name === 'Bash' && result === undefined) {
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


/** Streaming preview during `tool.call.delta`; Bash may reuse an existing shell node. */
export function buildStreamingCallPreviewComponents(params: {
  readonly toolCall: ToolCallBlockData;
  readonly streamText: string;
  readonly existingShell: ShellExecutionComponent | undefined;
}): { readonly components: Component[]; readonly shell: ShellExecutionComponent | undefined } {
  const { toolCall, streamText, existingShell } = params;
  const name = toolCall.name;
  const previewText = streamText.slice(0, STREAMING_ARGS_PREVIEW_MAX_CHARS);


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
