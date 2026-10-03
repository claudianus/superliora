import type { ToolArgsValidator } from '../tools/args-validator';
import { isUserCancellation } from '../utils/abort';
import type { ToolResourceAccess } from './tool-access';
import type { ExecutableTool } from './types';

export const validators = new WeakMap<ExecutableTool, ToolArgsValidator>();

export function writePathsFromAccesses(
  accesses: readonly ToolResourceAccess[] | undefined,
): readonly string[] | undefined {
  if (accesses === undefined) return undefined;
  const paths: string[] = [];
  for (const access of accesses) {
    if (access.kind === 'file' && (access.operation === 'write' || access.operation === 'readwrite')) {
      paths.push(access.path);
    }
  }
  return paths.length > 0 ? paths : undefined;
}

export function abortedToolOutput(toolName: string, signal: AbortSignal): string {
  if (isUserCancellation(signal.reason)) return `Tool "${toolName}" was cancelled by the user.`;
  const reason = signal.reason instanceof Error ? signal.reason.message : signal.reason;
  return typeof reason === 'string' && reason.length > 0
    ? `Tool "${toolName}" was aborted: ${reason}`
    : `Tool "${toolName}" was aborted`;
}
