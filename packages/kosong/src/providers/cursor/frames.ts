/**
 * Build paced Connect request frames for one Cursor AgentService/Run turn.
 */

import { randomUUID } from 'node:crypto';

import { encodeConnectFrame } from './connect';
import { toCursorWireModelId } from './model-id';
import {
  concatBytes,
  encodeProtobufValue,
  fieldLd,
  fieldStr,
  fieldVarint,
} from './proto';

export interface CursorAgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export interface CursorRunParams {
  readonly prompt: string;
  readonly modelId: string;
  readonly cwd: string;
  /** AgentMode enum: AGENT=1, ASK=2, PLAN=3. */
  readonly mode: number;
  readonly tools: readonly CursorAgentTool[];
}

/** Build the ordered Connect data frames for a single agent turn. */
export function buildRunFrames(params: CursorRunParams): Uint8Array[] {
  const conv = randomUUID();
  const msg = randomUUID();

  const inner = concatBytes(
    fieldStr(1, params.prompt),
    fieldStr(2, msg),
    fieldStr(3, ''),
    fieldVarint(4, params.mode),
  );
  const messages = fieldLd(2, fieldLd(1, fieldLd(1, inner)));

  const wireModelId = toCursorWireModelId(params.modelId);
  const req = concatBytes(
    fieldStr(1, ''),
    messages,
    fieldLd(4, encodeMcpTools(params.tools)),
    fieldStr(5, conv),
    // RequestedModel / ModelDetails: model_id only. Effort+fast are baked into
    // GetUsableModels wire ids (`grok-4.5-fast-high`); do not invent a `fast=false`
    // parameter that fights the id (opencodex ModelDetails path).
    fieldLd(9, encodeModelMeta(wireModelId)),
    fieldVarint(12, 0),
    fieldLd(14, fieldStr(1, 'default')),
    fieldLd(14, encodeModelMeta(wireModelId)),
    fieldStr(16, conv),
  );
  const frame0 = encodeConnectFrame(fieldLd(1, req));

  const env = concatBytes(
    fieldStr(1, process.platform === 'darwin' ? 'darwin' : 'linux'),
    fieldStr(2, params.cwd),
    fieldStr(3, 'bash'),
    fieldStr(10, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    fieldStr(11, params.cwd),
    fieldVarint(14, 1),
    fieldVarint(16, 1),
    fieldVarint(19, 0),
    fieldVarint(20, 0),
    fieldStr(21, params.cwd),
    fieldVarint(22, 0),
  );
  const ctx = fieldLd(2, fieldLd(10, fieldLd(1, fieldLd(1, fieldLd(4, env)))));
  const frame1 = encodeConnectFrame(ctx);

  const frames: Uint8Array[] = [frame0, frame1];
  frames.push(encodeConnectFrame(fieldLd(5, fieldStr(1, ''))));
  frames.push(encodeConnectFrame(fieldLd(3, fieldStr(3, ''))));
  for (let n = 1; n <= 8; n++) {
    frames.push(encodeConnectFrame(fieldLd(3, concatBytes(fieldVarint(1, n), fieldStr(3, '')))));
  }
  return frames;
}

/** Heartbeat frame `{f7: empty}` kept on the open request stream. */
export function heartbeatFrame(): Uint8Array {
  return encodeConnectFrame(fieldLd(7, new Uint8Array(0)));
}

function encodeMcpTools(tools: readonly CursorAgentTool[]): Uint8Array {
  if (tools.length === 0) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  for (const tool of tools) {
    parts.push(fieldLd(1, encodeMcpToolDef(tool)));
  }
  return concatBytes(...parts);
}

function encodeMcpToolDef(tool: CursorAgentTool): Uint8Array {
  return concatBytes(
    fieldStr(1, tool.name),
    fieldStr(2, tool.description),
    fieldLd(3, encodeProtobufValue(tool.inputSchema)),
    fieldStr(4, 'superliora'),
    fieldStr(5, tool.name),
  );
}

function encodeModelMeta(name: string): Uint8Array {
  return fieldStr(1, name);
}
