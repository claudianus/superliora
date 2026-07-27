/**
 * Command Hub — beginner home dashboard (center modal).
 *
 * Status strip + contextual Now + Spotlight search (recency-weighted).
 * Space/Enter toggles modes in place; nested pickers stack with Esc back.
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderEnterBeat,
  renderPremiumHeadline,
  renderPulseText,
  renderSettleFlash,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { hubRecencyScore, listRecentHubActionIds } from '#/tui/utils/hub-recents';
import { printableChar } from '#/tui/utils/printable-key';
import { renderSelectPointer } from '#/tui/utils/select-pointer';

export type CommandHubActionId =
  | 'now.steer'
  | 'now.stop'
  | 'now.undo'
  | 'now.compact'
  | 'start.new'
  | 'start.sessions'
  | 'start.export'
  | 'modes.plan'
  | 'modes.swarm'
  | 'modes.ultrawork'
  | 'modes.premium'
  | 'modes.permission'
  | 'chat.model'
  | 'chat.thinking'
  | 'chat.retry'
  | 'chat.undo'
  | 'chat.compact'
  | 'chat.btw'
  | 'workspace.files'
  | 'workspace.search'
  | 'workspace.diff'
  | 'workspace.log'
  | 'workspace.tasks'
  | 'workspace.status'
  | 'extend.extensions'
  | 'appearance.theme'
  | 'appearance.appearance'
  | 'account.login'
  | 'account.accounts'
  | 'account.upgrade'
  | 'help.shortcuts'
  | 'help.commands';

/** How activation behaves in the Hub. */
export type CommandHubItemKind = 'toggle' | 'cycle' | 'open';

export interface CommandHubItem {
  readonly id: CommandHubActionId;
  readonly section: string;
  readonly label: string;
  readonly description: string;
  /** Optional live badge, e.g. "on" / model name. */
  readonly badge?: string;
  readonly kind?: CommandHubItemKind;
}

export type CommandHubSelectMode = 'enter' | 'space';

export interface CommandHubOptions {
  readonly items: readonly CommandHubItem[];
  readonly onSelect: (item: CommandHubItem, mode: CommandHubSelectMode) => void;
  readonly onCancel: () => void;
  readonly title?: string;
  readonly initialQuery?: string;
  /** First-run coach overlay. */
  readonly intro?: boolean;
  readonly onIntroDismiss?: () => void;
}

const SECTION_ORDER = [
  'Now',
  'Recent',
  'Modes',
  'Start',
  'Chat',
  'Workspace',
  'Extend',
  'Appearance',
  'Account',
  'Help',
] as const;

const PAGE_SIZE = 8;

const TOGGLE_IDS = new Set<CommandHubActionId>([
  'modes.plan',
  'modes.swarm',
  'modes.ultrawork',
  'modes.premium',
]);

export function isCommandHubToggleId(id: CommandHubActionId): boolean {
  return TOGGLE_IDS.has(id);
}

export function isCommandHubCycleId(id: CommandHubActionId): boolean {
  return id === 'modes.permission';
}

/** Keep Hub open for toggles/cycles; nest or navigate for the rest. */
export function commandHubKeepsOpen(id: CommandHubActionId): boolean {
  return isCommandHubToggleId(id) || isCommandHubCycleId(id);
}

/** Nested center-modal pickers — Esc returns to Hub. */
export function commandHubNestsPicker(id: CommandHubActionId): boolean {
  switch (id) {
    case 'start.sessions':
    case 'chat.model':
    case 'chat.thinking':
    case 'modes.permission':
    case 'extend.extensions':
    case 'appearance.theme':
    case 'appearance.appearance':
    case 'help.shortcuts':
    case 'help.commands':
      return true;
    default:
      return false;
  }
}

export function cyclePermissionMode(
  current: string | undefined,
): 'manual' | 'auto' | 'yolo' {
  switch (current) {
    case 'manual':
      return 'auto';
    case 'auto':
      return 'yolo';
    case 'yolo':
      return 'manual';
    default:
      return 'auto';
  }
}

