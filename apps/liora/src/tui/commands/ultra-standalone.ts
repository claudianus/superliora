/**
 * Standalone Ultra mode commands: /ultragoal, /ultraswarm, /ultraplan.
 *
 * These commands activate individual modes (Goal, Swarm, Plan) WITHOUT creating
 * or advancing an Ultrawork orchestration run. Each Ultra command provides
 * enhanced behavior compared to its base counterpart:
 *
 * - /ultragoal vs /goal: Enforces verifiable acceptance criteria, research-first
 *   approach, and evidence-based completion. No full Ultrawork pipeline.
 * - /ultraswarm vs /swarm: Adds specialist lane analysis, capability coverage
 *   matrix, and structured ENGAGE/DEFER decision framework.
 * - /ultraplan vs /plan: Activates the full Ultra Plan interview engine with
 *   research → interview → design → review → write phases.
 */

import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import { formatErrorMessage } from '../utils/event-payload';
import { requestTUILayoutRender } from '../utils/frame-render';
import type { SlashCommandHost } from './dispatch';
import { GoalSetMessageComponent } from '../components/messages/goal-panel';
import {
  GoalStartPermissionPromptComponent,
  type GoalStartPermissionChoice,
} from '../components/dialogs/goal-start-permission-prompt';
import {
  SwarmStartPermissionPromptComponent,
  type SwarmStartPermissionChoice,
} from '../components/dialogs/swarm-start-permission-prompt';
import {
  SwarmModeMarkerComponent,
  type SwarmModeMarkerState,
} from '../components/messages/swarm-markers';

// ---------------------------------------------------------------------------
// /ultragoal — Structured verification loop (closed) or self-improvement loop (open)
// ---------------------------------------------------------------------------

const MAX_ULTRAGOAL_OBJECTIVE_LENGTH = 4000;

export type UltraGoalMode = 'closed' | 'open';

/**
 * Closed loop prompt: Evaluator-Optimizer pattern.
 * Define AC → research → implement → verify against AC → complete when all pass.
 * The verifier is the acceptance criteria, not the model's self-assessment.
 */
function buildUltraGoalClosedPrompt(objective: string): string {
  return [
    `UltraGoal [closed loop] objective: ${objective}`,
    '',
    'Loop protocol (Evaluator-Optimizer pattern):',
    '1. DEFINE VERIFIER: Before any implementation, define 2-5 acceptance criteria.',
    '   Each must be objectively testable: "test X passes", "file Y contains Z", "endpoint returns 200".',
    '   Present them for user confirmation before proceeding.',
    '2. RESEARCH: Investigate the codebase to build a knowledge map. Cite file paths.',
    '3. EXECUTE: Implement changes incrementally.',
    '4. VERIFY: After each significant change, check EVERY criterion with real evidence',
    '   (test output, file inspection, command results). Report pass/fail per criterion.',
    '5. LOOP: If any criterion fails → return to step 3 targeting the failing criteria.',
    '6. DONE: Mark goal complete ONLY when ALL criteria have passing evidence.',
    '   Final report: criteria list with pass/fail + evidence for each.',
    '',
    'Begin by defining the acceptance criteria.',
  ].join('\n');
}

/**
 * Open loop prompt: Self-improvement with quality floor + circuit breaker.
 * Runs indefinitely until user cancels. Each cycle: observe → improve → verify floor.
 */
function buildUltraGoalOpenPrompt(objective: string): string {
  return [
    `UltraGoal [open loop] objective: ${objective}`,
    '',
    'Loop protocol (Open Loop with Circuit Breaker):',
    '1. QUALITY FLOOR: Define the minimum quality standard that must NEVER degrade.',
    '   Examples: "all tests pass", "linter 0 errors", "no type errors", "build succeeds".',
    '   Present the floor for user confirmation.',
    '2. OBSERVE: Assess current state against the objective. Identify the highest-impact',
    '   improvement opportunity available right now.',
    '3. IMPROVE: Make ONE focused improvement (small, verifiable change).',
    '4. VERIFY FLOOR: Run the quality floor checks. If floor is violated → revert immediately.',
    '5. REPORT: State what improved, current metrics, and next opportunity.',
    '6. LOOP: Continue from step 2. Do NOT ask permission between cycles.',
    '',
    'Circuit breaker rules:',
    '- If 3 consecutive cycles produce no measurable improvement → pause and report stagnation.',
    '- If quality floor is violated twice in a row → pause and request guidance.',
    '- Never sacrifice the quality floor for the sake of progress.',
    '',
    'This loop runs until the user cancels with /goal cancel. Maximize improvement per cycle.',
    'Begin by defining the quality floor.',
  ].join('\n');
}

