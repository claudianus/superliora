/**
 * Intent Composer — foldable brief slots above the editor (conductor_ux_v2).
 * Slots: success_criteria, must_not_touch, verification_commands, context_paths.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import {
  intentBriefHasFields,
  intentComposerDefaultsForMode,
  intentComposerExpandedByDefault,
  linesFromText,
  type ConductorProjectMode,
  type IntentBriefFields,
} from '#/tui/utils/job/intent-brief';

export type IntentComposerSlot =
  | 'success_criteria'
  | 'must_not_touch'
  | 'verification_commands'
  | 'context_paths';

const SLOTS: readonly IntentComposerSlot[] = [
  'success_criteria',
  'must_not_touch',
  'verification_commands',
  'context_paths',
];

const SLOT_LABEL: Readonly<Record<IntentComposerSlot, string>> = {
  success_criteria: 'Success criteria',
  must_not_touch: 'Must not touch',
  verification_commands: 'Verification',
  context_paths: 'Context paths',
};

export interface IntentComposerOptions {
  readonly projectMode: ConductorProjectMode;
  readonly requestRender?: () => void;
  readonly onBlur?: () => void;
}

export class IntentComposerComponent extends Container implements Focusable {
  focused = false;

  private expanded: boolean;
  private selectedSlot = 0;
  private editing = false;
  private draft = '';
  private fields: {
    success_criteria: string[];
    must_not_touch: string[];
    verification_commands: string[];
    context_paths: string[];
  };

  private readonly opts: IntentComposerOptions;

  constructor(opts: IntentComposerOptions) {
    super();
    this.opts = opts;
    this.expanded = intentComposerExpandedByDefault(opts.projectMode);
    const defaults = intentComposerDefaultsForMode(opts.projectMode);
    this.fields = {
      success_criteria: [...defaults.successCriteria],
      must_not_touch: [...defaults.mustNotTouch],
      verification_commands: [...defaults.verificationCommands],
      context_paths: [...defaults.contextPaths],
    };
  }

  applyProjectMode(mode: ConductorProjectMode): void {
    this.expanded = intentComposerExpandedByDefault(mode);
    if (!intentBriefHasFields(this.getFields())) {
      const defaults = intentComposerDefaultsForMode(mode);
      this.fields = {
        success_criteria: [...defaults.successCriteria],
        must_not_touch: [...defaults.mustNotTouch],
        verification_commands: [...defaults.verificationCommands],
        context_paths: [...defaults.contextPaths],
      };
    }
    this.opts.requestRender?.();
  }

  getFields(): IntentBriefFields {
    return {
      successCriteria: this.fields.success_criteria,
      mustNotTouch: this.fields.must_not_touch,
      verificationCommands: this.fields.verification_commands,
      contextPaths: this.fields.context_paths,
    };
  }

  hasFields(): boolean {
    return intentBriefHasFields(this.getFields());
  }

  /** Clear brief after a successful send (hotfix jobCreate / attached prompt). */
  clearFields(): void {
    this.fields = {
      success_criteria: [],
      must_not_touch: [],
      verification_commands: [],
      context_paths: [],
    };
    this.editing = false;
    this.draft = '';
    this.opts.requestRender?.();
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.opts.requestRender?.();
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  handleInput(data: string): void {
    if (this.editing) {
      this.handleEditInput(data);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (this.expanded) {
        this.expanded = false;
        this.opts.requestRender?.();
        return;
      }
      this.opts.onBlur?.();
      return;
    }
    const ch = printableChar(data);
    if (ch === ' ' || matchesKey(data, Key.enter)) {
      if (!this.expanded) {
        this.expanded = true;
        this.opts.requestRender?.();
        return;
      }
      this.beginEdit();
      return;
    }
    if (ch === 'e' || ch === 'E') {
      this.expanded = !this.expanded;
      this.opts.requestRender?.();
      return;
    }
    if (!this.expanded) return;
    if (matchesKey(data, Key.up) || ch === 'k') {
      this.selectedSlot = Math.max(0, this.selectedSlot - 1);
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.down) || ch === 'j') {
      this.selectedSlot = Math.min(SLOTS.length - 1, this.selectedSlot + 1);
      this.opts.requestRender?.();
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const filled = countFilled(this.fields);
    const head = this.expanded
      ? theme.fg('accent', '▾ Intent brief')
      : theme.fg('accent', '▸ Intent brief');
    const meta = theme.fg(
      'textMuted',
      filled > 0 ? ` · ${String(filled)} slot${filled === 1 ? '' : 's'} · Alt+B` : ' · Alt+B expand',
    );
    const lines = [truncateToWidth(` ${head}${meta}`, Math.max(1, width), '…')];
    if (!this.expanded) return lines;

    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i]!;
      const selected = i === this.selectedSlot;
      const items = this.fields[slot];
      const pointer = selected ? theme.fg('primary', '›') : ' ';
      const label = theme.fg(selected ? 'textStrong' : 'textMuted', SLOT_LABEL[slot]);
      if (this.editing && selected) {
        lines.push(
          truncateToWidth(
            ` ${pointer} ${label}: ${theme.fg('text', this.draft)}█`,
            Math.max(1, width),
            '…',
          ),
        );
        lines.push(theme.fg('textDim', '   Enter save · Esc cancel · ; separates bullets'));
      } else {
        const preview =
          items.length === 0
            ? theme.fg('textDim', '(empty)')
            : theme.fg('text', items.join(' · '));
        lines.push(truncateToWidth(` ${pointer} ${label}: ${preview}`, Math.max(1, width), '…'));
      }
    }
    lines.push(theme.fg('textDim', ' ↑↓ slot · Enter edit · E collapse · Esc back'));
    return lines;
  }

  private beginEdit(): void {
    const slot = SLOTS[this.selectedSlot]!;
    this.editing = true;
    this.draft = this.fields[slot].join('; ');
    this.opts.requestRender?.();
  }

  private handleEditInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.editing = false;
      this.draft = '';
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const slot = SLOTS[this.selectedSlot]!;
      this.fields[slot] = linesFromText(this.draft.replaceAll(';', '\n'));
      this.editing = false;
      this.draft = '';
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      this.draft = this.draft.slice(0, -1);
      this.opts.requestRender?.();
      return;
    }
    const ch = printableChar(data);
    if (ch !== undefined && ch.length === 1) {
      this.draft += ch;
      this.opts.requestRender?.();
    }
  }
}

function countFilled(fields: {
  readonly success_criteria: readonly string[];
  readonly must_not_touch: readonly string[];
  readonly verification_commands: readonly string[];
  readonly context_paths: readonly string[];
}): number {
  let n = 0;
  if (fields.success_criteria.length > 0) n += 1;
  if (fields.must_not_touch.length > 0) n += 1;
  if (fields.verification_commands.length > 0) n += 1;
  if (fields.context_paths.length > 0) n += 1;
  return n;
}
