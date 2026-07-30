import type { Agent } from '../..';
import type { BackgroundTaskOutputSnapshot, ManagedTask } from './managed-types';
import type { BackgroundTaskPersistence } from './persist';
import type { BackgroundTaskInfo } from './task';

/** Shared surface extracted manager modules use instead of importing the class. */
export interface BackgroundManagerHost {
  readonly agent: Agent;
  readonly persistence?: BackgroundTaskPersistence;
  readonly tasks: Map<string, ManagedTask>;
  readonly ghosts: Map<string, BackgroundTaskInfo>;
  readonly scheduledNotificationKeys: Set<string>;
  readonly deliveredNotificationKeys: Set<string>;

  toInfo(entry: ManagedTask): BackgroundTaskInfo;
  getTask(taskId: string): BackgroundTaskInfo | undefined;
  list(activeOnly?: boolean, limit?: number): BackgroundTaskInfo[];
  isDetached(entry: ManagedTask): boolean;
  getOutputSnapshot(taskId: string, maxPreviewBytes: number): Promise<BackgroundTaskOutputSnapshot>;
}
