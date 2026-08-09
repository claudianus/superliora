/**
 * Loop24a/b — surface engine doom-loop signals in the TUI.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export const DOOM_LOOP_HARD_STOP_CODE = 'DOOM_LOOP_HARD_STOP';
export const DOOM_LOOP_WARN_PREFIX = 'DOOM_LOOP_WARN:';

export type DoomLoopNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'doom-loop-hard-stop' | 'doom-loop-soft-warn';
};

function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (output !== null && typeof output === 'object') {
    try {
      return JSON.stringify(output);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** True when a tool result payload is the engine doom-loop hard stop. */
export function isDoomLoopHardStopOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return text.includes(DOOM_LOOP_HARD_STOP_CODE) || text.includes('doom_loop_hard_stop');
}

/** True when a tool result carries the soft warn tip (not yet hard-stopped). */
export function isDoomLoopSoftWarnOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  if (isDoomLoopHardStopOutput(text)) return false;
  return text.includes(DOOM_LOOP_WARN_PREFIX);
}

export function formatDoomLoopHardStopNotice(toolName?: string): DoomLoopNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  return {
    title: ttui('tui.notice.doomLoopHard.title'),
    detail: ttui('tui.notice.doomLoopHard.detail', { tool, code: DOOM_LOOP_HARD_STOP_CODE }),
    status: ttui('tui.notice.doomLoopHard.status', { tool }),
    coalesceKey: 'doom-loop-hard-stop',
  };
}

export function formatDoomLoopSoftWarnNotice(toolName?: string): DoomLoopNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  return {
    title: ttui('tui.notice.doomLoopSoft.title'),
    detail: ttui('tui.notice.doomLoopSoft.detail', { tool, prefix: DOOM_LOOP_WARN_PREFIX }),
    status: ttui('tui.notice.doomLoopSoft.status', { tool }),
    coalesceKey: 'doom-loop-soft-warn',
  };
}
