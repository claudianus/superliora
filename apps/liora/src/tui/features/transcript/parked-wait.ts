/**
 * A turn is parked when every in-flight tool is a blocking SessionControl wait.
 * Enter still queues rather than interrupting the waiting parent turn.
 */

export interface ParkedWaitTool {
  readonly name: string;
  readonly args?: Record<string, unknown>;
}

/** SessionControl `wait` blocks unless timeout is explicitly zero. */
export function isSessionControlBlockingWait(tool: ParkedWaitTool): boolean {
  return tool.name === 'SessionControl' && tool.args?.['operation'] === 'wait' &&
    tool.args['timeout'] !== 0;
}

/**
 * Park only when at least one tool is running and every running tool is a
 * blocking wait. A mixed step with Bash stays on busy chrome.
 */
export function isParkedSendableWait(tools: Iterable<ParkedWaitTool>): boolean {
  let count = 0;
  for (const tool of tools) {
    if (!isSessionControlBlockingWait(tool)) return false;
    count += 1;
  }
  return count > 0;
}

export function formatParkedWaitLabel(base: string): string {
  return `${base} · ctrl+s: steer`;
}
