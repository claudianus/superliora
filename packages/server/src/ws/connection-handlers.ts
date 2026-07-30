import { ErrorCode } from '@superliora/protocol';
import type {
  AbortMessage,
  TerminalAttachMessage,
  TerminalCloseMessage,
  TerminalDetachMessage,
  TerminalInputMessage,
  TerminalResizeMessage,
  WatchFsAddMessage,
  WatchFsRemoveMessage,
} from '@superliora/protocol';

import { buildAck } from './protocol';
import { hasErrorName } from './frame-guards';
import type { WsConnectionHost } from './connection-types';

export function handleWatchFsAdd(host: WsConnectionHost, msg: WatchFsAddMessage): void {
  if (host.fsWatchHandler === undefined) {
    host.send(
      buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'fs watch handler not wired', {}),
    );
    return;
  }
  const { session_id, paths } = msg.payload;
  const handler = host.fsWatchHandler;
  void handler
    .add(session_id, host.id, paths)
    .then((result) => {
      if (!result.ok) {
        host.send(buildAck(msg.id, result.code, result.msg, {}));
        return;
      }
      host.send(
        buildAck(msg.id, 0, 'success', {
          watched_paths: result.watched_paths,
          current_count: result.current_count,
        }),
      );
    })
    .catch((err: unknown) => {
      host.logger.warn({ err: String(err) }, 'watch_fs_add handler threw');
      host.send(
        buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'watch_fs_add failed', {}),
      );
    });
}

export function handleWatchFsRemove(host: WsConnectionHost, msg: WatchFsRemoveMessage): void {
  if (host.fsWatchHandler === undefined) {
    host.send(
      buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'fs watch handler not wired', {}),
    );
    return;
  }
  const { session_id, paths } = msg.payload;
  const handler = host.fsWatchHandler;
  void handler
    .remove(session_id, host.id, paths)
    .then((result) => {
      if (!result.ok) {
        host.send(buildAck(msg.id, result.code, result.msg, {}));
        return;
      }
      host.send(
        buildAck(msg.id, 0, 'success', {
          watched_paths: result.watched_paths,
          current_count: result.current_count,
        }),
      );
    })
    .catch((err: unknown) => {
      host.logger.warn({ err: String(err) }, 'watch_fs_remove handler threw');
      host.send(
        buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'watch_fs_remove failed', {}),
      );
    });
}

export function handleAbort(host: WsConnectionHost, msg: AbortMessage): void {
  const { session_id, prompt_id } = msg.payload;
  if (host.abortHandler === undefined) {
    host.send(
      buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'abort handler not wired', {}),
    );
    return;
  }
  void host.abortHandler
    .abort(session_id, prompt_id)
    .then((result) => {
      host.send(
        buildAck(msg.id, 0, 'success', {
          aborted: result.aborted,
          ...(result.at_seq !== undefined ? { at_seq: result.at_seq } : {}),
        }),
      );
    })
    .catch((err: unknown) => {
      if (hasErrorName(err, 'PromptAlreadyCompletedError')) {
        const at_seq = host.abortHandler!.currentSeq(session_id);
        host.send(
          buildAck(msg.id, 0, 'success', { aborted: false, at_seq }),
        );
        return;
      }
      if (hasErrorName(err, 'PromptNotFoundError')) {
        host.send(
          buildAck(msg.id, ErrorCode.PROMPT_NOT_FOUND, 'prompt not found', {}),
        );
        return;
      }
      if (hasErrorName(err, 'SessionNotFoundError')) {
        host.send(
          buildAck(msg.id, ErrorCode.SESSION_NOT_FOUND, 'session not found', {}),
        );
        return;
      }
      host.logger.warn({ err: String(err) }, 'ws abort handler error');
      host.send(
        buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'abort failed', {}),
      );
    });
}

function sendTerminalErrorAck(
  host: WsConnectionHost,
  id: string,
  err: unknown,
  fallback: string,
): void {
  if (hasErrorName(err, 'TerminalNotFoundError')) {
    host.send(buildAck(id, ErrorCode.TERMINAL_NOT_FOUND, 'terminal not found', {}));
    return;
  }
  if (hasErrorName(err, 'SessionNotFoundError')) {
    host.send(buildAck(id, ErrorCode.SESSION_NOT_FOUND, 'session not found', {}));
    return;
  }
  host.logger.warn({ err: String(err) }, fallback);
  host.send(buildAck(id, ErrorCode.INTERNAL_ERROR, fallback, {}));
}

export function handleTerminalAttach(
  host: WsConnectionHost & { send: (message: unknown) => void },
  msg: TerminalAttachMessage,
): void {
  if (host.terminalHandler === undefined) {
    host.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
    return;
  }
  const { session_id, terminal_id, since_seq } = msg.payload;
  host.terminalHandler
    .attach(session_id, terminal_id, host, { sinceSeq: since_seq })
    .then((result) => {
      host.send(buildAck(msg.id, 0, 'success', {
        attached: true,
        replayed: result.replayed,
      }));
    })
    .catch((err: unknown) => {
      sendTerminalErrorAck(host, msg.id, err, 'terminal_attach failed');
    });
}

export function handleTerminalDetach(host: WsConnectionHost, msg: TerminalDetachMessage): void {
  if (host.terminalHandler === undefined) {
    host.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
    return;
  }
  const { session_id, terminal_id } = msg.payload;
  try {
    host.terminalHandler.detach(session_id, terminal_id, host.id);
    host.send(buildAck(msg.id, 0, 'success', { detached: true }));
  } catch (err) {
    sendTerminalErrorAck(host, msg.id, err, 'terminal_detach failed');
  }
}

export function handleTerminalInput(host: WsConnectionHost, msg: TerminalInputMessage): void {
  if (host.terminalHandler === undefined) {
    host.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
    return;
  }
  const { session_id, terminal_id, data } = msg.payload;
  host.terminalHandler
    .write(session_id, terminal_id, data)
    .then(() => {
      host.send(buildAck(msg.id, 0, 'success', { accepted: true }));
    })
    .catch((err: unknown) => {
      sendTerminalErrorAck(host, msg.id, err, 'terminal_input failed');
    });
}

export function handleTerminalResize(host: WsConnectionHost, msg: TerminalResizeMessage): void {
  if (host.terminalHandler === undefined) {
    host.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
    return;
  }
  const { session_id, terminal_id, cols, rows } = msg.payload;
  host.terminalHandler
    .resize(session_id, terminal_id, cols, rows)
    .then(() => {
      host.send(buildAck(msg.id, 0, 'success', { resized: true }));
    })
    .catch((err: unknown) => {
      sendTerminalErrorAck(host, msg.id, err, 'terminal_resize failed');
    });
}

export function handleTerminalClose(host: WsConnectionHost, msg: TerminalCloseMessage): void {
  if (host.terminalHandler === undefined) {
    host.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
    return;
  }
  const { session_id, terminal_id } = msg.payload;
  host.terminalHandler
    .close(session_id, terminal_id)
    .then((result) => {
      host.send(buildAck(msg.id, 0, 'success', result));
    })
    .catch((err: unknown) => {
      sendTerminalErrorAck(host, msg.id, err, 'terminal_close failed');
    });
}
