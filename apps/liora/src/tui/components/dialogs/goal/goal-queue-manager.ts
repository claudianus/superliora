import {Container, Key, matchesKey, renderRendererFrameRows, renderRendererPanelChromeRows, truncateToWidth, visibleWidth, type Focusable} from '#/tui/renderer';
import chalk from 'chalk';

import {renderSelectPointer} from '#/tui/utils/ui/select-pointer';
import type {
  GoalQueueMoveDirection,
  GoalQueueSnapshot,
  UpcomingGoal,
} from '#/tui/goal-queue-store';
import {currentTheme} from '#/tui/theme';
import {renderPremiumHeadline} from '#/tui/features/appearance/appearance-effects';
import {printableChar} from '#/tui/utils/printable-key';
import { MultilineGoalInput } from './goal-queue-edit-input';
import {SearchableList} from '#/tui/utils/ui/searchable-list';

const MAX_GOAL_OBJECTIVE_LENGTH = 4000;
const ELLIPSIS = '…';

export type GoalQueueManagerAction =
  | {
      readonly kind: 'move';
      readonly goalId: string;
      readonly direction: GoalQueueMoveDirection;
    }
  | { readonly kind: 'edit'; readonly goalId: string }
  | { readonly kind: 'delete'; readonly goalId: string };

export interface GoalQueueManagerOptions {
  readonly goals: readonly UpcomingGoal[];
  readonly selectedGoalId?: string;
  readonly pageSize?: number;
  readonly onAction: (
    action: GoalQueueManagerAction,
  ) => GoalQueueSnapshot | void | Promise<GoalQueueSnapshot | void>;
  readonly onCancel: () => void;
}

export type GoalQueueEditResult =
  | { readonly kind: 'save'; readonly goalId: string; readonly objective: string }
  | { readonly kind: 'cancel'; readonly goalId: string };

export interface GoalQueueEditDialogOptions {
  readonly goal: UpcomingGoal;
  readonly onDone: (result: GoalQueueEditResult) => void;
}

export class GoalQueueManagerComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: GoalQueueManagerOptions;
  private goals: readonly UpcomingGoal[];
  private list: SearchableList<UpcomingGoal>;
  private movingGoalId: string | undefined;
  private busy = false;

  constructor(opts: GoalQueueManagerOptions) {
    super();
    this.opts = opts;
    this.goals = opts.goals;
    this.list = this.createList(opts.selectedGoalId);
  }

  handleInput(data: string): void {
    if (this.busy) return;
    if (matchesKey(data, Key.escape)) {
      this.opts.onCancel();
      return;
    }

    const selected = this.selectedGoal();
    const decoded = printableChar(data);
    if (matchesKey(data, Key.space) || decoded === ' ') {
      this.movingGoalId = this.movingGoalId === selected?.id ? undefined : selected?.id;
      return;
    }

    if ((decoded === 'e' || decoded === 'E') && selected !== undefined) {
      void this.opts.onAction({ kind: 'edit', goalId: selected.id });
      return;
    }

    if ((decoded === 'd' || decoded === 'D') && selected !== undefined) {
      void this.applyQueueAction({ kind: 'delete', goalId: selected.id });
      return;
    }

    if (this.movingGoalId !== undefined) {
      if (matchesKey(data, Key.up)) {
        void this.applyQueueAction({ kind: 'move', goalId: this.movingGoalId, direction: 'up' });
        return;
      }
      if (matchesKey(data, Key.down)) {
        void this.applyQueueAction({ kind: 'move', goalId: this.movingGoalId, direction: 'down' });
        return;
      }
    }

    if (this.list.handleKey(data)) return;
  }

  override render(width: number): string[] {
    const view = this.list.view();
    const hint = this.movingGoalId === undefined
      ? '↑↓ navigate · Space select · E edit · D delete · Esc cancel'
      : '↑↓ reorder · Space done · E edit · D delete · Esc cancel';
    const body: string[] = [];
    const footer: string[] = [];

    if (this.goals.length === 0) {
      body.push(currentTheme.fg('textMuted', '  No upcoming goals.'));
    } else {
      for (let i = view.page.start; i < view.page.end; i++) {
        const goal = view.items[i];
        if (goal === undefined) continue;
        body.push(this.renderGoal(goal, i, i === view.selectedIndex, width));
      }

      const below = view.items.length - view.page.end;
      if (below > 0) {
        footer.push(currentTheme.fg('textMuted', ` ▼ ${String(below)} more`));
        footer.push('');
      }
    }

    return renderRendererPanelChromeRows({
      width,
      title: ' Upcoming goals',
      hint: ` ${hint}`,
      body,
      dividerStyle: (text) => currentTheme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'goal-queue:title'),
      hintStyle: (text) => currentTheme.fg('textMuted', text),
      ellipsis: ELLIPSIS,
    });
  }

  private renderGoal(goal: UpcomingGoal, index: number, selected: boolean, width: number): string {
    const moving = goal.id === this.movingGoalId;
    const pointer = selected ? renderSelectPointer('goal-queue:pointer') : ' ';
    const tone = selected ? 'primary' : 'textDim';
    // Pointer is already ambient-styled; do not wrap it in chalk again.
    const prefix = currentTheme.fg(tone, '  ') + pointer + currentTheme.fg(tone, ' ');
    const labelPrefix = `${String(index + 1)}. `;
    const stateLabel = moving ? '  selected' : '';
    const labelWidth = visibleWidth(labelPrefix);
    const stateWidth = visibleWidth(stateLabel);
    const objectiveWidth = Math.max(1, width - 5 - labelWidth - stateWidth);
    const objective = truncateToWidth(
      formatListObjective(goal.objective),
      objectiveWidth,
      ELLIPSIS,
    );
    const textStyle = selected
      ? (text: string) => currentTheme.boldFg('primary', text)
      : (text: string) => currentTheme.fg('text', text);
    let line = prefix + textStyle(labelPrefix + objective);
    if (moving) line += currentTheme.fg('success', stateLabel);
    return line;
  }

  private selectedGoal(): UpcomingGoal | undefined {
    return this.list.selected();
  }

  private async applyQueueAction(action: Exclude<GoalQueueManagerAction, { kind: 'edit' }>) {
    this.busy = true;
    try {
      const result = await this.opts.onAction(action);
      if (result !== undefined) {
        const selectedGoalId = action.kind === 'delete' ? undefined : action.goalId;
        this.goals = result.goals;
        if (!this.goals.some((goal) => goal.id === this.movingGoalId)) {
          this.movingGoalId = undefined;
        }
        this.list = this.createList(selectedGoalId ?? this.movingGoalId);
      }
    } finally {
      this.busy = false;
      this.invalidate();
    }
  }

  private createList(selectedGoalId?: string): SearchableList<UpcomingGoal> {
    const initialIndex = this.goals.findIndex((goal) => goal.id === selectedGoalId);
    return new SearchableList({
      items: this.goals,
      toSearchText: (goal) => goal.objective,
      pageSize: this.opts.pageSize,
      initialIndex: initialIndex === -1 ? 0 : initialIndex,
      searchable: false,
    });
  }
}

