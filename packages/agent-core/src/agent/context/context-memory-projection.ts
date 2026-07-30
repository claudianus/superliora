import type { ProjectionAnomaly, ProjectOptions } from './projector';
import type { ContextMemoryHost } from './context-memory-host';

export const COMPACTION_PROJECTION_OPTIONS: ProjectOptions = {
  synthesizeMissing: true,
  dropOrphanResults: true,
  dedupeDuplicateToolCalls: true,
  dropLeadingNonUser: true,
  mergeConsecutiveAssistants: true,
};

export function reportContextProjectionRepairs(
  host: ContextMemoryHost,
  anomalies: readonly ProjectionAnomaly[],
): void {
  const notable = anomalies.filter(
    (anomaly) => !(anomaly.kind === 'tool_result_synthesized' && anomaly.trailing),
  );
  if (notable.length === 0) {
    host.lastProjectionRepairSignature = null;
    return;
  }

  const signature = notable
    .map((anomaly) => ('toolCallId' in anomaly ? `${anomaly.kind}:${anomaly.toolCallId}` : anomaly.kind))
    .toSorted()
    .join('|');
  if (signature === host.lastProjectionRepairSignature) return;
  host.lastProjectionRepairSignature = signature;

  let reordered = 0;
  let synthesized = 0;
  let droppedOrphan = 0;
  let duplicateCallsDropped = 0;
  let duplicateResultsDropped = 0;
  let leadingDropped = 0;
  let assistantsMerged = 0;
  let whitespaceDropped = 0;
  for (const anomaly of notable) {
    if (anomaly.kind === 'tool_result_reordered') reordered += 1;
    else if (anomaly.kind === 'tool_result_synthesized') synthesized += 1;
    else if (anomaly.kind === 'orphan_tool_result_dropped') droppedOrphan += 1;
    else if (anomaly.kind === 'duplicate_tool_call_dropped') duplicateCallsDropped += 1;
    else if (anomaly.kind === 'duplicate_tool_result_dropped') duplicateResultsDropped += 1;
    else if (anomaly.kind === 'leading_non_user_dropped') leadingDropped += 1;
    else if (anomaly.kind === 'consecutive_assistants_merged') assistantsMerged += 1;
    else whitespaceDropped += 1;
  }
  const toolCallIds = [
    ...new Set(
      notable.flatMap((anomaly) => ('toolCallId' in anomaly ? [anomaly.toolCallId] : [])),
    ),
  ].slice(0, 5);

  host.agent.log.warn('repaired request projection for strict provider wire validity', {
    reordered,
    synthesized,
    droppedOrphan,
    duplicateCallsDropped,
    duplicateResultsDropped,
    leadingDropped,
    assistantsMerged,
    whitespaceDropped,
    toolCallIds,
  });
  host.agent.telemetry.track('context_projection_repaired', {
    reordered,
    synthesized,
    dropped_orphan: droppedOrphan,
    duplicate_calls_dropped: duplicateCallsDropped,
    duplicate_results_dropped: duplicateResultsDropped,
    leading_dropped: leadingDropped,
    assistants_merged: assistantsMerged,
    whitespace_dropped: whitespaceDropped,
  });
}
