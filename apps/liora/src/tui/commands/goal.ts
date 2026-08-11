import {
  ErrorCodes,
  isKimiError,
  type GoalSnapshot,
  type PermissionMode,
} from '@superliora/sdk';

import {
  GoalStartPermissionPromptComponent,
  type GoalStartPermissionChoice,
} from '../components/dialogs/goal/goal-start-permission-prompt';
import {
  GoalQueueEditDialogComponent,
  GoalQueueManagerComponent,
  type GoalQueueEditResult,
  type GoalQueueManagerAction,
} from '../components/dialogs/goal/goal-queue-manager';
import {
  GoalSetMessageComponent,
  GoalStatusMessageComponent,
  UpcomingGoalAddedMessageComponent,
} from '../components/messages/goal/goal-panel';
import {  LLM_NOT_SET_MESSAGE } from '../constant/liora-tui';
import { requestTUILayoutRender } from '../utils/render/frame-render';
import {
  appendGoalQueueItem,
  moveGoalQueueItem,
  readGoalQueue,
  removeGoalQueueItem,
  updateGoalQueueItem,
  type GoalQueueSnapshot,
} from '../goal-queue-store';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './hub/dispatch';
import { ttui } from '../utils/tui-i18n';

const MAX_GOAL_OBJECTIVE_LENGTH = 4000;
const RESUME_GOAL_INPUT =
  'Continue from where you left off. Resume the active goal without redoing completed work.';
const START_NEXT_GOAL_NOW_MESSAGE = 'No active goal. Starting this goal now.';

interface GoalInputSender {
  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void;
}

type GoalCommandHost = Pick<
  SlashCommandHost,
  | 'state'
  | 'session'
  | 'requireSession'
  | 'setAppState'
  | 'showError'
  | 'showStatus'
  | 'showNotice'
  | 'track'
  | 'mountEditorReplacement'
  | 'restoreEditor'
  | 'restoreInputText'
> &
  GoalInputSender;

export interface GoalStartOptions {
  readonly beforeSend?: () => boolean | Promise<boolean>;
  readonly sendInput?: (objective: string) => void;
  /**
   * When true, skip the interactive Auto/YOLO/Manual chooser and start with the
   * current session permission mode. Used by queued-goal promotion and other
   * non-interactive starters that already have a mode.
   */
  readonly skipPermissionPrompt?: boolean;
}

export type ParsedGoalCommand =
  | { readonly kind: 'status' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'cancel' }
  | {
      readonly kind: 'create';
      readonly objective: string;
      readonly replace: boolean;
      /** Shell gate for completion (Prime `--autonomous-gate` / CreateGoal.gateCommand). */
      readonly gateCommand?: string;
    }
  | { readonly kind: 'next-add'; readonly objective: string }
  | { readonly kind: 'next-manage' }
  | { readonly kind: 'error'; readonly message: string; readonly severity?: 'error' | 'hint' };

const CONTROL_SUBCOMMANDS = new Set(['pause', 'resume', 'cancel']);

/**
 * Parses the deterministic `/goal` command grammar. Reserved subcommands
 * (`pause`/`resume`/`cancel`/`status`/`replace`) are only honored as the first
 * token; use `/goal -- <objective>` to start a goal whose text begins with one
 * of those words. (`cancel` is the single discard action — it removes the
 * current goal.) Optional `--gate <cmd>` (quoted or single token) sets the
 * completion shell gate. Stop conditions may also be expressed in the objective
 * in natural language; the model honors them when it self-audits each turn and
 * reports `complete`/`blocked` via UpdateGoal.
 */
