import type { Kaos, KaosProcess } from '@superliora/kaos';

import type { Agent } from '../agent';
import { ProcessBackgroundTask } from '../agent/background';
import type { BackgroundTaskOrigin } from '../agent/context';
import { renderNotificationXml } from '../agent/context/notification-xml';
import type { PluginMonitorDef } from './types';

export interface ArmedPluginMonitor {
  readonly pluginId: string;
  readonly name: string;
  readonly taskId: string;
}

/**
 * Spawn enabled plugin monitors as detached background tasks.
 * Complete stdout lines fire Notification hooks and steer a short XML note.
 */
export async function armPluginMonitors(input: {
  readonly agent: Agent;
  readonly kaos: Kaos;
  readonly monitors: ReadonlyArray<{
    readonly pluginId: string;
    readonly monitor: PluginMonitorDef;
    readonly env: Readonly<Record<string, string>>;
  }>;
}): Promise<readonly ArmedPluginMonitor[]> {
  const armed: ArmedPluginMonitor[] = [];
  for (const entry of input.monitors) {
    try {
      const taskId = await armOne(input.agent, input.kaos, entry);
      armed.push({ pluginId: entry.pluginId, name: entry.monitor.name, taskId });
    } catch (error) {
      input.agent.log.warn('Failed to arm plugin monitor', {
        pluginId: entry.pluginId,
        monitor: entry.monitor.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return armed;
}

async function armOne(
  agent: Agent,
  kaos: Kaos,
  entry: {
    readonly pluginId: string;
    readonly monitor: PluginMonitorDef;
    readonly env: Readonly<Record<string, string>>;
  },
): Promise<string> {
  const { monitor, pluginId, env } = entry;
  const cwd = kaos.getcwd();
  const shellPath = kaos.osEnv.shellPath;
  const shellArgs = [shellPath, '-c', `cd ${shellQuote(cwd)} && ${monitor.command}`];
  const childEnv = {
    ...process.env,
    ...env,
    NO_COLOR: '1',
    TERM: 'dumb',
    SHELL: shellPath,
  } as Record<string, string>;

  const proc = await kaos.execWithEnv(shellArgs, childEnv);
  closeProcessStdin(proc);

  let lineBuffer = '';
  const onOutput = (kind: 'stdout' | 'stderr', text: string): void => {
    if (kind !== 'stdout') return;
    lineBuffer += text;
    const parts = lineBuffer.split('\n');
    lineBuffer = parts.pop() ?? '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      notifyMonitorLine(agent, pluginId, monitor.name, trimmed);
    }
  };

  const description = monitor.description ?? `plugin monitor ${pluginId}:${monitor.name}`;
  return agent.background.registerTask(
    new ProcessBackgroundTask(proc, monitor.command, description, onOutput),
    {
      detached: true,
      // Long-lived monitors; no wall timeout.
      timeoutMs: undefined,
    },
  );
}

function notifyMonitorLine(
  agent: Agent,
  pluginId: string,
  monitorName: string,
  line: string,
): void {
  const body = line.length > 500 ? `${line.slice(0, 500)}…` : line;
  const notification = {
    id: `plugin-monitor:${pluginId}:${monitorName}:${Date.now()}`,
    category: 'monitor',
    type: 'monitor.line',
    source_kind: 'plugin_monitor',
    source_id: `${pluginId}:${monitorName}`,
    title: `Monitor ${pluginId}:${monitorName}`,
    severity: 'info',
    body,
  };
  void agent.hooks?.fireAndForgetTrigger('Notification', {
    matcherValue: monitorName,
    inputData: {
      sink: 'context',
      notificationType: notification.type,
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      sourceKind: notification.source_kind,
      sourceId: notification.source_id,
      pluginId,
      monitorName,
    },
  });
  const origin: BackgroundTaskOrigin = {
    kind: 'background_task',
    taskId: `monitor:${pluginId}:${monitorName}`,
    status: 'running',
    notificationId: notification.id,
  };
  try {
    agent.turn.steer([{ type: 'text', text: renderNotificationXml(notification) }], origin);
  } catch {
    // Steer can throw if turn is not ready; Notification hook already fired.
  }
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

function closeProcessStdin(proc: KaosProcess): void {
  try {
    proc.stdin.end();
  } catch {
    // ignore
  }
}
