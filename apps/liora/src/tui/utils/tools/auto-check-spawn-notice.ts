/**
 * Loop33a — surface AUTO_CHECK_SPAWN RunProjectChecks results in the TUI.
 *
 * When SUPERLIORA_AUTO_CHECK_SPAWN=1, agent-core appends a compact
 * `AUTO_CHECK_SPAWN:` block after successful mutations. Without a notice the
 * operator only sees a green tool card and may miss auto-check OK/FAILED.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export const AUTO_CHECK_SPAWN_PREFIX = 'AUTO_CHECK_SPAWN:';

export type AutoCheckSpawnNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'auto-check-spawn';
  readonly failed: boolean;
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

export function isAutoCheckSpawnOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return text.includes(AUTO_CHECK_SPAWN_PREFIX);
}

export function isAutoCheckSpawnFailedOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  // formatAutoCheckSpawnResult: `AUTO_CHECK_SPAWN: RunProjectChecks FAILED (...`
  return (
    text.includes(`${AUTO_CHECK_SPAWN_PREFIX} RunProjectChecks FAILED`) ||
    /AUTO_CHECK_SPAWN:[^\n]*\bFAILED\b/.test(text)
  );
}

/** Best-effort packageDir from the spawn block line. */
export function extractAutoCheckSpawnPackageDir(output: unknown): string | undefined {
  const text = outputText(output);
  if (text === undefined) return undefined;
  const m = text.match(/packageDir=([^\s,)]+)/);
  if (m?.[1] === undefined || m[1].length === 0) return undefined;
  if (m[1] === '(repo') return undefined; // "(repo root)" split
  return m[1];
}

export function formatAutoCheckSpawnNotice(
  toolName?: string,
  output?: unknown,
): AutoCheckSpawnNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  const failed = isAutoCheckSpawnFailedOutput(output);
  const packageDir = extractAutoCheckSpawnPackageDir(output);
  const scope =
    packageDir !== undefined && packageDir.length > 0 ? ` (${packageDir})` : '';
  if (failed) {
    return {
      title: ttui('tui.notice.autoCheckFailed.title'),
      detail: ttui('tui.notice.autoCheckFailed.detail', {
        tool,
        scope,
        code: AUTO_CHECK_SPAWN_PREFIX.trimEnd(),
      }),
      status:
        packageDir !== undefined && packageDir.length > 0
          ? ttui('tui.notice.autoCheckFailed.statusWithDir', { packageDir })
          : ttui('tui.notice.autoCheckFailed.statusAfterTool', { tool }),
      coalesceKey: 'auto-check-spawn',
      failed: true,
    };
  }
  return {
    title: ttui('tui.notice.autoCheckPassed.title'),
    detail: ttui('tui.notice.autoCheckPassed.detail', { tool, scope }),
    status:
      packageDir !== undefined && packageDir.length > 0
        ? ttui('tui.notice.autoCheckPassed.statusWithDir', { packageDir })
        : ttui('tui.notice.autoCheckPassed.statusAfterTool', { tool }),
    coalesceKey: 'auto-check-spawn',
    failed: false,
  };
}
