/**
 * Loop43a — surface shell dedicated-tool redirects in the TUI.
 *
 * When Bash is blocked because Read/Write/Edit/Grep/Glob should handle the
 * command, agent-core returns an isError result with `SHELL_DEDICATED_BYPASS`.
 * Without a notice the operator only sees a red tool card and may miss the
 * recovery path (use dedicated tool, or LIORA_FORCE_BASH=1).
 */

import { ttui } from '#/tui/utils/tui-i18n';

export const SHELL_DEDICATED_BYPASS_CODE = 'SHELL_DEDICATED_BYPASS';

export type ShellDedicatedBypassNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'shell-dedicated-bypass';
  readonly prefer?: string;
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

export function isShellDedicatedBypassOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return (
    text.includes(SHELL_DEDICATED_BYPASS_CODE) ||
    text.includes('Bash blocked: this looks like a job for the')
  );
}

/** Best-effort preferred tool from the engine message. */
export function extractShellDedicatedPreferTool(output: unknown): string | undefined {
  const text = outputText(output);
  if (text === undefined) return undefined;
  const m = text.match(/job for the (\w+) tool/);
  if (m?.[1] === undefined || m[1].length === 0) return undefined;
  return m[1];
}

export function formatShellDedicatedBypassNotice(
  toolName?: string,
  output?: unknown,
): ShellDedicatedBypassNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'Bash';
  const prefer = extractShellDedicatedPreferTool(output);
  const preferLabel =
    prefer !== undefined && prefer.length > 0
      ? prefer
      : ttui('tui.notice.dedicatedTool.preferFallback');
  return {
    title: ttui('tui.notice.dedicatedTool.title'),
    detail: ttui('tui.notice.dedicatedTool.detail', {
      tool,
      prefer: preferLabel,
      code: SHELL_DEDICATED_BYPASS_CODE,
    }),
    status:
      prefer !== undefined && prefer.length > 0
        ? ttui('tui.notice.dedicatedTool.statusWithPrefer', { tool, prefer })
        : ttui('tui.notice.dedicatedTool.statusGeneric', { tool }),
    coalesceKey: 'shell-dedicated-bypass',
    ...(prefer !== undefined ? { prefer } : {}),
  };
}
