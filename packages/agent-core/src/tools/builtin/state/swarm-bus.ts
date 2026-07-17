import { randomUUID } from 'node:crypto';

import type {
  SwarmArtifact,
  SwarmArtifactKind,
  SwarmBusChannel,
  SwarmBusMessage,
  SwarmBusMessageKind,
  SwarmBusMessageRefs,
  SwarmBusParticipant,
  TeamPlan,
} from '@superliora/protocol';

import type { ToolStore } from '../../store';

export const SWARM_BUS_STORE_KEY = 'swarm_bus' as const;

const SWARM_BUS_MAX_MESSAGES = 256;
const SWARM_BUS_LIST_DEFAULT_LIMIT = 24;
const SWARM_BUS_RATE_LIMIT_WINDOW_MS = 60_000;
const SWARM_BUS_RATE_LIMIT_MAX_POSTS = 12;
const SWARM_BUS_BODY_MAX_CHARS = 800;

declare module '../../store' {
  interface ToolStoreData {
    swarm_bus: SwarmRunBusState;
  }
}

export interface SwarmRunBusState {
  readonly runId: string;
  readonly parentToolCallId: string;
  allowlistedExpertIds: string[];
  messages: SwarmBusMessage[];
  artifacts: Record<string, SwarmArtifact>;
  readonly postTimestampsByExpertId: Record<string, number[]>;
}

export interface PostSwarmBusMessageInput {
  readonly runId: string;
  readonly parentToolCallId: string;
  readonly from: SwarmBusParticipant;
  readonly toExpertId?: string;
  readonly channel: SwarmBusChannel;
  readonly kind: SwarmBusMessageKind;
  readonly body: string;
  readonly refs?: SwarmBusMessageRefs;
  readonly threadId?: string;
  readonly orchestratorPost?: boolean;
}

export interface ListSwarmBusMessagesInput {
  readonly since?: string;
  readonly channel?: SwarmBusChannel;
  readonly threadId?: string;
  readonly limit?: number;
}

export function initSwarmRunBus(
  store: ToolStore,
  input: {
    readonly runId: string;
    readonly parentToolCallId: string;
    readonly team: TeamPlan;
  },
): SwarmRunBusState {
  const state: SwarmRunBusState = {
    runId: input.runId,
    parentToolCallId: input.parentToolCallId,
    allowlistedExpertIds: input.team.experts.map((expert) => expert.id),
    messages: [],
    artifacts: {},
    postTimestampsByExpertId: {},
  };
  store.set(SWARM_BUS_STORE_KEY, state);
  return state;
}

export function clearSwarmRunBus(store: ToolStore): void {
  store.set(SWARM_BUS_STORE_KEY, {
    runId: '',
    parentToolCallId: '',
    allowlistedExpertIds: [],
    messages: [],
    artifacts: {},
    postTimestampsByExpertId: {},
  });
}

export function getSwarmRunBus(store: ToolStore): SwarmRunBusState | undefined {
  const state = store.get(SWARM_BUS_STORE_KEY);
  if (state === undefined || state.runId.length === 0) return undefined;
  return state;
}

