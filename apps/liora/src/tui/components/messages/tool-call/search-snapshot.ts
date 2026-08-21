import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';
import { classifyToolVerbKind } from '#/tui/features/transcript/verb-group';

import { countNonEmptyLines } from '../tool-renderers/chip';
import { extractKeyArgument } from './format';

/**
 * Immutable search/dir tool snapshot. `SearchGroupComponent` reads one-time
 * views via `ToolCallComponent.getSearchSnapshot()` and sums hits for the
 * group header. `hits` is 0 while pending or failed, and the non-empty
 * result line count when done, matching the single-card chip.
 */
export type SearchFamilyKind = 'search' | 'dir';
export type SearchHitKind = 'match' | 'file';

export interface ToolCallSearchSnapshot {
  readonly toolCallId: string;
  readonly name: string;
  readonly kind: SearchFamilyKind;
  readonly subject: string | undefined;
  readonly phase: 'pending' | 'done' | 'failed';
  readonly hits: number;
  readonly hitKind: SearchHitKind;
}

const FALLBACK_SUBJECT_KEYS = ['pattern', 'query', 'path', 'target_directory'] as const;

export function resolveSearchHitKind(name: string, kind: SearchFamilyKind): SearchHitKind {
  if (kind === 'dir' || name === 'Glob') return 'file';
  return 'match';
}

export function extractSearchSubject(
  name: string,
  args: ToolCallBlockData['args'],
  workspaceDir: string | undefined,
): string | undefined {
  const fromKey = extractKeyArgument(name, args, workspaceDir);
  if (fromKey !== null && fromKey.length > 0) return fromKey;
  for (const key of FALLBACK_SUBJECT_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function buildToolCallSearchSnapshot(params: {
  readonly toolCallId: string;
  readonly name: string;
  readonly args: ToolCallBlockData['args'];
  readonly result: ToolResultBlockData | undefined;
  readonly workspaceDir: string | undefined;
}): ToolCallSearchSnapshot {
  const classified = classifyToolVerbKind(params.name);
  const kind: SearchFamilyKind = classified === 'dir' ? 'dir' : 'search';
  const subject = extractSearchSubject(params.name, params.args, params.workspaceDir);
  const hitKind = resolveSearchHitKind(params.name, kind);
  if (params.result === undefined) {
    return {
      toolCallId: params.toolCallId,
      name: params.name,
      kind,
      subject,
      phase: 'pending',
      hits: 0,
      hitKind,
    };
  }
  if (params.result.is_error === true) {
    return {
      toolCallId: params.toolCallId,
      name: params.name,
      kind,
      subject,
      phase: 'failed',
      hits: 0,
      hitKind,
    };
  }
  return {
    toolCallId: params.toolCallId,
    name: params.name,
    kind,
    subject,
    phase: 'done',
    hits: countNonEmptyLines(params.result.output),
    hitKind,
  };
}
