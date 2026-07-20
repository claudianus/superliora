
import { join } from 'node:path';

import {
  ensureUltraworkResumeSetup,
  type PermissionMode,
} from '@superliora/sdk';

import {
  UltraworkStartModePromptComponent,
  type UltraworkStartModeChoice,
} from '../components/dialogs/ultrawork-start-mode-prompt';
import { UltraworkModeMarkerComponent } from '../components/messages/ultrawork-markers';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import { resolveUltraworkEvidenceRoot } from '#/constant/workspace-data';
import { formatErrorMessage } from '../utils/event-payload';
import { requestTUILayoutRender } from '../utils/frame-render';
import { ttui } from '../utils/tui-i18n';
import type { SlashCommandHost } from './dispatch';
import {
  captureUltraworkTuiSetup,
  prepareUltraworkTuiSetup,
  resetUltraPlanMode,
  rollbackUltraworkTuiSetup,
} from './ultrawork-lifecycle';
import {
  buildUltraworkPrompt,
  isActiveUltraworkRun,
  parseUltraworkCommand,
  ultraworkModeDisableBlockedMessage,
  type UltraworkEvidenceSeed,
  type UltraworkActivationSource,
  type UltraworkCreateRequest,
} from './ultrawork-contract';

import { buildUltraworkCoverageMatrix } from './ultrawork-coverage';
import {
  buildUltraworkRunId,
  createUltraworkEvidenceSeed,
} from './ultrawork-evidence-seed';

export type { UltraworkCoverageLane } from './ultrawork-coverage';
export { buildUltraworkCoverageMatrix } from './ultrawork-coverage';
export { buildUltraworkRunId, createUltraworkEvidenceSeed } from './ultrawork-evidence-seed';

// UltraworkTuiSetupState / capture / prepare / rollback live in ultrawork-lifecycle
// so Goal and Ultrawork share one TUI setup path.

const ULTRAWORK_ACTIVITY_TIP =
  'Ultrawork mode: research first, then UltraPlan interview, verifiable UltraGoal, Swarm decision, verify';

export {
  buildUltraworkPrompt,
  isActiveUltraworkRun,
  parseUltraworkCommand,
  ultraworkModeDisableBlockedMessage,
  type UltraworkEvidenceSeed,
  type UltraworkActivationSource,
};

/**
 * LLM-backed Ultrawork auto-activation gate.
 * Fail-closed when session/model/classifier is unavailable.
 */
export async function shouldAutoActivateUltrawork(
  host: Pick<SlashCommandHost, 'session'>,
  prompt: string,
): Promise<boolean> {
  const text = prompt.trim();
  if (text.length === 0) return false;
  const session = host.session;
  if (session === undefined) return false;
  if (typeof session.classifyUltraworkAutoActivation !== 'function') return false;
  try {
    const decision = await session.classifyUltraworkAutoActivation(text);
    return decision.activate === true;
  } catch {
    return false;
  }
}
async function resolveUltraworkObjectiveProfile(
  host: Pick<SlashCommandHost, 'session'>,
  objective: string,
): Promise<{
  readonly visualSurface: boolean;
  readonly benchSurface: boolean;
  readonly lanes: readonly string[];
  readonly premiumDensity: 'visual' | 'code';
  readonly confidence: number;
  readonly reason: string;
  readonly source: 'llm' | 'fallback';
}> {
  const session = host.session;
  if (session === undefined || typeof session.classifyUltraworkObjectiveProfile !== 'function') {
    return {
      visualSurface: false,
      benchSurface: false,
      lanes: [
        'product_requirements',
        'architecture_implementation',
        'testing_evidence',
        'integration_ownership',
      ],
      premiumDensity: 'code',
      confidence: 0,
      reason: 'Session unavailable for objective profile classification',
      source: 'fallback',
    };
  }
  try {
    return await session.classifyUltraworkObjectiveProfile(objective);
  } catch {
    return {
      visualSurface: false,
      benchSurface: false,
      lanes: [
        'product_requirements',
        'architecture_implementation',
        'testing_evidence',
        'integration_ownership',
      ],
      premiumDensity: 'code',
      confidence: 0,
      reason: 'Objective profile classification failed',
      source: 'fallback',
    };
  }
}

