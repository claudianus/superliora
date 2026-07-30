import type { RawData } from 'ws';

import {
  ErrorCode,
  type ClientControlMessage,
  getClientControlOperation,
} from '@superliora/protocol';

import { buildWsError } from './protocol';
import { frameType } from './frame-guards';
import { rawDataToString } from './rawData';
import type { WsConnectionHost } from './connection-types';
import {
  handleAbort,
  handleTerminalAttach,
  handleTerminalClose,
  handleTerminalDetach,
  handleTerminalInput,
  handleTerminalResize,
  handleWatchFsAdd,
  handleWatchFsRemove,
} from './connection-handlers';
import {
  handleClientHello,
  handleSubscribe,
  handleUnsubscribe,
} from './connection-session-sync';

export function dispatchControlMessage(
  host: WsConnectionHost,
  data: RawData,
  isClosed: () => boolean,
  onPong: () => void,
): void {
  if (isClosed()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawDataToString(data));
  } catch {
    host.logger.warn('non-json ws frame; ignoring');
    host.send(buildWsError(ErrorCode.VALIDATION_FAILED, 'non-json ws frame'));
    return;
  }
  const type = frameType(parsed);
  if (type === undefined) {
    host.logger.warn('invalid control message type');
    host.send(buildWsError(ErrorCode.VALIDATION_FAILED, 'invalid control message type'));
    return;
  }
  const operation = getClientControlOperation(type);
  if (operation === undefined) {
    host.logger.warn({ type }, 'unknown control message type');
    host.send(buildWsError(ErrorCode.VALIDATION_FAILED, `unknown control message type: ${type}`));
    return;
  }
  const result = operation.messageSchema.safeParse(parsed);
  if (!result.success) {
    host.logger.warn({ issues: result.error.issues.length }, 'invalid control message');
    host.send(
      buildWsError(ErrorCode.VALIDATION_FAILED, 'invalid control message', {
        details: result.error.issues,
      }),
    );
    return;
  }
  const msg = result.data as ClientControlMessage;
  switch (msg.type) {
    case 'client_hello':
      void handleClientHello(host, msg).catch((err: unknown) => {
        host.logger.warn({ err: String(err) }, 'client_hello handler failed');
      });
      break;
    case 'pong':
      onPong();
      break;
    case 'subscribe':
      void handleSubscribe(host, msg).catch((err: unknown) => {
        host.logger.warn({ err: String(err) }, 'subscribe handler failed');
      });
      break;
    case 'unsubscribe':
      handleUnsubscribe(host, msg);
      break;
    case 'abort':
      handleAbort(host, msg);
      break;
    case 'watch_fs_add':
      handleWatchFsAdd(host, msg);
      break;
    case 'watch_fs_remove':
      handleWatchFsRemove(host, msg);
      break;
    case 'terminal_attach':
      handleTerminalAttach(host, msg);
      break;
    case 'terminal_detach':
      handleTerminalDetach(host, msg);
      break;
    case 'terminal_input':
      handleTerminalInput(host, msg);
      break;
    case 'terminal_resize':
      handleTerminalResize(host, msg);
      break;
    case 'terminal_close':
      handleTerminalClose(host, msg);
      break;
    default: {
      const exhaustive: never = msg;
      void exhaustive;
      host.logger.warn('unhandled control message type');
    }
  }
}
