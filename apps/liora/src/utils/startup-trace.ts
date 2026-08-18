import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isDebugSession } from '#/utils/debug-session';
import { getLogDir } from '#/utils/paths';

/**
 * Startup tracer for diagnosing where TUI boot stalls. Writes when
 * `SUPERLIORA_TUI_STARTUP_TRACE` is a file path, or automatically under
 * `SUPERLIORA_DEBUG` to `<home>/logs/startup-trace.log`. Never throws.
 */
let ready = false;
let startedAt = 0;

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
    appendFileSync(tracePath, `[${Date.now() - startedAt}] ${step}\n`, 'utf8');
  } catch {
    // Diagnostics must never break startup.
  }
}
