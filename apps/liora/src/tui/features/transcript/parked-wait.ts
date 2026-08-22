/**
 * A turn is parked when every in-flight tool is a blocking TaskOutput wait.
 * The model is not producing; busy chrome (moon spinner, elapsed, tokens)
 * would look like active work. SuperLiora Enter still queues during a wait,
 * so the cue must not claim that sending interrupts — grok-build can, we cannot.
 */

export interface ParkedWaitTool {
  readonly name: string;
  readonly args?: Record<string, unknown>;
}

/** `TaskOutput` with `block: true` — the SuperLiora analog of grok's sendable wait. */
export function isTaskOutputBlockingWait(tool: ParkedWaitTool): boolean {
  if (tool.name !== 'TaskOutput') return false;
  const block = tool.args?.block;
  return block === true || block === 'true';
}

/**
 * Park only when at least one tool is running and every running tool is a
 * blocking TaskOutput. A mixed step (Read + wait) stays on busy chrome.
 * Foreground Agent waits stay busy — the subagent is still producing.
 */
export function isParkedSendableWait(tools: Iterable<ParkedWaitTool>): boolean {
  let count = 0;
  for (const tool of tools) {
    if (!isTaskOutputBlockingWait(tool)) return false;
    count += 1;
  }
  return count > 0;
}

export function formatParkedWaitLabel(base: string): string {
  return `${base} · ctrl+s: steer`;
}
