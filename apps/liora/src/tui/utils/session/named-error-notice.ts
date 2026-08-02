/**
 * Loop28a — named recovery copy for terminal context/compaction error codes.
 *
 * Engine emits ErrorEvent with codes like `context.overflow` / `compaction.unable`.
 * Generic showError dumps the raw message; operators need a recovery path.
 */

export type NamedErrorNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: string;
};

export function formatNamedSessionErrorNotice(
  code: string | undefined,
  message: string | undefined,
): NamedErrorNotice | undefined {
  if (code === 'context.overflow') {
    return {
      title: 'Context overflow',
      detail:
        message !== undefined && message.length > 0
          ? message
          : 'Context window exhausted and auto-compaction could not free enough space. Start a new session, drop large attachments, or raise the model window.',
      status: 'Turn failed: context.overflow',
      coalesceKey: 'context-overflow-terminal',
    };
  }
  if (code === 'compaction.unable') {
    return {
      title: 'Compaction unable',
      detail:
        message !== undefined && message.length > 0
          ? message
          : 'No compactable prefix — context is already at the retention floor. Summarize externally or start a fresh session.',
      status: 'Compaction unable',
      coalesceKey: 'compaction-unable',
    };
  }
  return undefined;
}
