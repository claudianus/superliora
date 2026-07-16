import type { PermissionMode } from '../permission';
import { DynamicInjector } from './injector';

const AUTO_MODE_ENTER_REMINDER = [
  'Auto permission mode is active. Tool approvals run automatically while enabled.',
  '  - Continue without approval prompts for ordinary tools.',
  '  - AskUserQuestion auto-answers structured questions (recommended option, else first; open-ended uses a conservative baseline assumption). Ultra Plan interview still runs the same question flow.',
  '  - Ultra Plan Research is read-only — do not ask the user there. Outside interview, prefer deciding without AskUserQuestion unless a missing decision blocks correctness. Inside interview, use read-only search/read tools before each question when needed; NextPhase enforces the gate.',
].join('\n');

const AUTO_MODE_EXIT_REMINDER = [
  'Auto permission mode is no longer active. Tool approvals and permission checks follow the current mode.',
  '  - Continue normally; expect approval prompts or denials when tools require them.',
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
