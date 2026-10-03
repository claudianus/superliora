import type { Agent } from '../../agent';
import { DEFAULT_AGENT_PROFILES, prepareSystemPromptContext } from '../../profile';
import { getDefaultSwarmFileLeaseRegistry, normalizeLeasePath } from '#/fleet/swarm-file-lease';
import type { Session } from '../index';
import { resolveSubagentModelSelection } from './subagent-model-routing';
import type { RunSubagentOptions } from './subagent-host-types';
import type { ActiveChildEntry } from './subagent-run-lifecycle';

export async function ensureIdleSubagent(
  session: Session,
  ownerAgentId: string,
  activeChildren: ReadonlyMap<string, ActiveChildEntry>,
  agentId: string,
): Promise<{ readonly parent: Agent; readonly child: Agent; readonly profileName: string }> {
  const parent = await session.ensureAgentResumed(ownerAgentId);
  const metadata = session.metadata.agents[agentId];
  if (metadata?.type !== 'sub' || metadata.parentAgentId !== ownerAgentId) {
    throw new Error(`Agent instance "${agentId}" does not belong to this parent agent`);
  }
  const child = await session.ensureAgentResumed(agentId);
  if (activeChildren.has(agentId) || child.turn.hasActiveTurn) {
    throw new Error(`Agent instance "${agentId}" is already running and cannot run concurrently`);
  }
  return { parent, child, profileName: 'agent' };
}

/** Explicit claims fail before a child turn starts, without touching siblings. */
export function claimChildOwnership(child: Agent, childId: string, options: RunSubagentOptions): void {
  const runId = options.parentToolCallId;
  const registry = getDefaultSwarmFileLeaseRegistry();
  for (const rawPath of options.ownership ?? []) {
    const path = normalizeLeasePath(rawPath, options.worktreeDir ?? child.config.cwd);
    const result = registry.claim(path, childId, runId);
    if (result.ok) continue;
    registry.releaseOwner(childId, runId);
    const holder = result.conflict.holder;
    throw new Error(`Ownership conflict on ${result.conflict.path}: already claimed by owner=${holder.ownerId} run=${holder.runId}.`);
  }
}

export async function configureSubagentChild(
  session: Session,
  parent: Agent,
  child: Agent,
  options: RunSubagentOptions,
): Promise<void> {
  const cwd = options.worktreeDir ?? parent.kaos.getcwd();
  const selection = resolveSubagentModelSelection(parent, options.modelAlias);
  child.config.update({ cwd, modelAlias: selection.alias, thinkingLevel: selection.thinkingLevel });
  child.permission.setMode(options.permissionMode ?? parent.permission.mode);
  const kaos = cwd === parent.kaos.getcwd() ? parent.kaos : parent.kaos.withCwd(cwd);
  if (child.kaos !== kaos) child.setKaos(kaos);
  const context = await prepareSystemPromptContext(
    session.systemContextKaos(child.kaos.getcwd()),
    session.options.kimiHomeDir,
    { additionalDirs: child.getAdditionalDirs() },
  );
  const profile = DEFAULT_AGENT_PROFILES['agent'];
  if (profile === undefined) throw new Error('Default agent profile is unavailable');
  child.useProfile(profile, context);
}