export function buildDefaultCommandHubItems(state: {
  readonly planMode?: boolean;
  readonly swarmMode?: boolean;
  readonly ultraworkMode?: boolean;
  readonly premiumQualityMode?: boolean;
  readonly permissionMode?: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly streamingPhase?: string;
  readonly isCompacting?: boolean;
  /** True when a provider/model is already connected. */
  readonly signedIn?: boolean;
}): CommandHubItem[] {
  const onOff = (on: boolean | undefined): string => (on === true ? 'ON' : 'off');
  const streaming =
    (state.streamingPhase !== undefined && state.streamingPhase !== 'idle') ||
    state.isCompacting === true;
  const items: CommandHubItem[] = [];

  if (streaming) {
    items.push(
      {
        id: 'now.steer',
        section: 'Now',
        label: 'Steer',
        description: 'Close Hub, type guidance, then Ctrl-S',
        kind: 'open',
      },
      {
        id: 'now.stop',
        section: 'Now',
        label: 'Stop turn',
        description: 'Interrupt the agent now',
        kind: 'open',
      },
      {
        id: 'now.undo',
        section: 'Now',
        label: 'Undo last prompt',
        description: 'Withdraw the last user message',
        kind: 'open',
      },
      {
        id: 'now.compact',
        section: 'Now',
        label: 'Compact context',
        description: 'Shrink the working set mid-run',
        kind: 'open',
      },
    );
  }

  items.push(
    {
      id: 'modes.plan',
      section: 'Modes',
      label: 'Plan mode',
      description: 'Space flips · Enter flips & close · think first',
      badge: onOff(state.planMode),
      kind: 'toggle',
    },
    {
      id: 'modes.swarm',
      section: 'Modes',
      label: 'Swarm / team mode',
      description: 'Space flips · Enter flips & close · specialists',
      badge: onOff(state.swarmMode),
      kind: 'toggle',
    },
    {
      id: 'modes.ultrawork',
      section: 'Modes',
      label: 'Ultrawork',
      description: 'Space flips · Enter flips & close · full pipeline',
      badge: onOff(state.ultraworkMode),
      kind: 'toggle',
    },
    {
      id: 'modes.premium',
      section: 'Modes',
      label: 'Premium Quality',
      description: 'Space flips · Enter flips & close · higher effort',
      badge: onOff(state.premiumQualityMode),
      kind: 'toggle',
    },
    {
      id: 'modes.permission',
      section: 'Modes',
      label: 'Permission mode',
      description: 'Space cycles · Enter opens picker',
      badge: state.permissionMode,
      kind: 'cycle',
    },
    {
      id: 'start.new',
      section: 'Start',
      label: 'New session',
      description: 'Start a fresh chat',
    },
    {
      id: 'start.sessions',
      section: 'Start',
      label: 'Resume sessions',
      description: 'Browse and switch sessions',
    },
    {
      id: 'start.export',
      section: 'Start',
      label: 'Export Markdown',
      description: 'Save this chat as a Markdown file',
    },
    {
      id: 'chat.model',
      section: 'Chat',
      label: 'Model',
      description: 'Switch the LLM',
      badge: state.model !== undefined && state.model.length > 0 ? state.model : undefined,
    },
    {
      id: 'chat.thinking',
      section: 'Chat',
      label: 'Thinking effort',
      description: 'How hard the model thinks',
      badge:
        state.thinkingLevel !== undefined && state.thinkingLevel.length > 0
          ? state.thinkingLevel
          : undefined,
    },
    {
      id: 'chat.retry',
      section: 'Chat',
      label: 'Retry last turn',
      description: 'Resend your last message',
    },
  );

  if (!streaming) {
    items.push(
      {
        id: 'chat.undo',
        section: 'Chat',
        label: 'Undo last prompt',
        description: 'Withdraw the last user message',
      },
      {
        id: 'chat.compact',
        section: 'Chat',
        label: 'Compact context',
        description: 'Shrink the working set',
      },
    );
  }

  items.push(
    {
      id: 'chat.btw',
      section: 'Chat',
      label: 'Side question (btw)',
      description: 'Ask a forked side agent',
    },
    {
      id: 'workspace.files',
      section: 'Workspace',
      label: 'Files',
      description: 'Browse the project tree',
    },
    {
      id: 'workspace.search',
      section: 'Workspace',
      label: 'Search project',
      description: 'Find text across files',
    },
    {
      id: 'workspace.diff',
      section: 'Workspace',
      label: 'Diff',
      description: 'Review git changes',
    },
    {
      id: 'workspace.log',
      section: 'Workspace',
      label: 'Commits',
      description: 'Browse git history',
    },
    {
      id: 'workspace.tasks',
      section: 'Workspace',
      label: 'Background tasks',
      description: 'Open the tasks browser',
    },
    {
      id: 'workspace.status',
      section: 'Workspace',
      label: 'Status',
      description: 'Session, usage, quota, tools',
    },
    {
      id: 'extend.extensions',
      section: 'Extend',
      label: 'Extensions',
      description: 'Plugins, hooks, skills, MCP',
    },
    {
      id: 'appearance.theme',
      section: 'Appearance',
      label: 'Theme',
      description: 'Dark, light, or custom',
    },
    {
      id: 'appearance.appearance',
      section: 'Appearance',
      label: 'Appearance',
      description: 'Motion, density, background',
    },
    {
      id: 'account.login',
      section: 'Account',
      label: state.signedIn === true ? 'Add provider' : 'Login',
      description:
        state.signedIn === true ? 'Connect another provider' : 'Connect a provider to start',
      badge: state.signedIn === true ? 'ready' : undefined,
    },
    {
      id: 'account.accounts',
      section: 'Account',
      label: 'Accounts',
      description: 'Manage OAuth account pools',
    },
    {
      id: 'account.upgrade',
      section: 'Account',
      label: 'Upgrade',
      description: 'Check for CLI updates',
    },
    {
      id: 'help.shortcuts',
      section: 'Help',
      label: 'Shortcuts',
      description: 'Keyboard cheatsheet',
    },
    {
      id: 'help.commands',
      section: 'Help',
      label: 'All slash commands',
      description: 'Power-user command list',
    },
  );
  return items;
}