export function postSwarmBusMessage(
  store: ToolStore,
  input: PostSwarmBusMessageInput,
): { readonly message: SwarmBusMessage; readonly mentionExpertIds: readonly string[] } {
  const state = getSwarmRunBus(store);
  if (state === undefined) {
    throw new Error('Swarm bus is not active for this run.');
  }
  if (state.runId !== input.runId || state.parentToolCallId !== input.parentToolCallId) {
    throw new Error('Swarm bus run context mismatch.');
  }
  if (!input.orchestratorPost && !state.allowlistedExpertIds.includes(input.from.expertId)) {
    throw new Error(`Expert ${input.from.expertId} is not on the staffed team.`);
  }
  if (
    input.toExpertId !== undefined &&
    !state.allowlistedExpertIds.includes(input.toExpertId)
  ) {
    throw new Error(`Target expert ${input.toExpertId} is not on the staffed team.`);
  }
  assertRateLimit(state, input.from.expertId, input.orchestratorPost === true);

  const body = normalizeSwarmBusBody(input.body);
  if (body.length === 0) {
    throw new Error('Swarm bus message body must not be empty.');
  }

  const message: SwarmBusMessage = {
    id: `swarm-msg-${randomUUID()}`,
    runId: input.runId,
    parentToolCallId: input.parentToolCallId,
    at: new Date().toISOString(),
    from: input.from,
    to: input.toExpertId === undefined ? undefined : { expertId: input.toExpertId },
    channel: input.channel,
    kind: input.kind,
    body,
    refs: input.refs,
    threadId: input.threadId,
  };

  state.messages.push(message);
  if (state.messages.length > SWARM_BUS_MAX_MESSAGES) {
    state.messages.splice(0, state.messages.length - SWARM_BUS_MAX_MESSAGES);
  }
  recordPostTimestamp(state, input.from.expertId, input.orchestratorPost === true);

  return {
    message,
    mentionExpertIds: parseMentionExpertIds(body, state.allowlistedExpertIds),
  };
}

export interface PublishSwarmArtifactInput {
  readonly runId: string;
  readonly parentToolCallId: string;
  readonly from: SwarmBusParticipant;
  readonly kind: SwarmArtifactKind;
  readonly title: string;
  readonly summary: string;
}

export function extendSwarmBusAllowlist(
  store: ToolStore,
  expertIds: readonly string[],
): void {
  const state = getSwarmRunBus(store);
  if (state === undefined) return;
  const merged = new Set([...state.allowlistedExpertIds, ...expertIds]);
  state.allowlistedExpertIds = [...merged];
}

export function publishSwarmArtifact(
  store: ToolStore,
  input: PublishSwarmArtifactInput,
): { readonly artifact: SwarmArtifact; readonly message: SwarmBusMessage } {
  const state = getSwarmRunBus(store);
  if (state === undefined) {
    throw new Error('Swarm bus is not active for this run.');
  }
  const title = normalizeSwarmBusBody(input.title);
  const summary = normalizeSwarmBusBody(input.summary);
  if (title.length === 0 || summary.length === 0) {
    throw new Error('Swarm artifact title and summary must not be empty.');
  }
  const artifact: SwarmArtifact = {
    id: `swarm-artifact-${randomUUID()}`,
    runId: input.runId,
    parentToolCallId: input.parentToolCallId,
    kind: input.kind,
    title,
    summary,
    fromExpertId: input.from.expertId,
    at: new Date().toISOString(),
  };
  state.artifacts[artifact.id] = artifact;
  const { message } = postSwarmBusMessage(store, {
    runId: input.runId,
    parentToolCallId: input.parentToolCallId,
    from: input.from,
    channel: 'lane',
    kind: 'artifact_ref',
    body: `${artifact.kind}: ${artifact.title}`,
    refs: { artifactId: artifact.id },
  });
  return { artifact, message };
}

export function getSwarmArtifact(
  store: ToolStore,
  artifactId: string,
): SwarmArtifact | undefined {
  const state = getSwarmRunBus(store);
  return state?.artifacts[artifactId];
}

export function listSwarmBusMessages(
  store: ToolStore,
  input: ListSwarmBusMessagesInput = {},
): readonly SwarmBusMessage[] {
  const state = getSwarmRunBus(store);
  if (state === undefined) return [];
  const sinceMs = input.since === undefined ? undefined : Date.parse(input.since);
  const limit = Math.max(1, Math.min(input.limit ?? SWARM_BUS_LIST_DEFAULT_LIMIT, SWARM_BUS_MAX_MESSAGES));
  const filtered = state.messages.filter((message) => {
    if (sinceMs !== undefined && !Number.isNaN(sinceMs) && Date.parse(message.at) <= sinceMs) {
      return false;
    }
    if (input.channel !== undefined && message.channel !== input.channel) return false;
    if (input.threadId !== undefined && message.threadId !== input.threadId) return false;
    return true;
  });
  return filtered.slice(-limit);
}

