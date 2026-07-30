import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import { makeWorkspaceRelativePath } from './tool-call-format';
import { countNonEmptyLines } from './tool-renderers/chip';

/**
 * Immutable Read tool state snapshot. `ReadGroupComponent` reads one-time
 * views via `ToolCallComponent.getReadSnapshot()` and sums lines for the group
 * header. `lines` is 0 while pending or failed, and the non-empty result line
 * count when done, matching the single-card chip.
 */
export interface ToolCallReadSnapshot {
  readonly toolCallId: string;
  readonly filePath: string | undefined;
  readonly phase: 'pending' | 'done' | 'failed';
  readonly lines: number;
}

export function buildToolCallReadSnapshot(params: {
  readonly toolCallId: string;
  readonly args: ToolCallBlockData['args'];
  readonly result: ToolResultBlockData | undefined;
  readonly workspaceDir: string | undefined;
}): ToolCallReadSnapshot {
  const filePathRaw = params.args['file_path'] ?? params.args['path'];
  const filePath =
    typeof filePathRaw === 'string'
      ? makeWorkspaceRelativePath(filePathRaw, params.workspaceDir)
      : undefined;
  if (params.result === undefined) {
    return { toolCallId: params.toolCallId, filePath, phase: 'pending', lines: 0 };
  }
  if (params.result.is_error === true) {
    return { toolCallId: params.toolCallId, filePath, phase: 'failed', lines: 0 };
  }
  return {
    toolCallId: params.toolCallId,
    filePath,
    phase: 'done',
    lines: countNonEmptyLines(params.result.output),
  };
}