export class CommandHubComponent extends Container implements Focusable {
  focused = false;

  private items: readonly CommandHubItem[];
  private readonly onSelect: (item: CommandHubItem, mode: CommandHubSelectMode) => void;
  private readonly onCancel: () => void;
  private readonly onIntroDismiss: (() => void) | undefined;
  private readonly title: string;
  private filtered: CommandHubItem[];
  private selectedIndex = 0;
  private query = '';
  private intro: boolean;
  private readonly openedAtMs = appearanceAnimationNow();
  private flashId: string | null = null;
  private flashAtMs = 0;

  constructor(opts: CommandHubOptions) {
    super();
    this.items = opts.items;
    this.onSelect = opts.onSelect;
    this.onCancel = opts.onCancel;
    this.onIntroDismiss = opts.onIntroDismiss;
    this.title = opts.title ?? 'Command Hub';
    this.query = opts.initialQuery ?? '';
    this.intro = opts.intro === true;
    this.filtered = filterHubItems(this.items, this.query);
  }

  /** Live-refresh badges / Now section while Hub stays open. */
  setItems(items: readonly CommandHubItem[]): void {
    const selectedId = this.filtered[this.selectedIndex]?.id;
    this.items = items;
    this.filtered = filterHubItems(this.items, this.query);
    if (selectedId !== undefined) {
      const next = this.filtered.findIndex((item) => item.id === selectedId);
      this.selectedIndex = next === -1 ? 0 : next;
    } else {
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    }
    this.invalidate();
  }

  /** Trigger settle-flash on a toggled row. */
  noteToggleFlash(id: CommandHubActionId): void {
    this.flashId = id;
    this.flashAtMs = appearanceAnimationNow();
    this.invalidate();
  }

