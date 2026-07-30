import type { Agent } from '../agent';
import type { BackgroundTaskOrigin } from '../agent/context';
import { renderNotificationXml } from '../agent/context/notification-xml';

export const CHANNEL_NOTIFICATION_METHOD = 'notifications/claude/channel';
export const CHANNEL_PERMISSION_REQUEST_METHOD = 'notifications/claude/channel/permission_request';
export const CHANNEL_PERMISSION_METHOD = 'notifications/claude/channel/permission';

export interface ChannelInboundEvent {
  readonly server: string;
  readonly content: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface ChannelPermissionVerdict {
  readonly requestId: string;
  readonly behavior: 'allow' | 'deny';
}

/**
 * Host for Claude channel inbound messages.
 * Call {@link handleNotification} when an MCP server emits channel methods.
 */
export class PluginChannelRuntime {
  private readonly enabledServers: ReadonlySet<string>;
  private readonly permissionWaiters = new Map<
    string,
    (verdict: ChannelPermissionVerdict) => void
  >();

  constructor(
    private readonly agent: Agent,
    enabledServers: readonly string[],
    private readonly optIn: boolean,
  ) {
    this.enabledServers = new Set(enabledServers);
  }

  get active(): boolean {
    return this.optIn && this.enabledServers.size > 0;
  }

  handleNotification(server: string, method: string, params: unknown): void {
    if (!this.optIn) return;
    if (!this.enabledServers.has(server) && !this.matchesPluginServer(server)) return;

    if (method === CHANNEL_NOTIFICATION_METHOD) {
      const content = extractContent(params);
      if (content === undefined) return;
      this.injectInbound({
        server,
        content,
        meta: isRecord(params) && isRecord(params['meta']) ? params['meta'] : undefined,
      });
      return;
    }

    if (method === CHANNEL_PERMISSION_METHOD) {
      if (!isRecord(params)) return;
      const requestId = typeof params['request_id'] === 'string' ? params['request_id'] : '';
      const behavior = params['behavior'] === 'allow' || params['behavior'] === 'deny'
        ? params['behavior']
        : undefined;
      if (requestId.length === 0 || behavior === undefined) return;
      const waiter = this.permissionWaiters.get(requestId);
      if (waiter !== undefined) {
        this.permissionWaiters.delete(requestId);
        waiter({ requestId, behavior });
      }
    }
  }

  /**
   * Wait for a remote channel permission verdict (opt-in permission relay).
   * Resolves undefined on timeout.
   */
  waitForPermissionVerdict(
    requestId: string,
    timeoutMs = 120_000,
  ): Promise<ChannelPermissionVerdict | undefined> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.permissionWaiters.delete(requestId);
        resolve(undefined);
      }, timeoutMs);
      this.permissionWaiters.set(requestId, (verdict) => {
        clearTimeout(timer);
        resolve(verdict);
      });
    });
  }

  private matchesPluginServer(server: string): boolean {
    for (const enabled of this.enabledServers) {
      if (server === enabled) return true;
      if (server.endsWith(`:${enabled}`) || server.endsWith(`::${enabled}`)) return true;
    }
    return false;
  }

  private injectInbound(event: ChannelInboundEvent): void {
    const metaBits =
      event.meta === undefined
        ? ''
        : ` ${Object.entries(event.meta)
            .map(([k, v]) => `${k}=${JSON.stringify(String(v))}`)
            .join(' ')}`;
    const body = `<channel-message server="${escapeXml(event.server)}"${metaBits}>\n${event.content}\n</channel-message>`;
    const notification = {
      id: `channel:${event.server}:${Date.now()}`,
      category: 'channel',
      type: 'channel.message',
      source_kind: 'plugin_channel',
      source_id: event.server,
      title: `Channel ${event.server}`,
      severity: 'info',
      body,
    };
    void this.agent.hooks?.fireAndForgetTrigger('Notification', {
      matcherValue: 'channel_message',
      inputData: {
        notificationType: 'channel_message',
        server: event.server,
        content: event.content,
      },
    });
    const origin: BackgroundTaskOrigin = {
      kind: 'background_task',
      taskId: `channel:${event.server}`,
      status: 'running',
      notificationId: notification.id,
    };
    try {
      this.agent.turn.steer([{ type: 'text', text: renderNotificationXml(notification) }], origin);
    } catch {
      // Session may be idle without an active turn; Notification hook already fired.
      void body;
    }
  }
}

function extractContent(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined;
  if (typeof params['content'] === 'string' && params['content'].length > 0) {
    return params['content'];
  }
  if (typeof params['text'] === 'string' && params['text'].length > 0) {
    return params['text'];
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
