import type { SessionWarning } from '@superliora/protocol';

import type {
  EmptyPayload,
  McpStartupMetrics,
  PluginCommandDef,
  ReconnectMcpServerPayload,
  SearchSkillsPayload,
  SkillSearchResult,
  SkillSummary,
} from './core-api';

import type { SessionAgentMethodsContext } from './session-agent-methods';

type SessionScopedPayload<T> = T & { readonly sessionId: string };

export function listSkills(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<EmptyPayload>): Promise<readonly SkillSummary[]> {
  return context.sessionApi(sessionId).listSkills(payload);
}

export function listPluginCommands(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<EmptyPayload>): readonly PluginCommandDef[] {
  return context.sessionApi(sessionId).listPluginCommands(payload);
}

export function searchSkills(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<SearchSkillsPayload>): Promise<readonly SkillSearchResult[]> {
  return context.sessionApi(sessionId).searchSkills(payload);
}

export function listMcpServers(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<EmptyPayload>): readonly McpServerInfo[] {
  return context.sessionApi(sessionId).listMcpServers(payload);
}

export function getMcpStartupMetrics(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<EmptyPayload>): Promise<McpStartupMetrics> {
  return context.sessionApi(sessionId).getMcpStartupMetrics(payload);
}

export function reconnectMcpServer(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<ReconnectMcpServerPayload>): Promise<void> {
  return context.sessionApi(sessionId).reconnectMcpServer(payload);
}

export function generateAgentsMd(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<void> {
  return context.sessionApi(sessionId).generateAgentsMd(payload);
}

export function getSessionWarnings(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<readonly SessionWarning[]> {
  return context.sessionApi(sessionId).getSessionWarnings(payload);
}