  dismissIntro(): void {
    if (!this.intro) return;
    this.intro = false;
    this.onIntroDismiss?.();
    this.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      if (this.intro) {
        this.dismissIntro();
        return;
      }
      // Two-stage Esc: clear filter first, then close (searchable dialog convention).
      if (this.query.length > 0) {
        this.query = '';
        this.refilter();
        return;
      }
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.activate('enter');
      return;
    }
    if (matchesKey(data, Key.space) || printableChar(data) === ' ') {
      this.activate('space');
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) {
      this.selectedIndex = Math.min(this.filtered.length - 1, this.selectedIndex + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - PAGE_SIZE);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(this.filtered.length - 1, this.selectedIndex + PAGE_SIZE);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.selectedIndex = 0;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.selectedIndex = Math.max(0, this.filtered.length - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.refilter();
      }
      return;
    }
    const ch = printableChar(data);
    if (ch !== undefined && ch.length > 0 && ch !== ' ') {
      // Empty filter: 1–9 is a hotkey (activate that row). Typing starts search.
      if (this.query.length === 0 && ch >= '1' && ch <= '9') {
        const index = Number(ch) - 1;
        if (this.filtered[index] !== undefined) {
          this.selectedIndex = index;
          this.activate('enter');
        }
        return;
      }
      if (this.intro) this.dismissIntro();
      this.query += ch;
      this.refilter();
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const appearance = getActiveAppearancePreferences();
    const ambient = shouldRenderAmbientEffects(appearance);
    const hint =
      this.query.length > 0
        ? `filter: ${this.query} · Esc clear`
        : '↑↓ · Space flip · Enter go · 1-9 · type · Esc';
    const body: string[] = [];

    // Enter-beat only (rail lives inside the beat) — avoid a permanent second rail.
    if (ambient) {
      const beat = renderEnterBeat(this.title, width - 2, 'command-hub', this.openedAtMs, appearance);
      for (const line of beat) {
        body.push(truncateToWidth(`  ${line}`, width));
      }
    }

    body.push(truncateToWidth(`  ${this.renderStatusStrip(width - 4)}`, width));
    body.push('');

    if (this.intro) {
      body.push(
        truncateToWidth(
          `  ${renderPulseText('Your home base — flip a mode, then type', 'hub:intro', 'accent', appearance)}`,
          width,
        ),
      );
      body.push(theme.fg('textMuted', '  Space stays here · Enter applies & returns · Esc dismiss'));
      body.push('');
    }

    if (this.filtered.length === 0) {
      body.push(theme.fg('textMuted', '  No matches. Esc clears the filter.'));
    } else {
      let lastSection = '';
      const showHotkeys = this.query.length === 0;
      for (let index = 0; index < this.filtered.length; index += 1) {
        const item = this.filtered[index]!;
        if (item.section !== lastSection) {
          lastSection = item.section;
          const sectionLabel =
            item.section === 'Now' || item.section === 'Recent'
              ? renderPulseText(item.section, `hub:sec:${item.section}`, 'accent', appearance)
              : theme.boldFg('accent', item.section);
          body.push(truncateToWidth(`  ${sectionLabel}`, width));
        }
        const selected = index === this.selectedIndex;
        const pointer = selected ? renderSelectPointer('command-hub') : ' ';
        const hotkey =
          showHotkeys && index < 9
            ? theme.fg('textMuted', `${String(index + 1)} `)
            : showHotkeys
              ? '  '
              : '';
        const badge = this.renderBadge(item, appearance);
        const label = selected
          ? theme.boldFg('primary', item.label)
          : theme.fg('text', item.label);
        const kindHint =
          item.kind === 'toggle' || item.kind === 'cycle'
            ? theme.fg('textMuted', item.kind === 'cycle' ? ' ↻' : ' ⚡')
            : '';
        const desc = theme.fg('textMuted', `  ${item.description}`);
        body.push(truncateToWidth(` ${pointer}${hotkey}${label}${kindHint}${badge}`, width));
        if (selected) body.push(truncateToWidth(desc, width));
      }
    }

    return renderRendererPanelChromeRows({
      width,
      title: ` ${this.title}`,
      hint: ` ${hint}`,
      body,
      dividerStyle: (text) => theme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'command-hub:title'),
      hintStyle: (text) => theme.fg('textMuted', text),
    });
  }

  private activate(mode: CommandHubSelectMode): void {
    const item = this.filtered[this.selectedIndex];
    if (item === undefined) return;
    if (this.intro) this.dismissIntro();
    // Space on open rows = open (same as Enter). Silent no-op felt broken.
    this.onSelect(item, mode);
  }

  private renderStatusStrip(width: number): string {
    const theme = currentTheme;
    const appearance = getActiveAppearancePreferences();
    const chips: string[] = [];
    const push = (label: string, on: boolean): void => {
      const text = on ? label.toUpperCase() : label;
      chips.push(
        on
          ? renderPulseText(`[${text}]`, `hub:chip:${label}`, 'glow', appearance)
          : theme.fg('textMuted', `[${text}]`),
      );
    };
    const plan = this.items.find((i) => i.id === 'modes.plan');
    const swarm = this.items.find((i) => i.id === 'modes.swarm');
    const ultra = this.items.find((i) => i.id === 'modes.ultrawork');
    const premium = this.items.find((i) => i.id === 'modes.premium');
    const perm = this.items.find((i) => i.id === 'modes.permission');
    push('plan', plan?.badge === 'ON');
    push('swarm', swarm?.badge === 'ON');
    push('ultra', ultra?.badge === 'ON');
    push('pq', premium?.badge === 'ON');
    const permBadge = perm?.badge ?? '—';
    chips.push(
      renderPulseText(`[${permBadge}]`, 'hub:chip:perm', 'primary', appearance),
    );
    return truncateToWidth(chips.join(' '), Math.max(8, width));
  }

  private renderBadge(
    item: CommandHubItem,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): string {
    if (item.badge === undefined || item.badge.length === 0) return '';
    const raw = ` · ${item.badge}`;
    if (this.flashId === item.id) {
      return renderSettleFlash(raw, `hub:flash:${item.id}`, this.flashAtMs, appearance);
    }
    if (item.badge === 'ON') {
      return ` ${renderPulseText(raw.trimStart(), `hub:badge:${item.id}`, 'glow', appearance)}`;
    }
    return currentTheme.fg('textMuted', raw);
  }

  private refilter(): void {
    this.filtered = filterHubItems(this.items, this.query);
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    this.invalidate();
  }
}