export function renderSwarmBusDigest(
  store: ToolStore,
  options: { readonly limit?: number } = {},
): string {
  const limit = options.limit ?? 12;
  const messages = listSwarmBusMessages(store, { limit: SWARM_BUS_MAX_MESSAGES });
  if (messages.length === 0) return '';
  const prioritized = [...messages].sort((left, right) => {
    const priorityDiff = swarmBusDigestPriority(left) - swarmBusDigestPriority(right);
    if (priorityDiff !== 0) return priorityDiff;
    return Date.parse(left.at) - Date.parse(right.at);
  });
  const selected = prioritized.slice(-limit);
  const lines = ['<swarm_bus_digest>'];
  for (const message of selected) {
    const target = message.to === undefined ? 'team' : `@${message.to.expertId}`;
    lines.push(
      `[${message.at}] ${message.from.name} → ${target} (${message.channel}/${message.kind}): ${message.body}`,
    );
  }
  lines.push('</swarm_bus_digest>');
  return lines.join('\n');
}

function swarmBusDigestPriority(message: SwarmBusMessage): number {
  if (message.kind === 'artifact_ref' || message.kind === 'verdict') return 0;
  if (message.channel === 'blocker') return 1;
  return 2;
}

export function resolveExpertIdFromMentionToken(
  token: string,
  allowlistedExpertIds: readonly string[],
  teamNames: ReadonlyMap<string, string>,
): string | undefined {
  const normalized = token.trim().replace(/^@+/, '');
  if (normalized.length === 0) return undefined;
  const byId = allowlistedExpertIds.find(
    (expertId) => expertId === normalized || expertId.toLowerCase() === normalized.toLowerCase(),
  );
  if (byId !== undefined) return byId;
  for (const [expertId, name] of teamNames) {
    if (name.toLowerCase() === normalized.toLowerCase()) return expertId;
    if (name.toLowerCase().startsWith(normalized.toLowerCase())) return expertId;
  }
  return undefined;
}

function assertRateLimit(
  state: SwarmRunBusState,
  expertId: string,
  orchestratorPost: boolean,
): void {
  if (orchestratorPost) return;
  const now = Date.now();
  const windowStart = now - SWARM_BUS_RATE_LIMIT_WINDOW_MS;
  const previous = state.postTimestampsByExpertId[expertId] ?? [];
  const recent = previous.filter((timestamp) => timestamp >= windowStart);
  if (recent.length >= SWARM_BUS_RATE_LIMIT_MAX_POSTS) {
    throw new Error(
      `Swarm bus rate limit reached for ${expertId}. Wait before posting again.`,
    );
  }
  state.postTimestampsByExpertId[expertId] = recent;
}

function recordPostTimestamp(
  state: SwarmRunBusState,
  expertId: string,
  orchestratorPost: boolean,
): void {
  if (orchestratorPost) return;
  const now = Date.now();
  const windowStart = now - SWARM_BUS_RATE_LIMIT_WINDOW_MS;
  const previous = state.postTimestampsByExpertId[expertId] ?? [];
  state.postTimestampsByExpertId[expertId] = [
    ...previous.filter((timestamp) => timestamp >= windowStart),
    now,
  ];
}

function normalizeSwarmBusBody(body: string): string {
  return body.replaceAll(/\s+/g, ' ').trim().slice(0, SWARM_BUS_BODY_MAX_CHARS);
}

function parseMentionExpertIds(body: string, allowlistedExpertIds: readonly string[]): string[] {
  const mentions = new Set<string>();
  for (const match of body.matchAll(/@([A-Za-z0-9._-]+)/g)) {
    const token = match[1];
    if (token === undefined) continue;
    const expertId = allowlistedExpertIds.find(
      (id) => id === token || id.toLowerCase() === token.toLowerCase(),
    );
    if (expertId !== undefined) mentions.add(expertId);
  }
  return [...mentions];
}
