import type { BackgroundTaskOrigin } from '../context';
import { renderNotificationXml } from '../context/notification-xml';
import {
  buildBackgroundTaskNotificationBody,
  backgroundTaskNotificationChildren,
  NOTIFICATION_FALLBACK_PREVIEW_BYTES,
  notificationKey,
  type BackgroundTaskNotification,
  type BackgroundTaskNotificationContext,
} from './notification';
import type { BackgroundManagerHost } from './manager-host';
import { isBackgroundTaskTerminal } from './terminal-status';
import type { BackgroundTaskInfo } from './task';

export async function restoreBackgroundTaskNotifications(host: BackgroundManagerHost): Promise<void> {
  for (const info of host.list(false)) {
    if (!isBackgroundTaskTerminal(info.status)) continue;
    await restoreBackgroundTaskNotification(host, info);
  }
}

export async function restoreBackgroundTaskNotification(
  host: BackgroundManagerHost,
  info: BackgroundTaskInfo,
): Promise<void> {
  const context = await buildBackgroundTaskNotificationContext(host, info);
  if (context === undefined) return;
  deliverBackgroundTaskNotification(host, context, 'append');
}

export async function notifyBackgroundTaskOnTerminal(
  host: BackgroundManagerHost,
  info: BackgroundTaskInfo,
): Promise<void> {
  const context = await buildBackgroundTaskNotificationContext(host, info);
  if (context === undefined) return;
  deliverBackgroundTaskNotification(host, context, 'steer');
}

export function deliverBackgroundTaskNotification(
  host: BackgroundManagerHost,
  context: BackgroundTaskNotificationContext,
  sink: 'steer' | 'append',
): void {
  if (sink === 'steer') {
    host.agent.turn.steer(context.content, context.origin);
  } else {
    host.agent.context.appendUserMessage(context.content, context.origin);
  }
  fireBackgroundTaskNotificationHook(host, context.notification);
}

export async function buildBackgroundTaskNotificationContext(
  host: BackgroundManagerHost,
  info: BackgroundTaskInfo,
): Promise<BackgroundTaskNotificationContext | undefined> {
  if (info.detached === false) return undefined;
  if (isTerminalNotificationSuppressed(host, info.taskId)) return undefined;
  const origin: BackgroundTaskOrigin = {
    kind: 'background_task',
    taskId: info.taskId,
    status: info.status,
    notificationId: `task:${info.taskId}:${info.status}`,
  };
  const key = notificationKey(origin);
  if (host.scheduledNotificationKeys.has(key)) return;
  if (host.deliveredNotificationKeys.has(key)) return;

  host.scheduledNotificationKeys.add(key);
  let output = await host.getOutputSnapshot(info.taskId, 0);
  if (!output.fullOutputAvailable) {
    output = await host.getOutputSnapshot(info.taskId, NOTIFICATION_FALLBACK_PREVIEW_BYTES);
  }
  if (isTerminalNotificationSuppressed(host, info.taskId)) return undefined;
  const notification: BackgroundTaskNotification = {
    id: origin.notificationId,
    category: 'task',
    type: `task.${info.status}`,
    source_kind: 'background_task',
    source_id: info.taskId,
    agent_id: info.kind === 'agent' ? info.agentId : undefined,
    title: `Background ${info.kind} ${info.status}`,
    severity: info.status === 'completed' ? 'info' : 'warning',
    body: buildBackgroundTaskNotificationBody(info),
    children: backgroundTaskNotificationChildren(output),
  };
  const content = [
    {
      type: 'text',
      text: renderNotificationXml(notification),
    },
  ] as const;
  return { content, origin, notification };
}

function fireBackgroundTaskNotificationHook(
  host: BackgroundManagerHost,
  notification: BackgroundTaskNotification,
): void {
  void host.agent.hooks?.fireAndForgetTrigger('Notification', {
    matcherValue: notification.type,
    inputData: {
      sink: 'context',
      notificationType: notification.type,
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      sourceKind: notification.source_kind,
      sourceId: notification.source_id,
    },
  });
}

export function markDeliveredBackgroundTaskNotification(
  host: BackgroundManagerHost,
  origin: BackgroundTaskOrigin,
): void {
  host.deliveredNotificationKeys.add(notificationKey(origin));
}

function isTerminalNotificationSuppressed(host: BackgroundManagerHost, taskId: string): boolean {
  return (
    host.tasks.get(taskId)?.terminalNotificationSuppressed === true ||
    host.ghosts.get(taskId)?.terminalNotificationSuppressed === true
  );
}