export function parseGoalCommand(rawArgs: string): ParsedGoalCommand {
  const args = rawArgs.trim();
  if (args.length === 0 || args === 'status') return { kind: 'status' };

  const tokens = args.split(/\s+/);
  const first = tokens[0];
  if (first === 'next') {
    return parseNextGoalCommand(tokens);
  }
  if (first !== undefined && CONTROL_SUBCOMMANDS.has(first) && tokens.length === 1) {
    return { kind: first as 'pause' | 'resume' | 'cancel' };
  }

  const gated = extractGateFromRaw(args);
  if (gated.error !== undefined) {
    return { kind: 'error', message: gated.error };
  }

  const bodyTokens = gated.rest.trim().split(/\s+/).filter((t) => t.length > 0);
  let index = 0;
  let replace = false;
  if (bodyTokens[index] === 'replace') {
    replace = true;
    index += 1;
  }
  // `--` ends subcommand parsing so an objective can begin with a reserved word
  // (e.g. `/goal -- pause the rollout`). Bare `--` is not `--gate`.
  if (bodyTokens[index] === '--') {
    index += 1;
  }

  const objective = bodyTokens.slice(index).join(' ').trim();
  if (objective.length === 0) {
    // A usage hint, not a failure — shown in the same calm style as the other
    // "nothing to act on" messages (no goal to pause/resume/cancel).
    return {
      kind: 'error',
      severity: 'hint',
      message:
        'Provide a goal objective, e.g. `/goal Ship feature X` or `/goal --gate "pnpm test" Ship feature X`.',
    };
  }
  if (objective.length > MAX_GOAL_OBJECTIVE_LENGTH) {
    return {
      kind: 'error',
      message: `Goal objective is too long (max ${MAX_GOAL_OBJECTIVE_LENGTH} characters). Reference long details by file path.`,
    };
  }
  return {
    kind: 'create',
    objective,
    replace,
    ...(gated.gateCommand !== undefined ? { gateCommand: gated.gateCommand } : {}),
  };
}

/**
 * Pull one `--gate <cmd>` / `--gate=<cmd>` from the raw args (supports quotes).
 * Removes the matched span so objective parsing stays whitespace-token based.
 */
