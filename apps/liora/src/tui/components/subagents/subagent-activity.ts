import { truncateToWidth, type Component } from '#/tui/renderer';

import { FAILURE_MARK, STATUS_BULLET, SUCCESS_MARK } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPulseText,
  renderSettleFlash,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

/** Tool entries rendered per agent — the live "last N calls" feed. */
const MAX_VISIBLE_TOOL_ENTRIES = 3;
/** Entries tracked per agent so late results can still resolve their call. */
const MAX_TRACKED_TOOL_ENTRIES = 8;
/** Settle-flash window after a tool result lands (motion modes only). */
const SETTLE_FLASH_RECENT_MS = 2_000;

export type SubagentRunPhase = 'active' | 'completed' | 'failed';

export interface SubagentToolCallInput {
  readonly subagentId: string;
  readonly subagentName?: string;
  readonly toolCallId: string;
  readonly name: string;
  readonly argsPreview?: string;
}

export interface SubagentToolResultInput {
  readonly subagentId: string;
  readonly toolCallId: string;
  readonly name?: string;
  readonly isError?: boolean;
}

interface ToolFeedEntry {
  readonly toolCallId: string;
  name: string;
  argsPreview: string | undefined;
  status: 'running' | 'ok' | 'error';
  settledAtMs: number | undefined;
}

interface AgentFeed {
  name: string;
  phase: SubagentRunPhase;
  entries: ToolFeedEntry[];
  settledAtMs: number | undefined;
}

export interface SubagentActivityOptions {
  readonly requestRender?: () => void;
  /** Animation clock override (tests). Defaults to the shared appearance clock. */
  readonly now?: () => number;
}

/**
 * Live per-subagent tool-call feed (Phase 1-A realtime overhaul). Text-level
 * only: each tracked background subagent renders its last few tool calls as
 * `name args-preview` rows with a running spinner mark that settles to ✓/✗
 * when the `subagent.tool_result` event arrives. Motion flows through the
 * shared appearance clock (no raw timers) and degrades to static marks under
 * off / SSH / NO_COLOR / CI, per PREMIUM.md §7.
 */
export class SubagentActivityComponent implements Component {
  private readonly agents = new Map<string, AgentFeed>();

  constructor(private readonly options: SubagentActivityOptions = {}) {}

  get agentCount(): number {
    return this.agents.size;
  }

  recordToolCall(input: SubagentToolCallInput): void {
    const feed = this.ensureFeed(input.subagentId, input.subagentName);
    feed.phase = 'active';
    const existing = feed.entries.find((entry) => entry.toolCallId === input.toolCallId);
    if (existing !== undefined) {
      existing.name = input.name;
      if (input.argsPreview !== undefined) existing.argsPreview = input.argsPreview;
      existing.status = 'running';
      existing.settledAtMs = undefined;
    } else {
      feed.entries.push({
        toolCallId: input.toolCallId,
        name: input.name,
        argsPreview: input.argsPreview,
        status: 'running',
        settledAtMs: undefined,
      });
      if (feed.entries.length > MAX_TRACKED_TOOL_ENTRIES) {
        feed.entries.splice(0, feed.entries.length - MAX_TRACKED_TOOL_ENTRIES);
      }
    }
    this.options.requestRender?.();
  }

  recordToolResult(input: SubagentToolResultInput): void {
    const feed = this.agents.get(input.subagentId);
    if (feed === undefined) return;
    const status = input.isError === true ? 'error' : 'ok';
    const settledAtMs = this.now();
    const existing = feed.entries.find((entry) => entry.toolCallId === input.toolCallId);
    if (existing !== undefined) {
      existing.status = status;
      existing.settledAtMs = settledAtMs;
      if (input.name !== undefined && input.name.length > 0) existing.name = input.name;
    } else {
      feed.entries.push({
        toolCallId: input.toolCallId,
        name: input.name ?? 'tool',
        argsPreview: undefined,
        status,
        settledAtMs,
      });
      if (feed.entries.length > MAX_TRACKED_TOOL_ENTRIES) {
        feed.entries.splice(0, feed.entries.length - MAX_TRACKED_TOOL_ENTRIES);
      }
    }
    this.options.requestRender?.();
  }

  markTerminal(subagentId: string, phase: 'completed' | 'failed'): void {
    const feed = this.agents.get(subagentId);
    if (feed === undefined) return;
    feed.phase = phase;
    feed.settledAtMs = this.now();
    this.options.requestRender?.();
  }

