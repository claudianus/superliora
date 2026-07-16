import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

/**
 * Historical auto-mode AskUserQuestion deny. Kept as a no-op so policy chain
 * order / names remain stable; Auto now auto-answers inside the tool instead.
 */
export class AutoModeAskUserQuestionDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'auto-mode-ask-user-question-deny';

  constructor(private readonly _agent: Agent) {}

  evaluate(_context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    return;
  }
}