function filterHubItems(items: readonly CommandHubItem[], query: string): CommandHubItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length > 0) {
    const matched = items.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        item.section.toLowerCase().includes(needle) ||
        item.id.toLowerCase().includes(needle),
    );
    matched.sort((a, b) => {
      const ra = hubRecencyScore(a.id);
      const rb = hubRecencyScore(b.id);
      if (ra !== rb) return rb - ra;
      const aStarts = a.label.toLowerCase().startsWith(needle) ? 1 : 0;
      const bStarts = b.label.toLowerCase().startsWith(needle) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      return a.label.localeCompare(b.label);
    });
    return matched;
  }

  // Idle: pin a Recent strip (deduped), then keep authoring order within sections.
  const byId = new Map(items.map((item) => [item.id, item]));
  const authoredIndex = new Map(items.map((item, index) => [item.id, index]));
  const recent: CommandHubItem[] = [];
  for (const id of listRecentHubActionIds()) {
    if (recent.length >= 3) break;
    const src = byId.get(id as CommandHubActionId);
    if (src === undefined) continue;
    // Skip mode toggles in Recent — they already live in the status strip / Modes.
    if (src.kind === 'toggle' || src.kind === 'cycle') continue;
    recent.push({ ...src, section: 'Recent' });
  }
  const recentIds = new Set(recent.map((item) => item.id));
  const rest = items
    .filter((item) => !recentIds.has(item.id))
    .sort((a, b) => {
      const sa = SECTION_ORDER.indexOf(a.section as (typeof SECTION_ORDER)[number]);
      const sb = SECTION_ORDER.indexOf(b.section as (typeof SECTION_ORDER)[number]);
      const oa = sa === -1 ? 99 : sa;
      const ob = sb === -1 ? 99 : sb;
      if (oa !== ob) return oa - ob;
      return (authoredIndex.get(a.id) ?? 0) - (authoredIndex.get(b.id) ?? 0);
    });
  return [...recent, ...rest];
}
