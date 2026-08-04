/**
 * Client → server Connect frames that keep Cursor's AgentService/Run alive.
 *
 * Cursor blocks the turn on unanswered `requestContextArgs`, `interactionQuery`,
 * and native-exec messages. Leaving them hanging is the main cause of idle
 * stream close → `Premature close` in SuperLiora's Cursor bridge.
 */

import { encodeConnectFrame } from './connect';
import { CURSOR_PROVIDER_ID } from './constants';
import type { CursorAgentTool } from './frames';
import {
  concatBytes,
  encodeProtobufValue,
  fieldLd,
  fieldStr,
  fieldVarint,
  iterFields,
} from './proto';

export { CURSOR_PROVIDER_ID } from './constants';

const NATIVE_EXEC_DISABLED =
  'Use SuperLiora client tools (mcp_superliora_*) for filesystem and shell work.';

/** Advertise MCP tools when Cursor asks for request context. */
export function encodeRequestContextReply(
  execId: number,
  execIdStr: string | undefined,
  tools: readonly CursorAgentTool[],
): Uint8Array {
  const toolDefs = tools.map((tool) =>
    fieldLd(
      7,
      concatBytes(
        fieldStr(1, tool.name),
        fieldStr(2, tool.description),
        fieldLd(3, encodeProtobufValue(tool.inputSchema)),
        fieldStr(4, CURSOR_PROVIDER_ID),
        fieldStr(5, tool.name),
      ),
    ),
  );
  const requestContext = concatBytes(...toolDefs);
  const success = fieldLd(1, fieldLd(1, requestContext));
  const result = fieldLd(1, success); // RequestContextResult.success
  return encodeExecClientMessage(execId, execIdStr, 10, result);
}

/** Minimal interaction_response that unblocks Cursor's server-side agent. */
export function encodeInteractionQueryReply(queryId: number, queryField: number | undefined): Uint8Array {
  const parts: Uint8Array[] = [fieldVarint(1, queryId)];
  // webSearch(2) / exaSearch(5) / exaFetch(6): approve (empty Approved message).
  if (queryField === 2 || queryField === 5 || queryField === 6) {
    const approved = fieldLd(1, new Uint8Array(0)); // *.approved
    parts.push(fieldLd(queryField, approved));
  } else if (queryField === 3) {
    // askQuestion → rejected
    const rejected = fieldLd(3, fieldStr(1, 'SuperLiora Cursor bridge is non-interactive.'));
    parts.push(fieldLd(3, fieldLd(1, rejected)));
  } else if (queryField === 4) {
    // switchMode → rejected
    const rejected = fieldLd(2, fieldStr(1, 'SuperLiora Cursor bridge is non-interactive.'));
    parts.push(fieldLd(4, rejected));
  } else if (queryField === 7) {
    // createPlan → success (empty)
    const success = fieldLd(1, new Uint8Array(0));
    parts.push(fieldLd(7, fieldLd(1, fieldLd(1, success))));
  }
  // Unknown / setupVm: id-only response still unblocks.
  return encodeConnectFrame(fieldLd(6, concatBytes(...parts)));
}

/**
 * Reject a native exec Cursor asked us to run locally. Keeps the stream alive so
 * the model can fall back to advertised SuperLiora MCP tools.
 */
export function encodeNativeExecReject(
  execId: number,
  execIdStr: string | undefined,
  execCase: number,
  argsBuf: Uint8Array,
): Uint8Array | undefined {
  const path = firstStringField(argsBuf, 1) ?? '';
  const command = firstStringField(argsBuf, 1) ?? '';
  const cwd = firstStringField(argsBuf, 2) ?? '';
  const url = firstStringField(argsBuf, 1) ?? '';

  switch (execCase) {
    case 2: // shellArgs → shellResult.rejected(4)
    case 14: // shellStreamArgs
      return encodeExecClientMessage(
        execId,
        execIdStr,
        2,
        fieldLd(
          4,
          concatBytes(
            fieldStr(1, command),
            fieldStr(2, cwd),
            fieldStr(3, NATIVE_EXEC_DISABLED),
            fieldVarint(4, 0),
          ),
        ),
      );
    case 3: // writeArgs → writeResult.rejected(6)
      return encodeExecClientMessage(
        execId,
        execIdStr,
        3,
        fieldLd(6, concatBytes(fieldStr(1, path), fieldStr(2, NATIVE_EXEC_DISABLED))),
      );
    case 4: // deleteArgs → deleteResult.rejected(6)
      return encodeExecClientMessage(
        execId,
        execIdStr,
        4,
        fieldLd(6, concatBytes(fieldStr(1, path), fieldStr(2, NATIVE_EXEC_DISABLED))),
      );
    case 5: // grepArgs → grepResult.error(2)
      return encodeExecClientMessage(execId, execIdStr, 5, fieldLd(2, fieldStr(1, NATIVE_EXEC_DISABLED)));
    case 7: // readArgs → readResult.error(2)
      return encodeExecClientMessage(
        execId,
        execIdStr,
        7,
        fieldLd(2, concatBytes(fieldStr(1, path), fieldStr(2, NATIVE_EXEC_DISABLED))),
      );
    case 8: // lsArgs → lsResult.error(2)
      return encodeExecClientMessage(
        execId,
        execIdStr,
        8,
        fieldLd(2, concatBytes(fieldStr(1, path), fieldStr(2, NATIVE_EXEC_DISABLED))),
      );
    case 9: // diagnosticsArgs → diagnosticsResult.error(2)
      return encodeExecClientMessage(
        execId,
        execIdStr,
        9,
        fieldLd(2, concatBytes(fieldStr(1, path), fieldStr(2, NATIVE_EXEC_DISABLED))),
      );
    case 11: // mcpArgs (non-client) → mcpResult.error
      return encodeExecClientMessage(
        execId,
        execIdStr,
        11,
        fieldLd(2, fieldStr(1, NATIVE_EXEC_DISABLED)),
      );
    case 17: // listMcpResources
      return encodeExecClientMessage(
        execId,
        execIdStr,
        17,
        fieldLd(2, fieldStr(1, NATIVE_EXEC_DISABLED)),
      );
    case 18: // readMcpResource
      return encodeExecClientMessage(
        execId,
        execIdStr,
        18,
        fieldLd(2, fieldStr(1, NATIVE_EXEC_DISABLED)),
      );
    case 20: // fetchArgs → fetchResult.error
      return encodeExecClientMessage(
        execId,
        execIdStr,
        20,
        fieldLd(2, concatBytes(fieldStr(1, url), fieldStr(2, NATIVE_EXEC_DISABLED))),
      );
    default:
      return undefined;
  }
}

function encodeExecClientMessage(
  id: number,
  execIdStr: string | undefined,
  resultField: number,
  resultBody: Uint8Array,
): Uint8Array {
  const parts: Uint8Array[] = [fieldVarint(1, id)];
  if (execIdStr !== undefined && execIdStr.length > 0) {
    parts.push(fieldStr(15, execIdStr));
  }
  parts.push(fieldLd(resultField, resultBody));
  return encodeConnectFrame(fieldLd(2, concatBytes(...parts)));
}

function firstStringField(buf: Uint8Array, field: number): string | undefined {
  for (const entry of iterFields(buf)) {
    if (entry.field === field && entry.wire === 2) {
      const text = Buffer.from(entry.data).toString('utf8');
      if (text.length > 0) return text;
    }
  }
  return undefined;
}
