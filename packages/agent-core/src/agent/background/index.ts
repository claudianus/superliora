/**
 * Background task manager — registration, lifecycle, persistence, and notifications.
 *
 * Concrete task classes own execution details; {@link BackgroundManager} owns task
 * registration, lifecycle state, persistence, output, and notifications.
 */

export { isBackgroundTaskTerminal } from './terminal-status';
export { MAX_MULTI_WAIT_TASKS, MultiWaitLimitError } from './multi-wait';
export { AgentBackgroundTask } from './agent-task';
export type { AgentBackgroundTaskInfo } from './agent-task';
export { ProcessBackgroundTask } from './process-task';
export type { ProcessBackgroundTaskInfo } from './process-task';
export { QuestionBackgroundTask } from './question-task';
export type { QuestionBackgroundTaskInfo } from './question-task';
export { BackgroundTaskPersistence } from './persist';
export type { BackgroundTaskInfo, BackgroundTaskStatus } from './task';
export type {
  BackgroundTaskOutputSnapshot,
  ForegroundTaskReleaseReason,
  RegisterBackgroundTaskOptions,
} from './managed-types';
export { BackgroundManager } from './manager';
