/**
 * Loop45a — surface path-security denials (Read/Write/Edit/Grep/Glob) in the TUI.
 *
 * Engine `PathSecurityError` tool results now carry `code=PATH_*`. Without a
 * notice the operator only sees a red tool card and may miss sandbox / sensitive
 * / read-only recovery paths.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export type PathSecurityCode =
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'PATH_SENSITIVE'
  | 'PATH_INVALID'
  | 'PATH_READ_ONLY'
  | 'PATH_SYMLINK_OUTSIDE';

export type PathSecurityNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'path-security';
  readonly code: PathSecurityCode | 'PATH_SECURITY';
};

const PATH_CODES: readonly PathSecurityCode[] = [
  'PATH_OUTSIDE_WORKSPACE',
  'PATH_SENSITIVE',
  'PATH_INVALID',
  'PATH_READ_ONLY',
  'PATH_SYMLINK_OUTSIDE',
];

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

export function extractPathSecurityCode(output: unknown): PathSecurityCode | undefined {
  const text = outputText(output);
  if (text === undefined) return undefined;
  for (const code of PATH_CODES) {
    if (text.includes(`code=${code}`) || text.includes(code)) return code;
  }
  return undefined;
}

export function isPathSecurityOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  if (extractPathSecurityCode(text) !== undefined) return true;
  // Legacy prose fallbacks (pre-Loop45a marker).
  return (
    text.includes('matches a sensitive-file pattern') ||
    text.includes('is outside the workspace') ||
    text.includes('Sandbox is read-only') ||
    text.includes('Path cannot be empty') ||
    text.includes('outside the working directory') ||
    text.includes('resolves outside the workspace via a symlink')
  );
}

export function formatPathSecurityNotice(
  toolName?: string,
  output?: unknown,
): PathSecurityNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  const code = extractPathSecurityCode(output) ?? 'PATH_SECURITY';
  switch (code) {
    case 'PATH_SENSITIVE':
      return {
        title: ttui('tui.notice.sensitivePath.title'),
        detail: ttui('tui.notice.sensitivePath.detail', { tool }),
        status: ttui('tui.notice.sensitivePath.status', { tool }),
        coalesceKey: 'path-security',
        code,
      };
    case 'PATH_OUTSIDE_WORKSPACE':
      return {
        title: ttui('tui.notice.outsideWorkspace.title'),
        detail: ttui('tui.notice.outsideWorkspace.detail', { tool }),
        status: ttui('tui.notice.outsideWorkspace.status', { tool }),
        coalesceKey: 'path-security',
        code,
      };
    case 'PATH_READ_ONLY':
      return {
        title: ttui('tui.notice.sandboxReadonly.title'),
        detail: ttui('tui.notice.sandboxReadonly.detail', { tool }),
        status: ttui('tui.notice.sandboxReadonly.status', { tool }),
        coalesceKey: 'path-security',
        code,
      };
    case 'PATH_INVALID':
      return {
        title: ttui('tui.notice.invalidPath.title'),
        detail: ttui('tui.notice.invalidPath.detail', { tool }),
        status: ttui('tui.notice.invalidPath.status', { tool }),
        coalesceKey: 'path-security',
        code,
      };
    case 'PATH_SYMLINK_OUTSIDE':
      return {
        title: ttui('tui.notice.symlinkOutside.title'),
        detail: ttui('tui.notice.symlinkOutside.detail', { tool }),
        status: ttui('tui.notice.symlinkOutside.status', { tool }),
        coalesceKey: 'path-security',
        code,
      };
    default:
      return {
        title: ttui('tui.notice.pathSecurity.title'),
        detail: ttui('tui.notice.pathSecurity.detail', { tool }),
        status: ttui('tui.notice.pathSecurity.status', { tool }),
        coalesceKey: 'path-security',
        code: 'PATH_SECURITY',
      };
  }
}