export async function handleUltraworkCommand(
  host: SlashCommandHost,
  args: string,
  source: UltraworkActivationSource = 'manual',
): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const parsed = parseUltraworkCommand(args);
  if (parsed.kind === 'error') {
    if (parsed.severity === 'hint') host.showStatus(parsed.message);
    else host.showError(parsed.message);
    return;
  }

  if (parsed.kind === 'status') {
    await showUltraworkStatus(host);
    return;
  }
  if (parsed.kind === 'pause') {
    await pauseUltrawork(host);
    return;
  }
  if (parsed.kind === 'resume') {
    await resumeUltrawork(host, parsed.runId);
    return;
  }
  if (parsed.kind === 'cancel') {
    await cancelUltrawork(host);
    return;
  }

  if (parsed.kind === 'create') {
    const existingRun = await host.requireSession().getUltraworkRun();
    if (existingRun?.status === 'blocked') {
      host.sendNormalUserInput(args.trim());
      return;
    }
    if (existingRun?.status === 'running') {
      if (source === 'auto') {
        host.sendNormalUserInput(args.trim());
        return;
      }
      host.showError('An Ultrawork run is already active. Continue in chat or use /ultrawork pause.');
      return;
    }
  }

  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  // Always-on chooser for every Ultrawork create (no memory of prior choice).
  // Resume paths return earlier. Headless has no TUI chooser → Manual.
  if (source === 'headless') {
    if (!(await setPermissionForUltrawork(host, 'manual'))) {
      return;
    }
    await startUltrawork(host, parsed, source);
    return;
  }

  const commandText = source === 'auto' ? args : `/ultrawork ${args.trim()}`;
  showUltraworkStartModePrompt(
    host,
    commandText,
    'Ultrawork not started.',
    async (choice) => {
      await startUltraworkWithPermission(host, parsed, source, choice);
    },
  );
}

export async function handleUltraworkModeToggle(
  host: SlashCommandHost,
  enabled: boolean,
): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }
  if (!enabled) {
    const run = await host.requireSession().getUltraworkRun();
    if (isActiveUltraworkRun(run)) {
      host.showError(ultraworkModeDisableBlockedMessage(run));
      return;
    }
  }
  try {
    if (enabled) {
      await resetUltraPlanMode(host.requireSession());
    } else {
      await host.requireSession().setPlanMode(false, false);
    }
  } catch (error) {
    host.showError(`Failed to ${enabled ? 'enable' : 'disable'} Ultrawork mode: ${formatErrorMessage(error)}`);
    return;
  }
  host.setAppState({
    planMode: enabled,
    ultraworkMode: enabled,
    activityTip: enabled ? ULTRAWORK_ACTIVITY_TIP : null,
    premiumQualityMode: enabled ? true : host.state.appState.premiumQualityMode,
  });
  if (enabled) {
    try {
      await host.requireSession().setPremiumQuality(true);
    } catch (error) {
      host.showError(ttui('tui.premium.enableFailed', { message: formatErrorMessage(error) }));
      return;
    }
  }
  host.showNotice(
    enabled ? ttui('tui.ultrawork.on.title') : ttui('tui.ultrawork.off.title'),
    enabled ? ttui('tui.ultrawork.on.detail') : undefined,
    { coalesceKey: 'ultrawork-mode' },
  );
}

function showUltraworkStartModePrompt(
  host: SlashCommandHost,
  commandText: string,
  cancelStatus: string,
  onSelect: (choice: UltraworkStartModeChoice) => Promise<void>,
): void {
  const cancelStart = (): void => {
    host.restoreInputText(commandText);
    host.showStatus(cancelStatus);
  };
  host.mountEditorReplacement(
    new UltraworkStartModePromptComponent({
      onSelect: (choice) => {
        host.restoreEditor();
        void onSelect(choice);
      },
      onCancel: cancelStart,
    }),
  );
}

async function startUltraworkWithPermission(
  host: SlashCommandHost,
  request: UltraworkCreateRequest,
  source: UltraworkActivationSource,
  choice: UltraworkStartModeChoice,
): Promise<void> {
  // Always apply the chosen mode, including Manual when prior was auto/yolo.
  if (!(await setPermissionForUltrawork(host, choice))) {
    return;
  }
  await startUltrawork(host, request, source);
}

