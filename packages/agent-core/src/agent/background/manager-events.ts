import type { BackgroundManagerHost } from './manager-host';
import { notifyBackgroundTaskOnTerminal } from './manager-notify-delivery';
import type { BackgroundTaskInfo } from './task';
import type { ManagedTask } from './managed-types';

export function emitTaskStarted(host: BackgroundManagerHost, info: BackgroundTaskInfo): void {
  host.agent.emitEvent({ type: 'background.task.started', info });
  host.agent.telemetry.track('background_task_created', {
    kind: info.kind === 'process' ? 'bash' : info.kind,
  });
}

export function emitTaskTerminated(host: BackgroundManagerHost, info: BackgroundTaskInfo): void {
  host.agent.emitEvent({ type: 'background.task.terminated', info });
  host.agent.telemetry.track('background_task_completed', {
    kind: info.kind,
    duration: info.endedAt !== null ? info.endedAt - info.startedAt : null,
    status: info.status,
  });
}

export function fireTerminalEffects(host: BackgroundManagerHost, entry: ManagedTask): void {
  if (!host.isDetached(entry)) return;
  const info = host.toInfo(entry);
  void notifyBackgroundTaskOnTerminal(host, info).catch(() => { });
  emitTaskTerminated(host, info);
}
