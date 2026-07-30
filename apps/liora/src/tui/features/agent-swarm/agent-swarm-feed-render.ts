import { renderRendererLabeledDividerRow, truncateToWidth, visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';

import type {
  AgentSwarmMember,
  SwarmOpsFeedEntry,
} from '#/tui/components/messages/agent-swarm-progress';
import { resolveResponsiveLayout, type ResponsiveLayoutProfile } from '#/tui/controllers/responsive-layout';
import type { ColorPalette } from '#/tui/theme/colors';
import {
  collapseWhitespace,
  feedThreadKey,
  isConversationFeedTag,
  shortExpertId,
  shortExpertName,
  stripAnsiText,
} from '#/tui/features/agent-swarm/agent-swarm-cell-render';

const SWARM_FEED_BODY_MIN_WIDTH = 24;
const SWARM_FEED_BODY_WIDTH_RATIO = 0.65;
const SWARM_FEED_NARROW_WIDTH = 72;
const SWARM_OPS_FEED_RENDER_LINES = 8;
const SWARM_OPS_FEED_RENDER_LINES_TINY = 4;

/** Shared read-only context for feed/tool-feed line rendering below. */
export interface SwarmFeedRenderContext {
  readonly colors: ColorPalette;
  readonly showRawFeed: boolean;
  readonly expertSlotById: ReadonlyMap<string, string>;
  readonly members: readonly AgentSwarmMember[];
}

/** Rebuilds the expertId → member-slot lookup used for feed header labels. */
export function rebuildAgentSwarmExpertSlotIndex(
  members: readonly AgentSwarmMember[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const member of members) {
    const expertId = member.ultraSwarm?.expertId;
    if (expertId !== undefined) index.set(expertId, member.id);
  }
  return index;
}

export function resolveAgentSwarmFeedEntryBody(
  entry: SwarmOpsFeedEntry,
  showRawFeed: boolean,
): string {
  if (
    showRawFeed &&
    entry.rawBody !== undefined &&
    collapseWhitespace(entry.rawBody).length > 0
  ) {
    return collapseWhitespace(entry.rawBody);
  }
  return entry.body;
}

function resolveExpertSlot(
  context: Pick<SwarmFeedRenderContext, 'expertSlotById' | 'members'>,
  expertId?: string,
  name?: string,
): string | undefined {
  if (expertId !== undefined) {
    const byId = context.expertSlotById.get(expertId);
    if (byId !== undefined) return byId;
  }
  if (name === undefined) return undefined;
  for (const member of context.members) {
    if (member.ultraSwarm?.name === name) return member.id;
  }
  return undefined;
}

function formatExpertLabel(
  context: Pick<SwarmFeedRenderContext, 'expertSlotById' | 'members'>,
  expertId?: string,
  name?: string,
  emoji?: string,
): string {
  const slot = resolveExpertSlot(context, expertId, name);
  const trimmedEmoji = emoji?.trim();
  if (slot !== undefined) {
    return trimmedEmoji !== undefined && trimmedEmoji.length > 0 ? `${trimmedEmoji}${slot}` : slot;
  }
  if (name !== undefined && name.length > 0) return shortExpertName(name);
  if (expertId !== undefined && expertId.length > 0) return shortExpertId(expertId);
  return '?';
}

function formatFeedHeaderStyled(entry: SwarmOpsFeedEntry, context: SwarmFeedRenderContext): string {
  const { colors } = context;
  const from = formatExpertLabel(context, entry.fromExpertId, entry.fromName, entry.fromEmoji);
  const fromStyled = chalk.hex(colors.primary)(from);
  if (entry.toExpertId !== undefined) {
    const to = formatExpertLabel(context, entry.toExpertId);
    const toLabel = entry.tag === 'mention' ? `@${to}` : to;
    const toStyled = chalk.hex(colors.textDim)(toLabel);
    return `${fromStyled}${chalk.hex(colors.textDim)('→')}${toStyled}`;
  }
  if (entry.tag === 'block') {
    return `${fromStyled}${chalk.hex(colors.warning)(' ⚠')}`;
  }
  if (entry.tag === 'mention') {
    return chalk.hex(colors.warning)(`@${fromStyled}`);
  }
  return fromStyled;
}

function formatFeedHeaderPlain(entry: SwarmOpsFeedEntry, context: SwarmFeedRenderContext): string {
  return stripAnsiText(formatFeedHeaderStyled(entry, context));
}

export function renderAgentSwarmConversationFeedEntry(
  entry: SwarmOpsFeedEntry,
  width: number,
  indent: boolean,
  showHeader: boolean,
  profile: ResponsiveLayoutProfile,
  context: SwarmFeedRenderContext,
): string[] {
  const pad = indent ? '  ' : '';
  const innerWidth = Math.max(1, width - visibleWidth(pad));
  const bodyText = resolveAgentSwarmFeedEntryBody(entry, context.showRawFeed);
  const bodyStyled = chalk.hex(context.colors.text)(bodyText);

  if (!showHeader) {
    return [truncateToWidth(`${pad}  ${bodyStyled}`, width)];
  }

  const headerPlain = formatFeedHeaderPlain(entry, context);
  const headerStyled = formatFeedHeaderStyled(entry, context);
  const separator = ': ';
  const combinedWidth = visibleWidth(headerPlain) + visibleWidth(separator) + visibleWidth(bodyText);
  const useTwoLines =
    profile === 'tiny' ||
    innerWidth < SWARM_FEED_NARROW_WIDTH ||
    combinedWidth > innerWidth;

  if (useTwoLines) {
    return [
      truncateToWidth(`${pad}${headerStyled}`, width),
      truncateToWidth(`${pad}  ${bodyStyled}`, width),
    ];
  }

  const bodyWidth = Math.max(
    SWARM_FEED_BODY_MIN_WIDTH,
    Math.floor(innerWidth * SWARM_FEED_BODY_WIDTH_RATIO),
  );
  const headerWidth = Math.max(0, innerWidth - bodyWidth - visibleWidth(separator));
  const header = headerWidth > 0
    ? truncateToWidth(headerStyled, headerWidth)
    : '';
  const body = truncateToWidth(bodyStyled, bodyWidth);
  if (header.length === 0) {
    return [truncateToWidth(`${pad}${body}`, width)];
  }
  return [truncateToWidth(`${pad}${header}${separator}${body}`, width)];
}

export function renderAgentSwarmOpsFeedContent(
  entries: readonly SwarmOpsFeedEntry[],
  width: number,
  maxLines: number,
  indent: boolean,
  profile: ResponsiveLayoutProfile,
  context: SwarmFeedRenderContext,
): string[] {
  const filtered = entries
    .filter((entry) => isConversationFeedTag(entry.tag))
    .slice(-maxLines);
  if (filtered.length === 0) {
    return [
      truncateToWidth(
        chalk.hex(context.colors.textDim)('awaiting team messages…'),
        width,
      ),
    ];
  }

  const lines: string[] = [];
  let previousThreadKey: string | undefined;
  for (const entry of filtered) {
    const threadKey = feedThreadKey(entry);
    const showHeader = threadKey !== previousThreadKey;
    previousThreadKey = threadKey;
    lines.push(
      ...renderAgentSwarmConversationFeedEntry(entry, width, indent, showHeader, profile, context),
    );
  }
  return lines.slice(-maxLines);
}

export function renderAgentSwarmToolFeedEntry(
  entry: SwarmOpsFeedEntry,
  width: number,
  context: SwarmFeedRenderContext,
): string {
  const isFailure = entry.tag === 'fail';
  const { colors } = context;
  const tagStyle = chalk.hex(isFailure ? colors.warning : colors.primary);
  const bodyStyle = chalk.hex(isFailure ? colors.warning : colors.text);
  const source = chalk.hex(colors.textDim)(
    formatExpertLabel(context, entry.fromExpertId, entry.fromName, entry.fromEmoji),
  );
  const glyph = tagStyle(isFailure ? '✗' : '›');
  const separator = chalk.hex(colors.textDim)(':');
  return truncateToWidth(
    `${glyph} ${source}${separator} ${bodyStyle(resolveAgentSwarmFeedEntryBody(entry, context.showRawFeed))}`,
    width,
  );
}

export function renderAgentSwarmToolFeedContent(
  entries: readonly SwarmOpsFeedEntry[],
  width: number,
  maxLines: number,
  context: SwarmFeedRenderContext,
): string[] {
  return entries
    .slice(-maxLines)
    .map((entry) => renderAgentSwarmToolFeedEntry(entry, width, context));
}

/** "LIVE FEED" divider + conversation feed body, as shown in the war-room panel. */
export function renderAgentSwarmOpsFeedSection(
  width: number,
  entries: readonly SwarmOpsFeedEntry[],
  context: SwarmFeedRenderContext,
): string[] {
  const dividerStyle = (text: string): string => chalk.hex(context.colors.primary)(text);
  return [
    '',
    renderRendererLabeledDividerRow({
      width,
      label: chalk.hex(context.colors.accent)('LIVE FEED'),
      dividerStyle,
    }),
    ...renderAgentSwarmOpsFeedContent(
      entries,
      width,
      SWARM_OPS_FEED_RENDER_LINES,
      true,
      resolveResponsiveLayout({ width }),
      context,
    ),
  ];
}

/** "TOOL ACTIVITY" divider + tool feed body, as shown in the war-room panel. */
export function renderAgentSwarmToolFeedSection(
  width: number,
  entries: readonly SwarmOpsFeedEntry[],
  context: SwarmFeedRenderContext,
): string[] {
  if (entries.length === 0) return [];
  const profile = resolveResponsiveLayout({ width });
  const maxLines = profile === 'tiny' ? SWARM_OPS_FEED_RENDER_LINES_TINY : SWARM_OPS_FEED_RENDER_LINES;
  const dividerStyle = (text: string): string => chalk.hex(context.colors.primary)(text);
  return [
    '',
    renderRendererLabeledDividerRow({
      width,
      label: chalk.hex(context.colors.accent)('TOOL ACTIVITY'),
      dividerStyle,
    }),
    ...renderAgentSwarmToolFeedContent(entries, width, maxLines, context),
  ];
}

/** Appends a de-duplicated conversation feed entry, mutating `opsFeed` and `seenMessageIds` in place. */
export function appendAgentSwarmConversationFeedEntry(
  opsFeed: SwarmOpsFeedEntry[],
  seenMessageIds: Set<string>,
  maxEntries: number,
  input: {
    readonly tag: SwarmOpsFeedEntry['tag'];
    readonly messageId?: string;
    readonly fromExpertId?: string;
    readonly fromName?: string;
    readonly fromEmoji?: string;
    readonly toExpertId?: string;
    readonly body: string;
    readonly rawBody?: string;
    readonly atMs: number;
  },
): void {
  const body = collapseWhitespace(input.body);
  if (body.length === 0) return;
  const rawBody = input.rawBody === undefined ? undefined : collapseWhitespace(input.rawBody);
  const storedRawBody =
    rawBody !== undefined && rawBody.length > 0 && rawBody !== body ? rawBody : undefined;
  const messageId = input.messageId?.trim();
  if (messageId !== undefined && messageId.length > 0) {
    if (seenMessageIds.has(messageId)) return;
    seenMessageIds.add(messageId);
    if (seenMessageIds.size > maxEntries * 2) {
      // Bound memory; oldest ids drop first via recreation from recent feed.
      seenMessageIds.clear();
      for (const entry of opsFeed) {
        if (entry.messageId !== undefined) seenMessageIds.add(entry.messageId);
      }
      seenMessageIds.add(messageId);
    }
  }
  const last = opsFeed.at(-1);
  if (
    last !== undefined &&
    last.tag === input.tag &&
    last.fromExpertId === input.fromExpertId &&
    last.fromName === input.fromName &&
    last.toExpertId === input.toExpertId &&
    last.body === body &&
    last.rawBody === storedRawBody
  ) {
    return;
  }
  opsFeed.push({
    atMs: input.atMs,
    tag: input.tag,
    messageId,
    fromExpertId: input.fromExpertId,
    fromName: input.fromName,
    fromEmoji: input.fromEmoji,
    toExpertId: input.toExpertId,
    body,
    rawBody: storedRawBody,
  });
  if (opsFeed.length > maxEntries) {
    opsFeed.splice(0, opsFeed.length - maxEntries);
  }
}

/** Appends a de-duplicated tool-feed entry, mutating `opsToolFeed` in place. */
export function appendAgentSwarmToolFeedEntry(
  opsToolFeed: SwarmOpsFeedEntry[],
  maxEntries: number,
  input: {
    readonly tag: 'tool' | 'fail';
    readonly fromExpertId?: string;
    readonly fromName?: string;
    readonly fromEmoji?: string;
    readonly body: string;
    readonly atMs: number;
  },
): void {
  const body = collapseWhitespace(input.body);
  if (body.length === 0) return;
  const last = opsToolFeed.at(-1);
  if (
    last !== undefined &&
    last.tag === input.tag &&
    last.fromExpertId === input.fromExpertId &&
    last.fromName === input.fromName &&
    last.body === body
  ) {
    return;
  }
  opsToolFeed.push({
    atMs: input.atMs,
    tag: input.tag,
    fromExpertId: input.fromExpertId,
    fromName: input.fromName,
    fromEmoji: input.fromEmoji,
    body,
  });
  if (opsToolFeed.length > maxEntries) {
    opsToolFeed.splice(0, opsToolFeed.length - maxEntries);
  }
}