function extractGateFromRaw(raw: string): {
  readonly rest: string;
  readonly gateCommand?: string;
  readonly error?: string;
} {
  const pattern =
    /(?:^|\s)--gate(?:=|\s+)(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let match: RegExpExecArray | null;
  let gateCommand: string | undefined;
  let rest = raw;
  while ((match = pattern.exec(raw)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (value.length === 0) {
      return { rest: raw, error: '`--gate` command cannot be empty.' };
    }
    if (gateCommand !== undefined) {
      return { rest: raw, error: 'Only one `--gate` is allowed.' };
    }
    gateCommand = value;
    const start = match.index;
    const end = match.index + match[0].length;
    rest = `${raw.slice(0, start)}${raw.slice(end)}`.replace(/\s+/g, ' ').trim();
  }
  // Bare `--gate` with nothing after.
  if (/(?:^|\s)--gate\s*$/.test(raw) || /(?:^|\s)--gate=\s*$/.test(raw)) {
    return {
      rest: raw,
      error: '`--gate` needs a command, e.g. `/goal --gate "pnpm test" Ship feature X`.',
    };
  }
  return { rest, ...(gateCommand !== undefined ? { gateCommand } : {}) };
}

export async function handleGoalCommand(host: SlashCommandHost, args: string): Promise<void> {
  const parsed = parseGoalCommand(args);
  switch (parsed.kind) {
    case 'error':
      if (parsed.severity === 'hint') host.showStatus(parsed.message);
      else host.showError(parsed.message);
      return;
    case 'status':
      await showGoalStatus(host);
      return;
    case 'pause':
      await pauseGoal(host);
      return;
    case 'resume':
      await resumeGoal(host);
      return;
    case 'cancel':
      await cancelGoal(host);
      return;
    case 'next-add':
      await queueNextGoal(host, parsed);
      return;
    case 'next-manage':
      await showGoalQueueManager(host);
      return;
    case 'create':
      await createGoal(host, parsed, args);
      return;
  }
}

function parseNextGoalCommand(tokens: readonly string[]): ParsedGoalCommand {
  if (tokens.length === 2 && tokens[1] === 'manage') return { kind: 'next-manage' };
  let index = 1;
  if (tokens[index] === '--') index += 1;
  const objective = tokens.slice(index).join(' ').trim();
  if (objective.length === 0) {
    return {
      kind: 'error',
      severity: 'hint',
      message:
        'Provide an upcoming goal objective, e.g. `/goal next Ship feature X`, or use `/goal next manage`.',
    };
  }
  if (objective.length > MAX_GOAL_OBJECTIVE_LENGTH) {
    return {
      kind: 'error',
      message: `Goal objective is too long (max ${MAX_GOAL_OBJECTIVE_LENGTH} characters). Reference long details by file path.`,
    };
  }
  return { kind: 'next-add', objective };
}

async function queueNextGoal(
  host: SlashCommandHost,
  parsed: Extract<ParsedGoalCommand, { kind: 'next-add' }>,
): Promise<void> {
  const session = host.requireSession();
  let hasCurrentGoal: boolean;
  try {
    const { goal } = await session.getGoal();
    hasCurrentGoal = goal !== null;
  } catch (error) {
    host.showError(ttui('tui.goal.inspectFailed', { message: formatErrorMessage(error) }));
    return;
  }

  if (!hasCurrentGoal && !isBusy(host)) {
    host.showStatus(START_NEXT_GOAL_NOW_MESSAGE);
    await createGoal(
      host,
      { kind: 'create', objective: parsed.objective, replace: false },
      `next ${parsed.objective}`,
    );
    return;
  }

  try {
    await appendGoalQueueItem(session, { objective: parsed.objective });
  } catch (error) {
    host.showError(formatErrorMessage(error));
    return;
  }
  host.track('goal_queue_append');
  if (!hasCurrentGoal) host.requestQueuedGoalPromotion?.();
  host.state.transcriptContainer.addChild(
    new UpcomingGoalAddedMessageComponent(),
  );
  requestTUILayoutRender(host.state);
}

async function showGoalQueueManager(
  host: SlashCommandHost,
  selectedGoalId?: string,
): Promise<void> {
  let snapshot: GoalQueueSnapshot;
  try {
    snapshot = await readGoalQueue(host.requireSession());
  } catch (error) {
    host.showError(ttui('tui.goal.loadUpcomingFailed', { message: formatErrorMessage(error) }));
    return;
  }

  host.track('goal_queue_manage');
  host.mountEditorReplacement(
    new GoalQueueManagerComponent({
      goals: snapshot.goals,
      selectedGoalId,
      onAction: async (action) => {
        try {
          return await handleGoalQueueManagerAction(host, action);
        } catch (error) {
          host.showError(ttui('tui.goal.updateUpcomingFailed', { message: formatErrorMessage(error) }));
          return undefined;
        }
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function handleGoalQueueManagerAction(
  host: SlashCommandHost,
  action: GoalQueueManagerAction,
): Promise<GoalQueueSnapshot | void> {
  const session = host.requireSession();
  switch (action.kind) {
    case 'move': {
      const snapshot = await moveGoalQueueItem(session, {
        goalId: action.goalId,
        direction: action.direction,
      });
      host.track('goal_queue_move', { direction: action.direction });
      return snapshot;
    }
    case 'delete': {
      const snapshot = await removeGoalQueueItem(session, { goalId: action.goalId });
      host.track('goal_queue_remove');
      return snapshot;
    }
    case 'edit':
      await showGoalQueueEditDialog(host, action.goalId);
      return;
  }
}

async function showGoalQueueEditDialog(
  host: SlashCommandHost,
  goalId: string,
): Promise<void> {
  let snapshot: GoalQueueSnapshot;
  try {
    snapshot = await readGoalQueue(host.requireSession());
  } catch (error) {
    host.showError(ttui('tui.goal.loadUpcomingFailed', { message: formatErrorMessage(error) }));
    return;
  }

  const goal = snapshot.goals.find((item) => item.id === goalId);
  if (goal === undefined) {
    host.showStatus(ttui('tui.goal.queuedGone'));
    await showGoalQueueManager(host);
    return;
  }

  host.mountEditorReplacement(
    new GoalQueueEditDialogComponent({
      goal,
      onDone: (result) => {
        void handleGoalQueueEditResult(host, result).catch((error: unknown) => {
          host.showError(ttui('tui.goal.updateGoalFailed', { message: formatErrorMessage(error) }));
        });
      },
    }),
  );
}

async function handleGoalQueueEditResult(
  host: SlashCommandHost,
  result: GoalQueueEditResult,
): Promise<void> {
  if (result.kind === 'cancel') {
    await showGoalQueueManager(host, result.goalId);
    return;
  }

  await updateGoalQueueItem(host.requireSession(), {
    goalId: result.goalId,
    objective: result.objective,
  });
  host.track('goal_queue_update');
  await showGoalQueueManager(host, result.goalId);
}

export async function createGoal(
  host: GoalCommandHost,
  parsed: Extract<ParsedGoalCommand, { kind: 'create' }>,
  rawArgs?: string,
  options: GoalStartOptions = {},
): Promise<boolean> {
  // A goal must be able to start a model turn; refuse to create one otherwise.
  if (host.state.appState.model.trim().length === 0 || host.session === undefined) {
    host.showError(LLM_NOT_SET_MESSAGE());
    return false;
  }

  // Interactive /goal create always mounts the interview-mode chooser.
  // Programmatic starters (queued promotion) pass skipPermissionPrompt.
  if (options.skipPermissionPrompt === true) {
    return startGoal(host, parsed, options);
  }
  showGoalStartPermissionPrompt(host, parsed, rawArgs ?? parsed.objective, options);
  return false;
}

function showGoalStartPermissionPrompt(
  host: GoalCommandHost,
  parsed: Extract<ParsedGoalCommand, { kind: 'create' }>,
  rawArgs: string,
  options: GoalStartOptions,
): void {
  const commandText = `/goal ${rawArgs.trim()}`;
  const cancelStart = (): void => {
    host.restoreInputText(commandText);
    host.showStatus(ttui('tui.goal.notStarted'));
  };
  host.mountEditorReplacement(
    new GoalStartPermissionPromptComponent({
      // Always present the Manual-first choice set (not YOLO-keep framing).
      mode: 'manual',
      onSelect: (choice) => {
        if (choice === 'cancel') {
          cancelStart();
          return;
        }
        host.restoreEditor();
        void startGoalWithPermission(host, parsed, choice, options);
      },
      onCancel: cancelStart,
    }),
  );
}

async function startGoalWithPermission(
  host: GoalCommandHost,
  parsed: Extract<ParsedGoalCommand, { kind: 'create' }>,
  choice: GoalStartPermissionChoice,
  options: GoalStartOptions,
): Promise<void> {
  // Always apply the chosen mode, including Manual when prior was auto/yolo.
  if (choice === 'auto' || choice === 'yolo' || choice === 'manual') {
    if (!(await setPermissionForGoal(host, choice))) return;
  }
  await startGoal(host, parsed, options);
}

async function setPermissionForGoal(host: GoalCommandHost, mode: PermissionMode): Promise<boolean> {
  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    host.showError(ttui('tui.goal.permissionFailed', { message: formatErrorMessage(error) }));
    return false;
  }
  host.setAppState({ permissionMode: mode });
  return true;
}

async function startGoal(
  host: GoalCommandHost,
  parsed: Extract<ParsedGoalCommand, { kind: 'create' }>,
  options: GoalStartOptions,
): Promise<boolean> {
  // Conductor sessions offload to Goal Desk + goal-driver Jobs (execution=goal-desk).
  // Non-conductor keeps the classic Ralph loop: createGoal on the main agent, then
  // send the objective so driveGoalTurnLoop can run.
  let snapshot: GoalSnapshot | undefined;
  try {
    snapshot = await host.requireSession().createGoal({
      objective: parsed.objective,
      replace: parsed.replace,
      ...(parsed.gateCommand !== undefined ? { gateCommand: parsed.gateCommand } : {}),
    });
  } catch (error) {
    if (isKimiError(error) && error.code === ErrorCodes.GOAL_ALREADY_EXISTS) {
      host.showError(
        ttui('tui.goal.alreadyActive'),
      );
      return false;
    }
    host.showError(formatErrorMessage(error));
    return false;
  }
  if (options.beforeSend !== undefined && !(await options.beforeSend())) {
    return false;
  }

  const offloaded = snapshot.execution === 'goal-desk';
  // Goal Desk: no follow-up user bubble — stamp objective + desk lane on the
  // confirmation card, and seed appState.goal so Goal Monitor / footer badge
  // light up immediately (job.updated alone was too easy to miss).
  host.state.transcriptContainer.addChild(
    new GoalSetMessageComponent(
      offloaded
        ? {
            objective: parsed.objective,
            lane: 'goal-desk',
            ...(snapshot.deskJobId !== undefined ? { deskJobId: snapshot.deskJobId } : {}),
          }
        : undefined,
    ),
  );
  requestTUILayoutRender(host.state);

  if (offloaded) {
    host.setAppState({ goal: snapshot });
    const desk = snapshot.deskJobId ? ` (${snapshot.deskJobId})` : '';
    host.showStatus(ttui('tui.goal.deskAccepted', { desk }));
    host.showNotice(ttui('tui.goal.deskLiveTitle'), ttui('tui.goal.deskLiveDetail'), {
      coalesceKey: `goal-desk-live:${snapshot.goalId}`,
    });
    return true;
  }

  if (options.sendInput !== undefined) {
    options.sendInput(parsed.objective);
  } else {
    host.sendNormalUserInput(parsed.objective);
  }
  return true;
}

async function pauseGoal(host: SlashCommandHost): Promise<void> {
  const session = host.requireSession();
  try {
    await session.pauseGoal();
    if (isStreaming(host)) await session.cancel({ source: 'goal-command' });
  } catch (error) {
    if (isKimiError(error) && error.code === ErrorCodes.GOAL_NOT_FOUND) {
      host.showStatus(ttui('tui.goal.noPause'));
      return;
    }
    host.showError(formatErrorMessage(error));
    return;
  }
  host.track('goal_pause');
  host.showStatus(ttui('tui.goal.paused'));
}

async function resumeGoal(host: SlashCommandHost): Promise<void> {
  if (host.state.appState.model.trim().length === 0 || host.session === undefined) {
    host.showError(LLM_NOT_SET_MESSAGE());
    return;
  }

  try {
    await host.requireSession().resumeGoal();
  } catch (error) {
    if (isKimiError(error) && error.code === ErrorCodes.GOAL_NOT_FOUND) {
      host.showStatus(ttui('tui.goal.noResume'));
      return;
    }
    host.showError(formatErrorMessage(error));
    return;
  }
  host.track('goal_resume');
  host.sendNormalUserInput(RESUME_GOAL_INPUT);
}

async function cancelGoal(host: SlashCommandHost): Promise<void> {
  const session = host.requireSession();
  try {
    await session.cancelGoal();
    if (isStreaming(host)) await session.cancel({ source: 'goal-command' });
  } catch (error) {
    if (isKimiError(error) && error.code === ErrorCodes.GOAL_NOT_FOUND) {
      host.showStatus(ttui('tui.goal.noCancel'));
      return;
    }
    host.showError(formatErrorMessage(error));
    return;
  }
  host.track('goal_cancel');
  host.showNotice(ttui('tui.goal.cancelled'));
}

async function showGoalStatus(host: SlashCommandHost): Promise<void> {
  const { goal } = await host.requireSession().getGoal();
  host.track('goal_status', { status: goal?.status ?? 'none' });
  if (goal === null) {
    host.showStatus(ttui('tui.goal.noGoal'));
    return;
  }
  host.state.transcriptContainer.addChild(
    new GoalStatusMessageComponent(goal),
  );
  requestTUILayoutRender(host.state);
}

function isStreaming(host: SlashCommandHost): boolean {
  return host.state.appState.streamingPhase !== 'idle';
}

function isBusy(host: SlashCommandHost): boolean {
  return isStreaming(host) || host.state.appState.isCompacting;
}
