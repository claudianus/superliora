import type { AgentReplayRecord } from '../../rpc/resumed';

/**
 * Recent user-turns kept on the resume RPC payload. Matches the TUI hydrate
 * window so we do not ship a full-session replay array across the SDK boundary.
 */
export const RESUME_REPLAY_TURN_LIMIT = 10;

/**
 * Keep the last {@link maxTurns} user-turn windows from a replay stream.
 * User-turn anchors match TUI hydrate (`origin.kind === 'user'`, user-slash
 * skill/plugin commands, and `!` shell input).
 */
export function limitReplayRecordsByTurn(
  records: readonly AgentReplayRecord[],
  maxTurns: number,
): readonly AgentReplayRecord[] {
  if (maxTurns <= 0) return [];
  const turnStarts: number[] = [];
  for (let index = 0; index < records.length; index++) {
    if (isReplayUserTurnRecord(records[index]!)) {
      turnStarts.push(index);
    }
  }
  // Always return a new array so callers can safely clear/replace the source
  // buffer without emptying the limited view (resume keepOnly path).
  if (turnStarts.length <= maxTurns) return records.slice();
  return records.slice(turnStarts[turnStarts.length - maxTurns]);
}

export function isReplayUserTurnRecord(record: AgentReplayRecord): boolean {
  if (record.type !== 'message') return false;
  const { message } = record;
  if (message.role !== 'user') return false;
  const origin = message.origin;
  if (origin === undefined) return true;
  switch (origin.kind) {
    case 'user':
      return true;
    case 'skill_activation':
      return origin.trigger === 'user-slash';
    case 'plugin_command':
      return origin.trigger === 'user-slash';
    case 'shell_command':
      return origin.phase === 'input';
    case 'background_task':
    case 'compaction_summary':
    case 'cron_job':
    case 'cron_missed':
    case 'hook_result':
    case 'injection':
    case 'retry':
    case 'system_trigger':
      return false;
    default: {
      const _exhaustive: never = origin;
      void _exhaustive;
      return false;
    }
  }
}