async function startUltrawork(
  host: SlashCommandHost,
  request: UltraworkCreateRequest,
  source: UltraworkActivationSource,
): Promise<void> {
  const setup = captureUltraworkTuiSetup(host);
  try {
    await prepareUltraworkTuiSetup(host, setup, request.objective);
  } catch (error) {
    await rollbackUltraworkTuiSetup(host, setup);
    host.showError(`Failed to start ultrawork: ${formatErrorMessage(error)}`);
    return;
  }

  host.track('ultrawork_start', { source, replace: request.replace });
  const runId = buildUltraworkRunId(request.objective);
  const evidenceRoot = join(resolveUltraworkEvidenceRoot(host.state.appState.workDir), runId);
  const objectiveProfile = await resolveUltraworkObjectiveProfile(host, request.objective);
  try {
    await host.requireSession().createUltraworkRun({
      id: runId,
      objective: request.objective,
      source: mapUltraworkActivationSource(source),
      replaceGoal: request.replace,
      evidenceRoot,
      workDir: host.state.appState.workDir,
    });
  } catch (error) {
    await rollbackUltraworkTuiSetup(host, setup);
    host.showError(`Failed to register Ultrawork run: ${formatErrorMessage(error)}`);
    return;
  }
  let evidenceSeed: UltraworkEvidenceSeed | undefined;
  let evidenceSeedError: string | undefined;
  try {
    evidenceSeed = await createUltraworkEvidenceSeed(
      host.state.appState.workDir,
      request.objective,
      source,
      request.replace,
      runId,
      new Date(),
      objectiveProfile,
    );
    host.showStatus(`Ultrawork evidence seed: ${evidenceSeed.root}`);
  } catch (error) {
    evidenceSeedError = formatErrorMessage(error);
    host.showStatus(`Ultrawork evidence seed blocked: ${evidenceSeedError}`);
  }
  host.setAppState({ activityTip: ULTRAWORK_ACTIVITY_TIP });
  host.state.transcriptContainer.addChild(
    new UltraworkModeMarkerComponent({
      state: 'active',
      taskDescription: request.objective,
    }),
  );
  requestTUILayoutRender(host.state);
  host.sendNormalUserInput(
    buildUltraworkPrompt(request.objective, source, request.replace, {
      evidenceSeed,
      evidenceSeedError,
      capabilities: {
        visualSurface: objectiveProfile.visualSurface,
        benchSurface: objectiveProfile.benchSurface,
      },
    }),
    { displayText: request.objective },
  );
}

async function setPermissionForUltrawork(
  host: SlashCommandHost,
  mode: PermissionMode,
): Promise<boolean> {
  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    host.showError(ttui('tui.permission.setFailed', { message: formatErrorMessage(error) }));
    return false;
  }
  host.setAppState({ permissionMode: mode });
  return true;
}


function mapUltraworkActivationSource(
  source: UltraworkActivationSource,
): 'manual' | 'auto' | 'shift-tab' | 'goal' | 'headless' {
  if (source === 'auto') return 'auto';
  if (source === 'goal') return 'goal';
  if (source === 'headless') return 'headless';
  return 'manual';
}

async function showUltraworkStatus(host: SlashCommandHost): Promise<void> {
  const run = await host.requireSession().getUltraworkRun();
  if (run === null) {
    host.showStatus('No active Ultrawork run.');
    return;
  }
  const goal = (await host.requireSession().getGoal()).goal;
  const pendingNodes = run.workGraph?.nodes.filter((node) => node.status !== 'done').length ?? 0;
  host.showNotice(
    'Ultrawork status',
    [
      `Run: ${run.id}`,
      `Stage: ${run.stage}`,
      `Status: ${run.status}`,
      `Updated: ${run.updatedAt}`,
      goal === null ? 'Goal: none' : `Goal: ${goal.status} — ${goal.objective}`,
      `Pending WorkGraph nodes: ${String(pendingNodes)}`,
    ].join('\n'),
    { coalesceKey: 'ultrawork-status' },
  );
}

async function pauseUltrawork(host: SlashCommandHost): Promise<void> {
  try {
    const run = await host.requireSession().pauseUltrawork({ reason: 'Paused by user' });
    if (run === null) {
      host.showStatus('No active Ultrawork run to pause.');
      return;
    }
    host.showStatus(`Ultrawork paused at stage ${run.stage}. Use /ultrawork resume to continue.`);
  } catch (error) {
    host.showError(`Failed to pause Ultrawork: ${formatErrorMessage(error)}`);
  }
}