export class GoalQueueEditDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly input = new MultilineGoalInput();
  private readonly opts: GoalQueueEditDialogOptions;
  private done = false;
  private error: string | undefined;

  constructor(opts: GoalQueueEditDialogOptions) {
    super();
    this.opts = opts;
    this.input.setValue(opts.goal.objective);
    this.input.onSubmit = (value) => {
      this.submit(value);
    };
  }

  handleInput(data: string): void {
    if (this.done) return;
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl('c')) ||
      matchesKey(data, Key.ctrl('d'))
    ) {
      this.done = true;
      this.opts.onDone({ kind: 'cancel', goalId: this.opts.goal.id });
      return;
    }
    this.error = undefined;
    this.input.handleInput(data);
  }

  override invalidate(): void {
    super.invalidate();
    this.input.invalidate();
  }

  override render(width: number): string[] {
    this.input.focused = this.focused && !this.done;

    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    const innerWidth = Math.max(1, safeWidth - 4);
    const border = (s: string): string => currentTheme.fg('primary', s);
    const title = truncateToWidth(
      currentTheme.boldFg('textStrong', 'Edit upcoming goal'),
      innerWidth,
      ELLIPSIS,
    );
    const subtitle = truncateToWidth(
      currentTheme.fg(
        this.error === undefined ? 'textDim' : 'warning',
        this.error ?? 'Update the queued objective.',
      ),
      innerWidth,
      ELLIPSIS,
    );
    const inputLines = this.input.render(innerWidth);
    const footer = truncateToWidth(
      currentTheme.fg('textDim', 'Enter submit · Shift-Enter/Ctrl-J newline · Esc cancel'),
      innerWidth,
      ELLIPSIS,
    );
    const contentLines = [title, '', subtitle, '', ...inputLines, '', footer];
    if (safeWidth < 4) {
      return ['', ...contentLines.map((line) => truncateToWidth(line, safeWidth, ELLIPSIS))];
    }

    return [
      '',
      ...renderRendererFrameRows({
        content: ['', ...contentLines, ''],
        width: safeWidth,
        height: contentLines.length + 4,
        borderKind: 'rounded',
        paddingLeft: 2,
        paddingRight: 0,
        borderStyle: border,
        ellipsis: ELLIPSIS,
      }),
      '',
    ];
  }

  private submit(value: string): void {
    const objective = value.trim();
    if (objective.length === 0) {
      this.error = 'Goal objective cannot be empty.';
      return;
    }
    if (objective.length > MAX_GOAL_OBJECTIVE_LENGTH) {
      this.error = `Goal objective cannot exceed ${MAX_GOAL_OBJECTIVE_LENGTH} characters.`;
      return;
    }
    this.opts.onDone({ kind: 'save', goalId: this.opts.goal.id, objective });
  }
}


function formatListObjective(objective: string): string {
  return objective.replaceAll(/\s+/g, ' ').trim();
}
