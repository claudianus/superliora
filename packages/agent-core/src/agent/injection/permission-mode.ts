import type { PermissionMode } from '../permission';
import { DynamicInjector } from './injector';

const AUTO_MODE_ENTER_REMINDER = [
  'Auto permission mode is active. Tool approvals run automatically while enabled.',
  '  - Continue without approval prompts.',
  '  - Ultra Plan starts with a read-only Research phase; do not ask the user there. Outside Ultra Plan interview, avoid AskUserQuestion unless a missing decision blocks correctness. Inside Ultra Plan interview, use read-only tools before each question when needed; NextPhase enforces the gate.',
].join('\n');

const AUTO_MODE_EXIT_REMINDER = [
  'Auto permission mode is no longer active. Tool approvals and permission checks are back to the current mode.',
  '  - Continue normally, but expect approval prompts or denials when tools require them.',
].join('\n');

export class PermissionModeInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'permission_mode';
  private lastMode: PermissionMode | undefined;

  getInjection(): string | undefined {
    const mode = this.agent.permission.mode;
    const previousMode = this.lastMode;

    if (mode === previousMode) return undefined;

    this.lastMode = mode;
    if (mode === 'auto') return AUTO_MODE_ENTER_REMINDER;
    if (previousMode === 'auto') return AUTO_MODE_EXIT_REMINDER;
    return undefined;
  }
}