async function resumeUltrawork(host: SlashCommandHost, runId?: string): Promise<void> {
  const session = host.requireSession();
  const current = await session.getUltraworkRun();
  if (current === null) {
    host.showError('No Ultrawork run is available to resume in this session.');
    return;
  }
  if (runId !== undefined && current.id !== runId) {
    host.showError(`Active Ultrawork run is ${current.id}, not ${runId}.`);
    return;
  }

  const setup = captureUltraworkTuiSetup(host);
  try {
    const setupChanged = await ensureUltraworkResumeSetup(session, current);
    if (setupChanged) {
      const status = await session.getStatus();
      if (!setup.swarmModeWasEnabled && status.swarmMode) {
        setup.swarmEnabled = true;
      }
      if (setup.planModeWasEnabled !== status.planMode) {
        setup.planChanged = true;
      }
      // Resume re-asserts premium quality just like start does; record it so
      // rollback / finish can restore the prior value.
      if (!setup.premiumQualityWasEnabled) {
        setup.premiumQualityChanged = true;
      }
      host.setAppState({
        swarmMode: status.swarmMode,
        planMode: status.planMode,
        ultraworkMode: true,
      });
      if (status.swarmMode) {
        host.state.swarmModeEntry = 'ultrawork';
      }
    }
  } catch (error) {
    await rollbackUltraworkTuiSetup(host, setup);
    host.showError(`Failed to restore Ultrawork setup: ${formatErrorMessage(error)}`);
    return;
  }

  try {
    const result = await session.resumeUltrawork();
    if (result === null) {
      host.showError('Ultrawork run cannot be resumed from its current state.');
      return;
    }
    host.setAppState({
      activityTip: ULTRAWORK_ACTIVITY_TIP,
      ultraworkMode: true,
      planMode: true,
      premiumQualityMode: true,
    });
    try {
      await session.setPremiumQuality(true);
    } catch (error) {
      host.showError(ttui('tui.premium.enableFailed', { message: formatErrorMessage(error) }));
    }
    host.state.transcriptContainer.addChild(
      new UltraworkModeMarkerComponent({
        state: 'active',
        taskDescription: current.objective,
        currentStage: current.stage,
        progress: `${current.stage} stage`,
      }),
    );
    requestTUILayoutRender(host.state);
    host.sendNormalUserInput(result.recoveryPrompt, {
      displayText: `Resume Ultrawork: ${current.objective}`,
    });
    host.showStatus(`Ultrawork resumed at stage ${result.run.stage}.`);
  } catch (error) {
    await rollbackUltraworkTuiSetup(host, setup);
    host.showError(`Failed to resume Ultrawork: ${formatErrorMessage(error)}`);
  }
}

async function cancelUltrawork(host: SlashCommandHost): Promise<void> {
  try {
    const run = await host.requireSession().cancelUltrawork({ reason: 'Cancelled by user' });
    if (run === null) {
      host.showStatus('No active Ultrawork run to cancel.');
      return;
    }
    // Restore session flags captured at run start (mirrors finishUltraworkRun
    // in session-event-handler). Without a snapshot fall back to turning off.
    const prior = host.state.appState.ultraworkPriorState ?? null;
    const restorePlanMode = prior?.planMode ?? false;
    const restoreSwarmMode = prior?.swarmMode ?? false;
    const restorePremiumQuality = prior?.premiumQualityMode ?? false;
    host.state.swarmModeEntry = prior?.swarmModeEntry;
    host.setAppState({
      ultraworkMode: false,
      planMode: restorePlanMode,
      swarmMode: restoreSwarmMode,
      premiumQualityMode: restorePremiumQuality,
      activityTip: null,
      ultraworkPriorState: null,
    });
    const session = host.requireSession();
    void session.setPlanMode(restorePlanMode, false).catch(() => {});
    void session.setSwarmMode(restoreSwarmMode, 'task').catch(() => {});
    void session.setPremiumQuality(restorePremiumQuality).catch(() => {});
    host.showStatus(`Ultrawork run ${run.id} cancelled.`);
  } catch (error) {
    host.showError(`Failed to cancel Ultrawork: ${formatErrorMessage(error)}`);
  }
}

export async function autoResumeUltraworkFromSession(
  host: Pick<
    SlashCommandHost,
    'requireSession' | 'setAppState' | 'showNotice' | 'sendNormalUserInput' | 'state' | 'showStatus' | 'showError'
  >,
  session: ReturnType<SlashCommandHost['requireSession']>,
): Promise<boolean> {
  try {
    const result = await session.tryAutoResumeUltrawork();
    if (result === null) return false;
    const run = result.resumed.run;
    host.setAppState({
      activityTip: ULTRAWORK_ACTIVITY_TIP,
      ultraworkMode: true,
      planMode: true,
      premiumQualityMode: true,
    });
    try {
      await session.setPremiumQuality(true);
    } catch (error) {
      host.showError(ttui('tui.premium.enableFailed', { message: formatErrorMessage(error) }));
    }
    host.showNotice(
      ttui('tui.ultrawork.autoResume.title'),
      ttui('tui.ultrawork.autoResume.detail', { stage: run.stage }),
      { coalesceKey: 'ultrawork-auto-resume' },
    );
    host.sendNormalUserInput(result.resumed.recoveryPrompt, {
      displayText: `Resume Ultrawork: ${run.objective}`,
    });
    host.showStatus(`Ultrawork resumed at stage ${run.stage}.`);
    return true;
  } catch (error) {
    host.showError(`Failed to resume Ultrawork: ${formatErrorMessage(error)}`);
    return false;
  }
}
