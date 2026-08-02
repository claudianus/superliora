/**
 * Loop24a/b — surface engine doom-loop signals in the TUI.
 *
 * Hard stop: agent-core blocks identical (tool,args) past the hard threshold and
 * returns an isError tool result with `DOOM_LOOP_HARD_STOP`. Soft warn (Loop24b):
 * at the warn threshold a `DOOM_LOOP_WARN:` tip is appended to the tool output.
 */

export const DOOM_LOOP_HARD_STOP_CODE = 'DOOM_LOOP_HARD_STOP';
export const DOOM_LOOP_WARN_PREFIX = 'DOOM_LOOP_WARN:';

export type DoomLoopNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'doom-loop-hard-stop' | 'doom-loop-soft-warn';
};

function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (output !== null && typeof output === 'object') {
    try {
      return JSON.stringify(output);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** True when a tool result payload is the engine doom-loop hard stop. */
export function isDoomLoopHardStopOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return text.includes(DOOM_LOOP_HARD_STOP_CODE) || text.includes('doom_loop_hard_stop');
}

/** True when a tool result carries the soft warn tip (not yet hard-stopped). */
export function isDoomLoopSoftWarnOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  // Soft tip only — hard stop messages must not also fire the soft notice.
  if (isDoomLoopHardStopOutput(text)) return false;
  return text.includes(DOOM_LOOP_WARN_PREFIX);
}

export function formatDoomLoopHardStopNotice(toolName?: string): DoomLoopNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  return {
    title: 'Doom loop hard stop',
    detail: `Identical ${tool} call repeated past the per-turn threshold (code=${DOOM_LOOP_HARD_STOP_CODE}). The engine blocked re-execution and will end the turn. Change approach, summarize the stall, or ask the user — do not retry the same args.`,
    status: `Turn stopped: doom loop hard stop on ${tool}`,
    coalesceKey: 'doom-loop-hard-stop',
  };
}

export function formatDoomLoopSoftWarnNotice(toolName?: string): DoomLoopNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  return {
    title: 'Doom loop soft warn',
    detail: `Identical ${tool} call is repeating this turn (${DOOM_LOOP_WARN_PREFIX} attached for the model). Change approach before the hard stop threshold.`,
    status: `Doom loop soft warn on ${tool}`,
    coalesceKey: 'doom-loop-soft-warn',
  };
}