  hasActiveAgents(): boolean {
    for (const feed of this.agents.values()) {
      if (feed.phase === 'active') return true;
    }
    return false;
  }

  /** Drop finished agents; keeps the panel mountable for the next batch. */
  pruneTerminal(): void {
    for (const [id, feed] of this.agents) {
      if (feed.phase !== 'active') this.agents.delete(id);
    }
  }

  reset(): void {
    this.agents.clear();
    this.options.requestRender?.();
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0 || this.agents.size === 0) return [''];

    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const active = this.hasActiveAgents();
    const lines: string[] = [''];

    const headerBullet =
      animated && active
        ? renderPulseText(STATUS_BULLET, 'subagent-activity', 'primary', appearance)
        : currentTheme.fg(active ? 'primary' : 'textDim', STATUS_BULLET);
    lines.push(headerBullet + currentTheme.fg('textDim', 'Subagent activity'));

    for (const [agentId, feed] of this.agents) {
      lines.push(this.renderAgentLine(agentId, feed, animated, appearance));
      const visible = feed.entries.slice(-MAX_VISIBLE_TOOL_ENTRIES);
      for (const entry of visible) {
        lines.push(this.renderToolLine(entry, feed.phase === 'active', animated, appearance));
      }
    }
    return lines.map((line) => truncateToWidth(line, safeWidth, '…'));
  }

  private ensureFeed(subagentId: string, subagentName: string | undefined): AgentFeed {
    const existing = this.agents.get(subagentId);
    if (existing !== undefined) {
      if (subagentName !== undefined && subagentName.length > 0) existing.name = subagentName;
      return existing;
    }
    // A fresh batch starts: clear finished agents from a previous run so the
    // panel does not accumulate stale terminal rows.
    if (!this.hasActiveAgents()) this.agents.clear();
    const feed: AgentFeed = {
      name: subagentName ?? subagentId,
      phase: 'active',
      entries: [],
      settledAtMs: undefined,
    };
    this.agents.set(subagentId, feed);
    return feed;
  }

  private renderAgentLine(
    agentId: string,
    feed: AgentFeed,
    animated: boolean,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): string {
    const indent = '  ';
    let mark: string;
    if (feed.phase === 'active') {
      mark =
        animated
          ? renderPulseText(STATUS_BULLET, `subagent-agent:${agentId}`, 'primary', appearance)
          : currentTheme.fg('primary', STATUS_BULLET);
    } else if (feed.phase === 'completed') {
      mark = currentTheme.fg('success', SUCCESS_MARK);
    } else {
      mark = currentTheme.fg('error', FAILURE_MARK);
    }
    const name =
      feed.phase === 'active'
        ? currentTheme.fg('text', feed.name)
        : currentTheme.fg('textDim', feed.name);
    return indent + mark + name;
  }

  private renderToolLine(
    entry: ToolFeedEntry,
    agentActive: boolean,
    animated: boolean,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): string {
    const indent = '    ';
    const args =
      entry.argsPreview !== undefined && entry.argsPreview.length > 0
        ? currentTheme.fg('textDim', ` ${entry.argsPreview}`)
        : '';
    if (entry.status === 'running') {
      const mark =
        animated && agentActive
          ? renderPulseText('▸ ', `subagent-tool:${entry.toolCallId}`, 'primary', appearance)
          : currentTheme.fg(agentActive ? 'primary' : 'textDim', '▸ ');
      return indent + mark + currentTheme.fg('text', entry.name) + args;
    }
    if (entry.status === 'error') {
      return (
        indent +
        currentTheme.fg('error', '✗ ') +
        currentTheme.fg('error', entry.name) +
        args
      );
    }
    const okMark = currentTheme.fg('success', '✓ ');
    const body = entry.name + (entry.argsPreview !== undefined ? ` ${entry.argsPreview}` : '');
    const recent =
      entry.settledAtMs !== undefined && this.now() - entry.settledAtMs < SETTLE_FLASH_RECENT_MS;
    if (animated && recent && entry.settledAtMs !== undefined) {
      return (
        indent +
        okMark +
        renderSettleFlash(body, `subagent-settle:${entry.toolCallId}`, entry.settledAtMs, appearance)
      );
    }
    return indent + okMark + currentTheme.fg('text', entry.name) + args;
  }

  private now(): number {
    return this.options.now?.() ?? appearanceAnimationNow();
  }
}
