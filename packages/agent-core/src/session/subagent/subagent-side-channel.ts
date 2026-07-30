/**
 * Side-channel ("btw") subagent: lightweight user Q&A with tools disabled.
 *
 * Extracted from subagent-host so the host class stays focused on main/subagent
 * orchestration.
 */

import type { Agent } from '../../agent';
import { DenyAllPermissionPolicy } from '../../agent/permission/policies/deny-all';
import { InMemoryAgentRecordPersistence } from '../../agent/records';
import type { Session } from '../index';

const TOOL_CALL_DISABLED_MESSAGE =
  'Tool calls are disabled for side questions. Answer with text only.';
const SIDE_QUESTION_SYSTEM_REMINDER = `
This is a side-channel conversation with the user. Answer from what you already know.

- Lightweight instance; main agent continues independently.
- All tool calls are disabled and will be rejected. Tool definitions are visible for cache only — do not call them.
- Text only; say when you do not know.
`;

export async function createSideChannelSubagent(
  session: Session,
  ownerAgentId: string,
): Promise<string> {
  const parent = await session.ensureAgentResumed(ownerAgentId);
  const { id, agent: child } = await session.createAgent(
    {
      type: 'sub',
      generate: parent.rawGenerate,
      persistence: new InMemoryAgentRecordPersistence(),
    },
    { parentAgentId: ownerAgentId, persistMetadata: false },
  );

  configureSideChannelChild(parent, child);
  return id;
}

function configureSideChannelChild(parent: Agent, child: Agent): void {
  child.config.update({
    modelAlias: parent.config.modelAlias,
    thinkingLevel: parent.config.thinkingLevel,
    systemPrompt: parent.config.systemPrompt,
  });
  child.tools.copyLoopToolsFrom(parent.tools);
  child.context.useProjectedHistoryFrom(parent.context);
  child.context.appendSystemReminder(SIDE_QUESTION_SYSTEM_REMINDER.trim(), {
    kind: 'system_trigger',
    name: 'btw',
  });
  child.permission.policies.unshift(new DenyAllPermissionPolicy(TOOL_CALL_DISABLED_MESSAGE));
}
