import { readFile } from 'node:fs/promises';
import { join } from 'pathe';
import { gunzipSync } from 'node:zlib';

import { isGzipWirePath, resolveWirePath } from '#/session/store/wire-gzip';

export interface SessionWireScan {
  readonly firstActivityMs?: number | undefined;
  readonly lastActivityMs?: number | undefined;
  readonly lastUserMessageMs?: number | undefined;
  readonly firstUserInput?: string | undefined;
}

const USER_TURN_TYPES = new Set(['turn.prompt', 'turn.steer', 'turn_begin']);

export async function scanSessionWire(sessionDir: string): Promise<SessionWireScan> {
  const raw = await readSessionWireText(sessionDir);
  if (raw === undefined) return {};

  let firstActivityMs: number | undefined;
  let lastActivityMs: number | undefined;
  let lastUserMessageMs: number | undefined;
  let firstUserInput: string | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    const timeMs = typeof record['time'] === 'number' ? normalizeTimestampMs(record['time']) : undefined;
    if (timeMs !== undefined) {
      firstActivityMs ??= timeMs;
      lastActivityMs = timeMs;
    }
    if (typeof record['type'] !== 'string' || !USER_TURN_TYPES.has(record['type'])) continue;
    if (timeMs !== undefined) {
      lastUserMessageMs = timeMs;
    }
    if (firstUserInput === undefined) {
      const text = userTextFromRecord(record);
      if (text !== undefined) firstUserInput = text;
    }
  }

  return {
    firstActivityMs,
    lastActivityMs,
    lastUserMessageMs,
    firstUserInput,
  };
}

async function readSessionWireText(sessionDir: string): Promise<string | undefined> {
  const path =
    (await resolveWirePath(join(sessionDir, 'agents', 'main'))) ??
    (await resolveWirePath(sessionDir));
  if (path === undefined) return undefined;
  if (isGzipWirePath(path)) {
    return gunzipSync(await readFile(path)).toString('utf-8');
  }
  return readFile(path, 'utf-8');
}

function userTextFromRecord(record: Record<string, unknown>): string | undefined {
  if (typeof record['userInput'] === 'string' && record['userInput'].trim().length > 0) {
    return record['userInput'].trim();
  }
  if (typeof record['user_input'] === 'string' && record['user_input'].trim().length > 0) {
    return record['user_input'].trim();
  }
  const input = record['input'];
  if (!Array.isArray(input)) return undefined;
  const parts: string[] = [];
  for (const part of input) {
    if (typeof part !== 'object' || part === null) continue;
    const item = part as { type?: unknown; text?: unknown };
    if (item.type !== 'text' || typeof item.text !== 'string') continue;
    const text = item.text.trim();
    if (text.length > 0) parts.push(text);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function normalizeTimestampMs(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
}