export async function handleUltraGoalCommand(host: SlashCommandHost, args: string): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  const trimmed = args.trim();
  if (trimmed.length === 0) {
    host.showStatus('Usage: `/ultragoal <objective>` (closed loop) or `/ultragoal --loop <objective>` (open loop).');
    return;
  }

  let replace = false;
  let mode: UltraGoalMode = 'closed';
  let objective = trimmed;

  // Parse flags
  if (objective.startsWith('replace ')) {
    replace = true;
    objective = objective.slice('replace '.length).trim();
  }
  if (objective.startsWith('--loop ') || objective === '--loop') {
    mode = 'open';
    objective = objective.slice('--loop'.length).trim();
  } else if (objective.startsWith('-- ')) {
    objective = objective.slice(3).trim();
  }

  if (objective.length === 0) {
    host.showStatus('Usage: `/ultragoal <objective>` (closed loop) or `/ultragoal --loop <objective>` (open loop).');
    return;
  }
  if (objective.length > MAX_ULTRAGOAL_OBJECTIVE_LENGTH) {
    host.showError(`Goal objective is too long (max ${MAX_ULTRAGOAL_OBJECTIVE_LENGTH} characters).`);
    return;
  }

  // Show permission chooser (same UX as /goal)
  const commandText = `/ultragoal ${trimmed}`;
  showUltraGoalPermissionPrompt(host, commandText, objective, replace, mode);
}

function showUltraGoalPermissionPrompt(
  host: SlashCommandHost,
  commandText: string,
  objective: string,
  replace: boolean,
  mode: UltraGoalMode,
): void {
  const cancelStart = (): void => {
    host.restoreInputText(commandText);
    host.showStatus('Goal not started.');
  };
  host.mountEditorReplacement(
    new GoalStartPermissionPromptComponent({
      mode: 'manual',
      onSelect: (choice: GoalStartPermissionChoice) => {
        if (choice === 'cancel') {
          cancelStart();
          return;
        }
        host.restoreEditor();
        void startUltraGoal(host, objective, replace, choice, mode);
      },
      onCancel: cancelStart,
    }),
  );
}

async function startUltraGoal(
  host: SlashCommandHost,
  objective: string,
  replace: boolean,
  choice: GoalStartPermissionChoice,
  mode: UltraGoalMode,
): Promise<void> {
  // Apply permission mode
  if (choice === 'auto' || choice === 'yolo' || choice === 'manual') {
    try {
      await host.requireSession().setPermission(choice);
      host.setAppState({ permissionMode: choice });
    } catch (error) {
      host.showError(`Failed to set permission mode: ${formatErrorMessage(error)}`);
      return;
    }
  }

  // Create goal with standalone source — no Ultrawork stage advancement
  try {
    await host.requireSession().createGoal({
      objective,
      replace,
      source: 'standalone',
    });
  } catch (error) {
    host.showError(formatErrorMessage(error));
    return;
  }

  host.track('ultragoal_start', { replace, mode });
  host.state.transcriptContainer.addChild(new GoalSetMessageComponent());
  requestTUILayoutRender(host.state);

  // Send mode-specific structured prompt
  const prompt = mode === 'open'
    ? buildUltraGoalOpenPrompt(objective)
    : buildUltraGoalClosedPrompt(objective);
  host.sendNormalUserInput(prompt, { displayText: objective });
}

// ---------------------------------------------------------------------------
// /ultraswarm — Specialist delegation with coverage matrix analysis
// ---------------------------------------------------------------------------

/**
 * Structured prompt that differentiates /ultraswarm from /swarm.
 * Adds: specialist lane analysis, capability coverage matrix, ENGAGE/DEFER decision.
 */
function buildUltraSwarmPrompt(task: string): string {
  return [
    `UltraSwarm task: ${task}`,
    '',
    'UltraSwarm delegation framework (standalone — no Ultrawork pipeline):',
    '1. LANE ANALYSIS: Decompose this task into independent specialist lanes (e.g. frontend, backend, testing, design, infrastructure). For each lane, identify: required expertise, expected deliverable, verification method.',
    '2. COVERAGE MATRIX: Build a capability coverage matrix mapping: criterion/risk → expertise → evidence → specialist → owner.',
    '3. SWARM DECISION: Emit exactly `Swarm decision: ENGAGE|DEFER - <reason>; value: <specialist value or none>; owner: <verification owner>`.',
    '   - ENGAGE when: >1 material lane, subjective quality needed, high risk, hard-to-observe behavior, or independent review required.',
    '   - DEFER only when: the main agent owns every lane and no specialist adds value.',
    '4. EXECUTION: If ENGAGE, delegate to specialists via AgentSwarm with clear lane boundaries. If DEFER, execute directly with a visible waiver explaining why no specialist is needed.',
    '5. INTEGRATION: After specialist work, verify cross-lane integration and report the coverage matrix with evidence paths.',
    '',
    'Begin with the lane analysis for this task.',
  ].join('\n');
}

