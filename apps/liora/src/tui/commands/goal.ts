import { ErrorCodes, isKimiError, type PermissionMode } from '@superliora/sdk';

import {
  GoalStartPermissionPromptComponent,
  type GoalStartPermissionChoice,
} from '../components/dialogs/goal-start-permission-prompt';
import {
  GoalQueueEditDialogComponent,
  GoalQueueManagerComponent,
  type GoalQueueEditResult,
  type GoalQueueManagerAction,
} from '../components/dialogs/goal-queue-manager';
import {
  GoalSetMessageComponent,
  GoalStatusMessageComponent,
  UpcomingGoalAddedMessageComponent,
} from '../components/messages/goal-panel';
import { LLM_NOT_SET_MESSAGE } from '../constant/liora-tui';
import { requestTUILayoutRender } from '../utils/frame-render';
import {
  appendGoalQueueItem,
  moveGoalQueueItem,
  readGoalQueue,
  removeGoalQueueItem,
  updateGoalQueueItem,
  type GoalQueueSnapshot,
} from '../goal-queue-store';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';
import { buildUltraworkPrompt } from './ultrawork-contract';
import {
  captureUltraworkTuiSetup,
  prepareUltraworkTuiSetup,
  rollbackUltraworkTuiSetup,
  type UltraworkTuiSetupState,
} from './ultrawork-lifecycle';

const MAX_GOAL_OBJECTIVE_LENGTH = 4000;
const RESUME_GOAL_INPUT =
  'Continue from where you left off. Resume the active goal without restarting earlier Ultrawork stages or redoing completed work.';
const START_NEXT_GOAL_NOW_MESSAGE = 'No active goal. Starting this goal now.';
const GOAL_ULTRAWORK_ACTIVITY_TIP =
  'Goal mode: research first, then UltraPlan interview, verifiable acceptance criteria, Swarm decision, verify';

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
 * current goal.) Stop conditions are expressed in the objective in natural
 * language (e.g. "…or stop after 20 turns"); the model honors them when it
 * self-audits each turn and reports `complete`/`blocked` via UpdateGoal.
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

  let index = 0;
  let replace = false;
  if (tokens[index] === 'replace') {
    replace = true;
    index += 1;
  }
  // `--` ends subcommand parsing so an objective can begin with a reserved word
  // (e.g. `/goal -- pause the rollout`).
  if (tokens[index] === '--') {
    index += 1;
  }

  const objective = tokens.slice(index).join(' ').trim();
  if (objective.length === 0) {
    // A usage hint, not a failure — shown in the same calm style as the other
    // "nothing to act on" messages (no goal to pause/resume/cancel).
    return {
      kind: 'error',
      severity: 'hint',
      message: 'Provide a goal objective, e.g. `/goal Ship feature X`.',
    };
  }
  if (objective.length > MAX_GOAL_OBJECTIVE_LENGTH) {
    return {
      kind: 'error',
      message: `Goal objective is too long (max ${MAX_GOAL_OBJECTIVE_LENGTH} characters). Reference long details by file path.`,
    };
  }
  return { kind: 'create', objective, replace };
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
    host.showError(`Failed to inspect current goal: ${formatErrorMessage(error)}`);
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
    host.showError(`Failed to load upcoming goals: ${formatErrorMessage(error)}`);
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
          host.showError(`Failed to update upcoming goals: ${formatErrorMessage(error)}`);
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
    host.showError(`Failed to load upcoming goals: ${formatErrorMessage(error)}`);
    return;
  }

  const goal = snapshot.goals.find((item) => item.id === goalId);
  if (goal === undefined) {
    host.showStatus('Queued goal no longer exists.');
    await showGoalQueueManager(host);
    return;
  }

  host.mountEditorReplacement(
    new GoalQueueEditDialogComponent({
      goal,
      onDone: (result) => {
        void handleGoalQueueEditResult(host, result).catch((error: unknown) => {
          host.showError(`Failed to update upcoming goal: ${formatErrorMessage(error)}`);
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
    host.showError(LLM_NOT_SET_MESSAGE);
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
    host.showStatus('Goal not started.');
  };
  host.mountEditorReplacement(
    new GoalStartPermissionPromptComponent({
      // Always present Manual-first Ultrawork-style choice set (not YOLO-keep framing).
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
    host.showError(`Failed to set permission mode: ${formatErrorMessage(error)}`);
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
  let setup: UltraworkTuiSetupState;
  try {
    setup = captureUltraworkTuiSetup(host);
    await prepareUltraworkTuiSetup(host, setup, parsed.objective, {
      preservePlan: true,
      activityTip: GOAL_ULTRAWORK_ACTIVITY_TIP,
      // Goal path historically did not stash ultraworkPriorState; keep that.
      recordPriorState: false,
    });
  } catch (error) {
    host.showError(`Failed to start goal workflow: ${formatErrorMessage(error)}`);
    return false;
  }

  try {
    await host.requireSession().createGoal({
      objective: parsed.objective,
      replace: parsed.replace,
    });
  } catch (error) {
    await rollbackUltraworkTuiSetup(host, setup);
    if (isKimiError(error) && error.code === ErrorCodes.GOAL_ALREADY_EXISTS) {
      host.showError(
        'A goal is already active. Use `/goal replace <objective>` to replace it, or `/goal status` to inspect it.',
      );
      return false;
    }
    host.showError(formatErrorMessage(error));
    return false;
  }
  if (options.beforeSend !== undefined && !(await options.beforeSend())) {
    return false;
  }
  host.state.transcriptContainer.addChild(new GoalSetMessageComponent());
  requestTUILayoutRender(host.state);
  if (options.sendInput !== undefined) {
    options.sendInput(parsed.objective);
  } else {
    const profile =
      typeof host.session?.classifyUltraworkObjectiveProfile === 'function'
        ? await host.session.classifyUltraworkObjectiveProfile(parsed.objective).catch(() => undefined)
        : undefined;
    host.sendNormalUserInput(
      buildUltraworkPrompt(parsed.objective, 'goal', parsed.replace, {
        activeGoalAlreadyCreated: true,
        capabilities: profile === undefined
          ? undefined
          : {
              visualSurface: profile.visualSurface,
              benchSurface: profile.benchSurface,
            },
      }),
      { displayText: parsed.objective },
    );
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
      host.showStatus('No goal to pause.');
      return;
    }
    host.showError(formatErrorMessage(error));
    return;
  }
  host.track('goal_pause');
  host.showStatus('Goal paused. Use `/goal resume` to continue.');
}

async function resumeGoal(host: SlashCommandHost): Promise<void> {
  if (host.state.appState.model.trim().length === 0 || host.session === undefined) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  try {
    await host.requireSession().resumeGoal();
  } catch (error) {
    if (isKimiError(error) && error.code === ErrorCodes.GOAL_NOT_FOUND) {
      host.showStatus('No goal to resume.');
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
      host.showStatus('No goal to cancel.');
      return;
    }
    host.showError(formatErrorMessage(error));
    return;
  }
  host.track('goal_cancel');
  host.showNotice('Goal cancelled.');
}

async function showGoalStatus(host: SlashCommandHost): Promise<void> {
  const { goal } = await host.requireSession().getGoal();
  host.track('goal_status', { status: goal?.status ?? 'none' });
  if (goal === null) {
    host.showStatus('No goal set. Start one with `/goal <objective>`.');
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
