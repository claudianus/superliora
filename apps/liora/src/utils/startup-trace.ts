import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isDebugSession } from '#/utils/debug-session';
import { getLogDir } from '#/utils/paths';

/**
 * Startup tracer for diagnosing where TUI boot stalls. Writes when
 * `SUPERLIORA_TUI_STARTUP_TRACE` is a file path, or automatically under
 * `SUPERLIORA_DEBUG` to `<home>/logs/startup-trace.log`. Never throws.
 */
/** Reset the trace file once it grows past this so a long debug boot cannot fill the disk. */
export const STARTUP_TRACE_MAX_BYTES = 256 * 1024;

let ready = false;
let startedAt = 0;
let startupTraceMaxBytes = STARTUP_TRACE_MAX_BYTES;

export function setStartupTraceMaxBytesForTest(bytes: number | undefined): void {
  startupTraceMaxBytes = bytes ?? STARTUP_TRACE_MAX_BYTES;
}

function resolveStartupTracePath(): string | undefined {
  const explicit = process.env['SUPERLIORA_TUI_STARTUP_TRACE'];
  if (explicit !== undefined && explicit.length > 0) return explicit;
  if (!isDebugSession()) return undefined;
  return join(getLogDir(), 'startup-trace.log');
}

export function startupTrace(step: string): void {
  const tracePath = resolveStartupTracePath();
  if (tracePath === undefined) return;
  try {
    if (!ready) {
      mkdirSync(dirname(tracePath), { recursive: true });
      writeFileSync(tracePath, '', 'utf8');
      startedAt = Date.now();
      ready = true;
    }
    const line = `[${Date.now() - startedAt}] ${step}\n`;
    let size = 0;
    try {
      size = statSync(tracePath).size;
    } catch {
      size = 0;
    }
    if (size > 0 && size + Buffer.byteLength(line, 'utf8') > startupTraceMaxBytes) {
      writeFileSync(tracePath, line, 'utf8');
    } else {
      appendFileSync(tracePath, line, 'utf8');
    }
  } catch {
    // Diagnostics must never break startup.
  }
}
