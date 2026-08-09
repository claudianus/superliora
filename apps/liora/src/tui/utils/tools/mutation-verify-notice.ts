/**
 * Loop27b — surface PostToolUse mutation-verify nudges in the TUI.
 *
 * agent-core appends "PostToolUse sensor: source mutated..." after successful
 * Edit/Write/ApplyPatch so the model runs checks. Without a notice the operator
 * only sees a green tool card and may miss that verification is still pending.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export const MUTATION_VERIFY_MARKER = 'PostToolUse sensor: source mutated';

export type MutationVerifyNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'mutation-verify-nudge';
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

export function isMutationVerifyNudgeOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return text.includes(MUTATION_VERIFY_MARKER);
}

/** Best-effort packageDir extract from the sensor tip text. */
export function extractMutationPackageDir(output: unknown): string | undefined {
  const text = outputText(output);
  if (text === undefined) return undefined;
  const under = text.match(/source mutated under `([^`]+)`/);
  if (under?.[1] !== undefined && under[1].length > 0) return under[1];
  const packageDir = text.match(/packageDir=([^\s)]+)/);
  if (packageDir?.[1] !== undefined && packageDir[1].length > 0) return packageDir[1];
  return undefined;
}

export function formatMutationVerifyNotice(toolName?: string, packageDir?: string): MutationVerifyNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  const scope =
    packageDir !== undefined && packageDir.length > 0
      ? ` under ${packageDir}`
      : '';
  return {
    title: ttui('tui.notice.mutationVerify.title'),
    detail: ttui('tui.notice.mutationVerify.detail', { tool, scope }),
    status:
      packageDir !== undefined && packageDir.length > 0
        ? ttui('tui.notice.mutationVerify.statusWithDir', { packageDir })
        : ttui('tui.notice.mutationVerify.statusAfterTool', { tool }),
    coalesceKey: 'mutation-verify-nudge',
  };
}
