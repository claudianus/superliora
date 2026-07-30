import type {
  ClientHelloMessage,
  CursorsBySession,
  SubscribeMessage,
  UnsubscribeMessage,
} from '@superliora/protocol';

import { buildAck, buildResyncRequired } from './protocol';
import type { WsConnectionHost } from './connection-types';

/**
 * Shared client_hello/subscribe session sync:
 *   1. register the subscription FIRST (live events flow immediately;
 *      the client dedups overlap by seq),
 *   2. replay durable events past the client's cursor, or emit
 *      `resync_required` when the cursor cannot be served,
 *   3. report the server-side `{seq, epoch}` cursor for every accepted
 *      session so the client can adopt the current epoch.
 */
export async function syncSessions(
  host: WsConnectionHost,
  sessionIds: readonly string[],
  cursors: CursorsBySession | undefined,
): Promise<{
  accepted: string[];
  resyncRequired: string[];
  serverCursors: CursorsBySession;
}> {
  const accepted: string[] = [];
  const resyncRequired: string[] = [];
  const serverCursors: CursorsBySession = {};

  for (const sid of sessionIds) {
    if (!host.subscriptions.has(sid)) {
      host.subscribe(sid);
    }
    if (!accepted.includes(sid)) accepted.push(sid);
  }

  if (cursors) {
    for (const [sid, cursor] of Object.entries(cursors)) {
      host.cursorsBySession.set(sid, cursor);
      if (!host.subscriptions.has(sid)) {
        host.subscribe(sid);
      }
      if (!accepted.includes(sid)) accepted.push(sid);

      const result = await host.wsBroadcast.getBufferedSince(sid, cursor);
      if (result.resyncRequired !== false) {
        host.send(
          buildResyncRequired(sid, result.resyncRequired, result.currentSeq, result.epoch),
        );
        resyncRequired.push(sid);
      } else {
        for (const entry of result.events) {
          host.send(entry.envelope);
        }
      }
    }
  }

  for (const sid of accepted) {
    try {
      serverCursors[sid] = await host.wsBroadcast.getCursor(sid);
    } catch (err) {
      host.logger.warn({ sid, err: String(err) }, 'getCursor failed for ack');
    }
  }

  return { accepted, resyncRequired, serverCursors };
}

export async function handleClientHello(
  host: WsConnectionHost,
  msg: ClientHelloMessage,
): Promise<void> {
  host.markClientHelloReceived();
  const { subscriptions, cursors } = msg.payload;

  const sync = await syncSessions(host, subscriptions, cursors);

  host.logger.info(
    {
      acceptedCount: sync.accepted.length,
      resyncRequiredCount: sync.resyncRequired.length,
    },
    'client hello',
  );
  host.send(
    buildAck(msg.id, 0, 'success', {
      accepted_subscriptions: sync.accepted,
      resync_required: sync.resyncRequired,
      cursors: sync.serverCursors,
    }),
  );
}

export async function handleSubscribe(
  host: WsConnectionHost,
  msg: SubscribeMessage,
): Promise<void> {
  const { session_ids, cursors, watch_fs } = msg.payload;
  host.logger.info(
    { sessionIds: session_ids, cursors, hasWatchFs: !!watch_fs },
    'ws subscribe',
  );

  const sync = await syncSessions(host, session_ids, cursors);

  if (watch_fs && host.fsWatchHandler !== undefined) {
    for (const [sid, cfg] of Object.entries(watch_fs)) {
      if (cfg.paths.length === 0) continue;
      const handler = host.fsWatchHandler;
      void handler
        .add(sid, host.id, cfg.paths)
        .then((result) => {
          if (!result.ok) {
            host.logger.warn(
              { sid, code: result.code, msg: result.msg },
              'subscribe.watch_fs add failed; client should retry via watch_fs_add',
            );
          }
        })
        .catch((err: unknown) => {
          host.logger.warn(
            { sid, err: String(err) },
            'subscribe.watch_fs add threw',
          );
        });
    }
  }

  host.send(
    buildAck(msg.id, 0, 'success', {
      accepted: sync.accepted,
      not_found: [],
      resync_required: sync.resyncRequired,
      cursors: sync.serverCursors,
    }),
  );
}

export function handleUnsubscribe(host: WsConnectionHost, msg: UnsubscribeMessage): void {
  const { session_ids } = msg.payload;
  for (const sid of session_ids) {
    host.unsubscribe(sid);
    host.cursorsBySession.delete(sid);

    if (host.fsWatchHandler !== undefined) {
      const handler = host.fsWatchHandler;
      void handler.remove(sid, host.id, []).catch((err: unknown) => {
        host.logger.warn(
          { sid, err: String(err) },
          'unsubscribe watch_fs drop threw',
        );
      });
    }
  }
  host.send(
    buildAck(msg.id, 0, 'success', {
      accepted: session_ids,
      not_found: [],
      resync_required: [],
    }),
  );
}
