import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Env-gated startup tracer for diagnosing where TUI boot stalls. Set
 * `SUPERLIORA_TUI_STARTUP_TRACE` to a file path; each `startupTrace(step)`
 * appends `[<ms>] <step>`. Diagnostics only — never throws, no-op when unset.
 */
let ready = false;
let startedAt = 0;

export function startupTrace(step: string): void {
  const tracePath = process.env['SUPERLIORA_TUI_STARTUP_TRACE'];
  if (tracePath === undefined || tracePath.length === 0) return;
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
