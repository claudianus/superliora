/**
 * Background task RPC delegation for Session — extracted from session.ts.
 */

import { ErrorCodes } from '@superliora/agent-core';

import { normalizeRequiredString } from '#/session-helpers';
import { SessionConversationLoopMixin } from '#/session-conversation-loop';
import type { BackgroundTaskInfo } from '#/types';

export abstract class SessionBackgroundTasksMixin extends SessionConversationLoopMixin {
  /**
   * List background tasks for this session's interactive agent.
   *
   * Defaults to all tasks (including terminal/lost). Pass
   * `{ activeOnly: true }` to filter to non-terminal entries.
   */
  async listBackgroundTasks(
    options: { activeOnly?: boolean; limit?: number } = {},
  ): Promise<readonly BackgroundTaskInfo[]> {
    this.ensureOpen();
    return this.rpc.listBackgroundTasks({
      sessionId: this.id,
      activeOnly: options.activeOnly,
      limit: options.limit,
    });
  }

  /**
   * Read a background task's captured output. Returns the in-memory
   * ring buffer if available, otherwise falls back to the persisted
   * `<sessionDir>/tasks/<taskId>/output.log`. `tail` caps the returned
   * string to that many trailing characters.
   */
  async getBackgroundTaskOutput(
    taskId: string,
    options: { tail?: number } = {},
  ): Promise<string> {
    this.ensureOpen();
    const trimmedTaskId = normalizeRequiredString(
      taskId,
      'Task id cannot be empty',
      ErrorCodes.BACKGROUND_TASK_ID_EMPTY,
    );
    return this.rpc.getBackgroundTaskOutput({
      sessionId: this.id,
      taskId: trimmedTaskId,
      tail: options.tail,
    });
  }

  /**
   * Request a running background task to stop. Sends SIGTERM with a
   * grace period (handled by the core BPM); subscribers receive a
   * `background.task.terminated` event when the kill settles. Calls
   * for unknown or already-terminal task ids are no-ops at the core
   * level — this method does not throw in those cases.
   */
  async stopBackgroundTask(
    taskId: string,
    options: { reason?: string } = {},
  ): Promise<void> {
    this.ensureOpen();
    const trimmedTaskId = normalizeRequiredString(
      taskId,
      'Task id cannot be empty',
      ErrorCodes.BACKGROUND_TASK_ID_EMPTY,
    );
    await this.rpc.stopBackgroundTask({
      sessionId: this.id,
      taskId: trimmedTaskId,
      reason: options.reason,
    });
  }

  /**
   * Detach a running foreground task so the current tool call can return while
   * the task continues under background-task management.
   */
  async detachBackgroundTask(taskId: string): Promise<BackgroundTaskInfo | undefined> {
    this.ensureOpen();
    const trimmedTaskId = normalizeRequiredString(
      taskId,
      'Task id cannot be empty',
      ErrorCodes.BACKGROUND_TASK_ID_EMPTY,
    );
    return this.rpc.detachBackgroundTask({
      sessionId: this.id,
      taskId: trimmedTaskId,
    });
  }
}
