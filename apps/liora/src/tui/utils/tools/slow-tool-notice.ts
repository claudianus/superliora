/**
 * Loop27a — surface slow tool executions in the TUI.
 *
 * agent-core appends `SLOW_TOOL_WARN:` when a tool exceeds 10s. Without a notice
 * the operator only sees a long spinner then a normal card.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export const SLOW_TOOL_WARN_PREFIX = 'SLOW_TOOL_WARN:';

export type SlowToolNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'slow-tool-warn';
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

export function isSlowToolWarnOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return text.includes(SLOW_TOOL_WARN_PREFIX);
}

export function formatSlowToolWarnNotice(toolName?: string): SlowToolNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  return {
    title: ttui('tui.notice.slowTool.title'),
    detail: ttui('tui.notice.slowTool.detail', { tool, prefix: SLOW_TOOL_WARN_PREFIX }),
    status: ttui('tui.notice.slowTool.status', { tool }),
    coalesceKey: 'slow-tool-warn',
  };
}