export async function handleUltraSwarmCommand(host: SlashCommandHost, args: string): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const prompt = args.trim();
  const mode = parseSwarmSubcommand(prompt);

  if (mode !== undefined) {
    await applyUltraSwarmMode(host, mode);
    return;
  }

  if (prompt.length === 0) {
    // Toggle swarm mode
    await applyUltraSwarmMode(host, !host.state.appState.swarmMode);
    return;
  }

  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  // Permission prompt in manual mode (same UX as /swarm)
  if (host.state.appState.permissionMode === 'manual') {
    showUltraSwarmPermissionPrompt(host, `/ultraswarm ${prompt}`, prompt);
    return;
  }

  await startUltraSwarmTask(host, prompt);
}

function showUltraSwarmPermissionPrompt(
  host: SlashCommandHost,
  commandText: string,
  task: string,
): void {
  const cancelStart = (): void => {
    host.restoreInputText(commandText);
    host.showStatus('UltraSwarm task not started.');
  };
  host.mountEditorReplacement(
    new SwarmStartPermissionPromptComponent({
      onSelect: (choice: SwarmStartPermissionChoice) => {
        host.restoreEditor();
        void startUltraSwarmWithPermission(host, task, choice);
      },
      onCancel: cancelStart,
    }),
  );
}

async function startUltraSwarmWithPermission(
  host: SlashCommandHost,
  task: string,
  choice: SwarmStartPermissionChoice,
): Promise<void> {
  if (choice === 'auto' || choice === 'yolo') {
    try {
      await host.requireSession().setPermission(choice);
      host.setAppState({ permissionMode: choice });
    } catch (error) {
      host.showError(`Failed to set permission mode: ${formatErrorMessage(error)}`);
      return;
    }
  }
  await startUltraSwarmTask(host, task);
}

async function startUltraSwarmTask(host: SlashCommandHost, task: string): Promise<void> {
  // Enable swarm mode if not already active
  if (!host.state.appState.swarmMode) {
    try {
      await host.requireSession().setSwarmMode(true, 'task');
      host.setAppState({ swarmMode: true });
      host.state.swarmModeEntry = 'task';
    } catch (error) {
      host.showError(`Failed to enable swarm mode: ${formatErrorMessage(error)}`);
      return;
    }
  }
  renderUltraSwarmMarker(host, 'active');
  host.track('ultraswarm_task');
  // Send structured UltraSwarm prompt (differentiated from /swarm's raw task)
  host.sendNormalUserInput(buildUltraSwarmPrompt(task), { displayText: task });
}

function renderUltraSwarmMarker(host: SlashCommandHost, state: SwarmModeMarkerState): void {
  host.state.transcriptContainer.addChild(
    new SwarmModeMarkerComponent(state),
  );
  requestTUILayoutRender(host.state);
}

async function applyUltraSwarmMode(host: SlashCommandHost, enabled: boolean): Promise<void> {
  if (enabled && host.state.appState.swarmMode) {
    host.showStatus('Swarm mode is already on.');
    return;
  }
  if (!enabled && !host.state.appState.swarmMode) {
    host.showStatus('Swarm mode is already off.');
    return;
  }
  try {
    await host.requireSession().setSwarmMode(enabled, 'manual');
  } catch (error) {
    host.showError(`Failed to ${enabled ? 'enable' : 'disable'} swarm mode: ${formatErrorMessage(error)}`);
    return;
  }
  host.setAppState({ swarmMode: enabled });
  host.state.swarmModeEntry = enabled ? 'manual' : undefined;
  host.track('ultraswarm_mode', { enabled });
  host.showStatus(enabled ? 'Swarm mode enabled (standalone).' : 'Swarm mode disabled.');
}

function parseSwarmSubcommand(input: string): boolean | undefined {
  const command = input.toLowerCase();
  if (command === 'on') return true;
  if (command === 'off') return false;
  return undefined;
}

// ---------------------------------------------------------------------------
// /ultraplan
// ---------------------------------------------------------------------------

export async function handleUltraPlanCommand(host: SlashCommandHost, args: string): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  const prompt = args.trim();

  // Toggle off if already in plan mode and no args
  if (host.state.appState.planMode && prompt.length === 0) {
    try {
      await host.requireSession().setPlanMode(false);
    } catch (error) {
      host.showError(`Failed to exit plan mode: ${formatErrorMessage(error)}`);
      return;
    }
    host.setAppState({ planMode: false, activityTip: null });
    host.showStatus('Ultra Plan mode disabled.');
    return;
  }

  if (host.state.appState.planMode) {
    host.showStatus('Ultra Plan mode is already active.');
    return;
  }

  // Enter Ultra Plan mode with standalone source — no Ultrawork stage advancement
  try {
    await host.requireSession().setPlanMode(true, true, prompt || undefined, 'standalone');
  } catch (error) {
    host.showError(`Failed to enter Ultra Plan mode: ${formatErrorMessage(error)}`);
    return;
  }

  host.setAppState({
    planMode: true,
    activityTip: 'Ultra Plan interview mode (standalone): research, interview, verifiable criteria',
  });
  host.track('ultraplan_start');
  host.showStatus('Ultra Plan interview mode active. Answer questions to build a verifiable plan.');

  // If user provided initial context, send it as input
  if (prompt.length > 0) {
    host.sendNormalUserInput(prompt);
  }
}
