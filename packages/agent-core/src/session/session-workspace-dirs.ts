/**
 * Workspace additional-directory notifications — extracted from Session class.
 */

import type { Agent } from '../agent';

export function notifyAdditionalDirAdded(
  mainAgent: Agent,
  path: string,
  persisted: boolean,
  configPath: string,
): void {
  const message = persisted
    ? `Added workspace directory:\n  ${path}\n  Saved to:\n  ${configPath}`
    : `Added workspace directory:\n  ${path}\n  For this session only`;
  mainAgent.context.appendLocalCommandStdout(message);
}
