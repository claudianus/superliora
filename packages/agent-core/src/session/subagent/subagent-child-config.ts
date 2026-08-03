/**
 * Subagent child setup: profile resolution, spawn-time guards, ownership
 * claims, and UltraSwarm channel wiring.
 *
 * Extracted from subagent-host so spawn/resume paths stay readable without
 * growing the SessionSubagentHost class body.
 */

import type { Agent } from '../../agent';
import { resolveExpertCatalogEntry } from '../../expert-agents/catalog-extensions';
import {
  deliverSwarmBusCoordination,
  emitSwarmCollaborationMessage,
  emitSwarmCollaborationMention,
} from '#/fleet';
import { SwarmChannelTool } from '../../tools/builtin/fleet/swarm-channel';
import {
  DEFAULT_AGENT_PROFILES,
  prepareSystemPromptContext,
  type ResolvedAgentProfile,
} from '../../profile';
import { resolveSubagentModelAlias } from '../../utils/cheap-model';
import { checkContractFile } from '../contract-check';
import { getDefaultSwarmFileLeaseRegistry } from '#/fleet';
import type { Session } from '../index';
import {
  createExpertSubagentProfile,
  isModelAliasHealthy,
} from './subagent-run-lifecycle';
import { attachSubagentTodoBridge } from './subagent-telemetry';
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
  if (metadata?.type !== 'sub') {
    throw new Error(`Agent instance "${agentId}" is not a subagent`);
  }
  if (metadata.parentAgentId !== ownerAgentId) {
    throw new Error(`Agent instance "${agentId}" does not belong to this parent agent`);
  }
  const child = await session.ensureAgentResumed(agentId);
  if (activeChildren.has(agentId) || child.turn.hasActiveTurn) {
    throw new Error(`Agent instance "${agentId}" is already running and cannot run concurrently`);
  }

  const profileName = child.config.profileName ?? 'subagent';
  return { parent, child, profileName };
}

export function resolveSubagentProfile(
  parent: Agent,
  profileName: string,
  profileBaseName?: string,
): ResolvedAgentProfile {
  const profile =
    DEFAULT_AGENT_PROFILES[parent.config.profileName ?? 'agent']?.subagents?.[profileName] ??
    DEFAULT_AGENT_PROFILES['agent']?.subagents?.[profileName];
  if (profile !== undefined) return profile;

  const pluginAgent = parent.pluginAgents.find((agent) => agent.profileName === profileName);
  if (pluginAgent !== undefined) return pluginAgent.profile;

  const expert = resolveExpertCatalogEntry(profileName);
  if (expert === undefined) {
    throw new Error(`Subagent profile "${profileName}" was not found`);
  }

  const baseName = profileBaseName ?? 'coder';
  const baseProfile =
    DEFAULT_AGENT_PROFILES[parent.config.profileName ?? 'agent']?.subagents?.[baseName] ??
    DEFAULT_AGENT_PROFILES['agent']?.subagents?.[baseName];
  if (baseProfile === undefined) {
    throw new Error(`Subagent profile "${baseName}" was not found`);
  }

  return createExpertSubagentProfile(expert, baseProfile);
}

/**
 * All-mode file lease (harness reform T4-2): every spawned child gets a
 * lease identity so its edits conflict-check against other owners, and any
 * declared ownership is pre-claimed so overlaps fail at fan-out instead of
 * mid-run.
 */
export function claimChildOwnership(
  child: Agent,
  childId: string,
  options: RunSubagentOptions,
): void {
  const runId = options.parentToolCallId;
  child.swarmFileLease = { ownerId: childId, runId };
  const declared = options.ownership ?? [];
  if (declared.length === 0) return;
  const registry = getDefaultSwarmFileLeaseRegistry();
  for (const rawPath of declared) {
    const result = registry.claim(rawPath, childId, runId);
    if (result.ok) continue;
    registry.releaseAll(runId);
    const holder = result.conflict.holder;
    throw new Error(
      `Ownership conflict on ${result.conflict.path}: already claimed by owner=${holder.ownerId} run=${holder.runId}. Resolve the overlap before fan-out.`,
    );
  }
}

/**
 * Contract-first guard (harness reform T4-3): refuse fan-out while the
 * shared contract file no longer compiles, so conflicting type changes are
 * caught by the compiler before agents diverge.
 */
export async function assertContractCompiles(
  parent: Agent,
  options: RunSubagentOptions,
): Promise<void> {
  const contractPath = options.contractPath?.trim();
  if (contractPath === undefined || contractPath.length === 0) return;
  const check = await checkContractFile(parent.kaos, parent.config.cwd, contractPath);
  if (check.ok) return;
  const detail =
    check.output !== undefined && check.output.length > 0 ? `\n${check.output}` : '';
  throw new Error(
    `Contract file did not compile (${check.kind}) — fix it before fan-out: ${contractPath}${detail}`,
  );
}

export async function configureSubagentChild(
  session: Session,
  parent: Agent,
  child: Agent,
  profile: ResolvedAgentProfile,
  childId: string,
  options: RunSubagentOptions,
  profileBaseName?: string,
): Promise<void> {
  const cwd = options.worktreeDir ?? parent.config.cwd;
  child.config.update({
    cwd,
    modelAlias: resolveSubagentModelAlias(
      profile.name,
      profileBaseName,
      parent.config.modelAlias,
      parent.kimiConfig?.models,
      parent.kimiConfig?.loopControl?.explorationModel,
      {
        isAliasHealthy: (alias) => isModelAliasHealthy(alias, parent.kimiConfig?.models),
      },
    ),
    thinkingLevel: parent.config.thinkingLevel,
  });
  if (options.worktreeDir !== undefined) {
    child.setKaos(parent.kaos.withCwd(cwd));
  }

  const context = await prepareSystemPromptContext(
    session.systemContextKaos(child.kaos.getcwd()),
    session.options.kimiHomeDir,
    { additionalDirs: child.getAdditionalDirs() },
  );
  child.useProfile(profile, context);
  child.tools.inheritUserTools(parent.tools);
  attachSubagentTodoBridge(parent, child, childId, profile.name, options);
  attachUltraSwarmChannelIfNeeded(session, parent, child, childId, options, profile.name);
}

export function attachUltraSwarmChannelIfNeeded(
  session: Session,
  parent: Agent,
  child: Agent,
  childAgentId: string,
  options: RunSubagentOptions,
  profileName: string,
): void {
  const run = parent.ultraSwarmRun;
  if (run === undefined || options.parentToolCallId !== run.parentToolCallId) {
    return;
  }
  child.swarmFileLease = { ownerId: childAgentId, runId: run.runId };
  if (!run.busEnabled) return;
  const expert = run.team.experts.find((entry) => entry.id === profileName);
  if (expert === undefined) return;
  child.tools.attachEphemeralBuiltin(
    new SwarmChannelTool({
      parentAgent: parent,
      parentStore: parent.tools.getStore(),
      run,
      expert,
      childAgentId,
      onMessagePosted: ({ message, mentionExpertIds }) => {
        emitSwarmCollaborationMessage(parent, message);
        emitSwarmCollaborationMention(parent, message, mentionExpertIds);
        deliverSwarmBusCoordination(session, parent, message, mentionExpertIds);
      },
    }),
  );
}
