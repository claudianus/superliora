import type { WireMigration, WireMigrationRecord } from './index';

const nativeTypes = new Set([
  'metadata', 'forked', 'turn.prompt', 'turn.steer', 'turn.cancel', 'config.update',
  'permission.set_mode', 'permission.record_approval_result', 'usage.record',
  'full_compaction.begin', 'full_compaction.cancel', 'full_compaction.complete',
  'context.append_message', 'context.append_loop_event', 'context.clear',
  'context.apply_compaction', 'context.undo', 'job.ledger', 'job.inbox', 'job.pool', 'subagent.lifecycle',
]);
const omittedOrigins = new Set(['injection', 'hook_result', 'cron_job', 'cron_missed']);
const omittedJobFields = new Set(['gateChecklist', 'verifyVerdict', 'debugFixer', 'deliveryPhase', 'track', 'premium']);

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function migrateLedger(value: unknown): unknown {
  const ledger = object(value);
  if (ledger === undefined || !Array.isArray(ledger['jobs'])) return value;
  return { ...ledger, jobs: ledger['jobs'].map((entry: unknown) => {
    const job = object(entry);
    if (job === undefined) return entry;
    return Object.fromEntries(Object.entries(job).filter(([key]) => !omittedJobFields.has(key)));
  }) };
}

function migrateNativeRecord(record: WireMigrationRecord): WireMigrationRecord | null {
  if (record.type === 'tools.update_store' && record['key'] === 'job_ledger') {
    return { type: 'job.ledger', time: record['time'], ledger: migrateLedger(record['value']) };
  }
  if (record.type === 'tools.update_store' && record['key'] === 'job_inbox') {
    return { type: 'job.inbox', time: record['time'], inbox: record['value'] };
  }
  if (record.type === 'tools.update_store' && record['key'] === 'job_project_mode') {
    return { type: 'job.pool', time: record['time'], pool: record['value'] };
  }
  if (!nativeTypes.has(record.type)) return null;
  if (record.type === 'permission.set_mode' && record['mode'] === 'plan') return { ...record, mode: 'manual' };
  if (record.type === 'job.ledger') return { ...record, ledger: migrateLedger(record['ledger']) };
  const message = record.type === 'context.append_message' ? object(record['message']) : undefined;
  const origin = object(message?.['origin'] ?? record['origin']);
  if (origin !== undefined) {
    if (omittedOrigins.has(String(origin['kind']))) return null;
    if (origin['kind'] === 'skill_activation' || origin['kind'] === 'plugin_command') {
      if (origin['trigger'] !== 'user-slash') return null;
      return message === undefined
        ? { ...record, origin: { kind: 'user' } }
        : { ...record, message: { ...message, origin: { kind: 'user' } } };
    }
  }
  if (record.type === 'config.update' && typeof record['profileName'] === 'string') {
    const { profileName: _profile, systemPrompt: _prompt, layeredSystemPrompt: _layered, ...native } = record;
    return native;
  }
  return record;
}

export const nativeWireMigrations: readonly WireMigration[] = ['1.3', '1.4'].map((sourceVersion) => ({
  sourceVersion,
  targetVersion: '1.5',
  migrateRecord: migrateNativeRecord,
}));
