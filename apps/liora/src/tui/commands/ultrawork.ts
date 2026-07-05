import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PermissionMode } from '@superliora/sdk';

import {
  SwarmStartPermissionPromptComponent,
  type SwarmStartPermissionChoice,
} from '../components/dialogs/swarm-start-permission-prompt';
import { UltraworkModeMarkerComponent } from '../components/messages/ultrawork-markers';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import { KNOWLEDGE_MAP_FILENAME, resolveLlmWikiPaths, resolveUltraworkEvidenceRoot } from '#/constant/workspace-data';
import { formatErrorMessage } from '../utils/event-payload';
import { requestTUILayoutRender } from '../utils/frame-render';
import type { SlashCommandHost } from './dispatch';
import { writeProjectLlmWikiSeed } from './llm-wiki';
import {
  buildUltraworkPrompt,
  parseUltraworkCommand,
  shouldAutoActivateUltrawork,
  type UltraworkEvidenceSeed,
  type UltraworkActivationSource,
  type UltraworkCreateRequest,
} from './ultrawork-contract';

interface UltraworkSetupState {
  readonly planModeWasEnabled: boolean;
  readonly swarmModeWasEnabled: boolean;
  readonly ultraworkModeWasEnabled: boolean;
  readonly previousSwarmModeEntry: 'manual' | 'task' | undefined;
  planChanged: boolean;
  swarmEnabled: boolean;
}

const ULTRAWORK_ACTIVITY_TIP =
  'Ultrawork mode: research first, then UltraPlan interview, verifiable UltraGoal, Swarm decision, verify';

export {
  buildUltraworkPrompt,
  parseUltraworkCommand,
  shouldAutoActivateUltrawork,
  type UltraworkEvidenceSeed,
  type UltraworkActivationSource,
};

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

  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  if (host.state.appState.permissionMode === 'manual') {
    const commandText = source === 'auto' ? args : `/ultrawork ${args.trim()}`;
    showUltraworkStartPermissionPrompt(
      host,
      commandText,
      'Ultrawork not started.',
      async (choice) => {
        await startUltraworkWithPermission(host, parsed, source, choice);
      },
    );
    return;
  }

  await startUltrawork(host, parsed, source);
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
  try {
    if (enabled) {
      await forceUltraPlanMode(host.requireSession());
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
  });
  host.showNotice(
    enabled ? 'Ultrawork mode: ON' : 'Ultrawork mode: OFF',
    enabled
      ? 'Shift-Tab routes the next task through UltraPlan before any UltraGoal or Swarm work.'
      : undefined,
    { coalesceKey: 'ultrawork-mode' },
  );
}

function showUltraworkStartPermissionPrompt(
  host: SlashCommandHost,
  commandText: string,
  cancelStatus: string,
  onSelect: (choice: SwarmStartPermissionChoice) => Promise<void>,
): void {
  const cancelStart = (): void => {
    host.restoreInputText(commandText);
    host.showStatus(cancelStatus);
  };
  host.mountEditorReplacement(
    new SwarmStartPermissionPromptComponent({
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
  choice: SwarmStartPermissionChoice,
): Promise<void> {
  if ((choice === 'auto' || choice === 'yolo') && !(await setPermissionForUltrawork(host, choice))) {
    return;
  }
  await startUltrawork(host, request, source);
}

async function startUltrawork(
  host: SlashCommandHost,
  request: UltraworkCreateRequest,
  source: UltraworkActivationSource,
): Promise<void> {
  const setup: UltraworkSetupState = {
    planModeWasEnabled: host.state.appState.planMode,
    swarmModeWasEnabled: host.state.appState.swarmMode,
    ultraworkModeWasEnabled: host.state.appState.ultraworkMode ?? false,
    previousSwarmModeEntry: host.state.swarmModeEntry,
    planChanged: false,
    swarmEnabled: false,
  };
  try {
    await prepareUltraworkSetup(host, setup, request.objective);
  } catch (error) {
    await rollbackUltraworkSetup(host, setup);
    host.showError(`Failed to start ultrawork: ${formatErrorMessage(error)}`);
    return;
  }

  host.track('ultrawork_start', { source, replace: request.replace });
  let evidenceSeed: UltraworkEvidenceSeed | undefined;
  let evidenceSeedError: string | undefined;
  try {
    evidenceSeed = createUltraworkEvidenceSeed(
      host.state.appState.workDir,
      request.objective,
      source,
      request.replace,
    );
    host.showStatus(`Ultrawork evidence seed: ${evidenceSeed.root}`);
  } catch (error) {
    evidenceSeedError = formatErrorMessage(error);
    host.showStatus(`Ultrawork evidence seed blocked: ${evidenceSeedError}`);
  }
  host.setAppState({ activityTip: ULTRAWORK_ACTIVITY_TIP });
  host.state.transcriptContainer.addChild(
    new UltraworkModeMarkerComponent('active', request.objective),
  );
  requestTUILayoutRender(host.state);
  host.sendNormalUserInput(
    buildUltraworkPrompt(request.objective, source, request.replace, {
      evidenceSeed,
      evidenceSeedError,
    }),
    { displayText: request.objective },
  );
}

export interface UltraworkCoverageLane {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly evidenceNeeded: readonly string[];
  readonly owner: string;
}

export function buildUltraworkCoverageMatrix(objective: string): readonly UltraworkCoverageLane[] {
  const lanes: UltraworkCoverageLane[] = [];
  const addLane = (lane: UltraworkCoverageLane): void => {
    if (lanes.some((entry) => entry.id === lane.id)) return;
    lanes.push(lane);
  };

  addLane({
    id: 'product_requirements',
    label: 'Product / requirements',
    reason: 'The UltraGoal needs explicit scope, non-goals, acceptance criteria, and user-visible completion criteria.',
    evidenceNeeded: ['UltraGoal seed', 'AC Tree', 'Acceptance Criteria', 'non-goals'],
    owner: 'main integration owner',
  });

  if (matchesAny(objective, [
    /\b(?:build|ship|implement|create|make|develop|refactor|integrate|app|game|website|api|ui|cli)\b/iu,
    /(?:구현|개발|제작|만들|완성|통합|앱|게임|웹|화면|도구|기능)/u,
  ])) {
    addLane({
      id: 'architecture_implementation',
      label: 'Architecture / implementation',
      reason: 'The work changes or creates executable behavior that needs a concrete implementation plan.',
      evidenceNeeded: ['affected files', 'implementation plan', 'focused tests or runnable checks'],
      owner: 'implementation owner',
    });
  }

  if (matchesAny(objective, [
    /\b(?:game|galaga|airplane|simulation|finance|legal|medical|health|data|ml|ai|security|payment|auth)\b/iu,
    /(?:게임|갤러그|비행기|시뮬레이션|금융|법률|의료|건강|데이터|보안|결제|인증)/u,
  ])) {
    addLane({
      id: 'domain_subject_matter',
      label: 'Domain subject matter',
      reason: 'The goal depends on domain-specific rules, terminology, or quality expectations.',
      evidenceNeeded: ['domain assumptions', 'source or observed behavior references', 'domain review verdict'],
      owner: 'domain specialist',
    });
  }

  if (matchesAny(objective, [
    /\b(?:ui|ux|visual|screen|canvas|animation|motion|layout|design|brand|game|interactive|browser)\b/iu,
    /(?:시각|비주얼|화면|캔버스|애니메이션|동작|레이아웃|디자인|브랜드|게임|인터랙티브|브라우저)/u,
  ])) {
    addLane({
      id: 'ux_visual_content',
      label: 'UX / visual / content craft',
      reason: 'The result has a visible or subjective quality bar that cannot be proven by code inspection alone.',
      evidenceNeeded: ['screenshot or recording', 'visual target', 'reviewer verdict'],
      owner: 'UX or visual reviewer',
    });
  }

  if (matchesAny(objective, [
    /\b(?:auth|oauth|login|permission|security|privacy|secret|token|payment|compliance|legal)\b/iu,
    /(?:로그인|권한|보안|개인정보|비밀|토큰|결제|컴플라이언스|법률)/u,
  ])) {
    addLane({
      id: 'security_privacy',
      label: 'Security / privacy',
      reason: 'The work may affect credentials, permissions, privacy, payment, or compliance behavior.',
      evidenceNeeded: ['threat or privacy notes', 'secret scan', 'negative tests or permission proof'],
      owner: 'security reviewer',
    });
  }

  if (matchesAny(objective, [
    /\b(?:performance|latency|scale|throughput|reliability|realtime|real-time|benchmark)\b/iu,
    /(?:성능|지연|확장|처리량|안정성|실시간|벤치마크)/u,
  ])) {
    addLane({
      id: 'performance_reliability',
      label: 'Performance / reliability',
      reason: 'The goal includes runtime quality, stability, or performance expectations.',
      evidenceNeeded: ['benchmark or timing evidence', 'failure mode notes', 'bounded retry behavior'],
      owner: 'performance reviewer',
    });
  }

  if (matchesAny(objective, [
    /\b(?:accessibility|a11y|i18n|localization|translation|korean|english|mobile|responsive)\b/iu,
    /(?:접근성|다국어|번역|한국어|영어|모바일|반응형)/u,
  ])) {
    addLane({
      id: 'accessibility_i18n',
      label: 'Accessibility / internationalization',
      reason: 'The result may need language, accessibility, viewport, or localization checks.',
      evidenceNeeded: ['keyboard/screen-reader notes when applicable', 'language copy review', 'responsive evidence'],
      owner: 'accessibility or localization reviewer',
    });
  }

  addLane({
    id: 'testing_evidence',
    label: 'Testing / evidence',
    reason: 'Completion must be backed by mechanical checks or explicit runtime evidence.',
    evidenceNeeded: ['test output', 'typecheck/lint/build status', 'runtime observation path'],
    owner: 'verification owner',
  });

  addLane({
    id: 'integration_ownership',
    label: 'Integration ownership',
    reason: 'Specialist feedback must be merged into one coherent implementation and final verdict.',
    evidenceNeeded: ['integration notes', 'conflict resolution', 'final PASS/BLOCKED rationale'],
    owner: 'main integration owner',
  });

  if (
    lanes.length > 4
    || matchesAny(objective, [
      /\b(?:review|director|approve|confirm|visual|quality|premium|polish|full version|full-version)\b/iu,
      /(?:검수|리뷰|디렉터|컨펌|승인|품질|프리미엄|풀버전|완성도)/u,
    ])
  ) {
    addLane({
      id: 'independent_review_loop',
      label: 'Independent review loop',
      reason: 'At least one acceptance criterion requires an independent verdict before completion.',
      evidenceNeeded: ['review prompt', 'review verdict', 'fix-and-review iteration notes until PASS or explicit BLOCKED'],
      owner: 'independent reviewer',
    });
  }

  return lanes;
}

export function createUltraworkEvidenceSeed(
  workDir: string,
  objective: string,
  source: UltraworkActivationSource,
  replaceGoal: boolean,
  now = new Date(),
): UltraworkEvidenceSeed {
  const createdAt = now.toISOString();
  const runId = `${createdAt.replaceAll(/[:.]/gu, '').replaceAll(/[^0-9TZ-]/gu, '')}-${slugifyObjective(objective)}-${randomUUID().slice(0, 8)}`;
  const root = join(resolveUltraworkEvidenceRoot(workDir), runId);
  const absoluteRoot = join(workDir, root);
  mkdirSync(absoluteRoot, { recursive: true });

  const safeObjective = redactEvidenceText(objective);
  const coverageMatrix = buildUltraworkCoverageMatrix(objective);
  const wikiRunPath = `${resolveLlmWikiPaths(workDir).wikiRootPath}/runs/${runId}.md`;
  const files = {
    llmWikiPath: wikiRunPath,
    knowledgeMapPath: join(root, KNOWLEDGE_MAP_FILENAME),
    coverageMatrixPath: join(root, 'capability-coverage-matrix.json'),
    reviewLoopPath: join(root, 'expert-review-loop.md'),
    learnLedgerPath: join(root, 'knowledge-persistence-ledger.json'),
  };
  const wikiArtifacts = writeProjectLlmWikiSeed(workDir, {
    runId,
    createdAt,
    objective: safeObjective,
    source,
    replaceGoal,
    coverageMatrix,
    evidenceFiles: { root, ...files },
  });
  writeFileSync(
    join(workDir, files.knowledgeMapPath),
    `${JSON.stringify({
      kind: 'liora knowledge map',
      schema: 1,
      evidenceState: 'seed',
      createdAt,
      objective: safeObjective,
      extractionPolicy: 'Relationships must be labelled EXTRACTED, INFERRED, or AMBIGUOUS.',
      relationship_confidence: [],
      path_affected_questions: [
        'Which files, tests, tools, and visible surfaces are connected to this UltraGoal?',
        'Which acceptance criteria need runtime, browser, computer-use, or expert evidence?',
      ],
      nodes: [
        { id: 'ultragoal_seed', type: 'goal', label: 'Provisional UltraGoal seed', confidence: 'EXTRACTED' },
        { id: 'coverage_matrix', type: 'artifact', label: files.coverageMatrixPath, confidence: 'EXTRACTED' },
        { id: 'expert_review_loop', type: 'artifact', label: files.reviewLoopPath, confidence: 'EXTRACTED' },
      ],
      edges: [
        {
          from: 'ultragoal_seed',
          to: 'coverage_matrix',
          relation: 'requires_capability_coverage',
          confidence: 'EXTRACTED',
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(workDir, files.coverageMatrixPath),
    `${JSON.stringify({
      kind: 'capability coverage matrix',
      schema: 1,
      createdAt,
      objective: safeObjective,
      lanes: coverageMatrix,
      swarmDecisionPolicy: {
        engageWhen:
          'More than one material lane, subjective quality, domain correctness, runtime evidence, or independent review is required.',
        deferWhen:
          'Every required lane is safely owned by the main agent and single-agent execution is lower-risk.',
      },
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(workDir, files.reviewLoopPath),
    renderExpertReviewLoopSeed(createdAt, safeObjective, coverageMatrix),
    'utf8',
  );
  writeFileSync(
    join(workDir, files.learnLedgerPath),
    `${JSON.stringify({
      kind: 'knowledge persistence ledger',
      schema: 1,
      createdAt,
      objective: safeObjective,
      entries: [
        {
          target: 'liora_recall',
          action: 'skipped',
          reason: 'Startup seed is not yet a verified reusable finding; write during Learn if durable knowledge is produced.',
        },
        {
          target: 'llm_wiki',
          action: 'wrote',
          reason: 'Created project-local LLM Wiki v2 index and run page before implementation.',
          path: wikiArtifacts.wikiRunPath,
          evidence: wikiArtifacts.wikiRunPath,
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );

  return { root, ...wikiArtifacts, ...files };
}

function renderExpertReviewLoopSeed(
  createdAt: string,
  objective: string,
  coverageMatrix: readonly UltraworkCoverageLane[],
): string {
  const reviewRequired = coverageMatrix.some((lane) => lane.id === 'independent_review_loop');
  const laneRows = coverageMatrix
    .map((lane) => `| ${lane.id} | ${lane.owner} | ${lane.evidenceNeeded.join(', ')} |`)
    .join('\n');
  return `# Expert Review Loop

Created: ${createdAt}

Objective: ${objective}

Review required: ${reviewRequired ? 'yes' : 'conditional'}

Before reporting completion, compare the actual result against each lane below. If any reviewer returns non-PASS, fix the concrete issue and repeat review until PASS or an explicit blocker is recorded.

| lane | owner | evidence needed |
|---|---|---|
${laneRows}

Reviewer verdicts:

- pending
`;
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function slugifyObjective(objective: string): string {
  const slug = objective
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, 32);
  return slug.length === 0 ? 'task' : slug;
}

function redactEvidenceText(value: string): string {
  return value
    .replaceAll(/\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)[A-Z0-9_]*\b/gu, '[REDACTED_ENV]')
    .replaceAll(/\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|credential)[A-Za-z0-9_-]*)=([^\s,;]+)/giu, '$1=[REDACTED_SECRET]')
    .replaceAll(/\b(?:sk|sk-proj|ghp|xoxb)-[A-Za-z0-9_-]{8,}\b/gu, '[REDACTED_SECRET]');
}

async function setPermissionForUltrawork(
  host: SlashCommandHost,
  mode: PermissionMode,
): Promise<boolean> {
  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    host.showError(`Failed to set permission mode: ${formatErrorMessage(error)}`);
    return false;
  }
  host.setAppState({ permissionMode: mode });
  return true;
}

async function prepareUltraworkSetup(
  host: SlashCommandHost,
  setup: UltraworkSetupState,
  initialContext = '',
): Promise<void> {
  const session = host.requireSession();
  if (!setup.swarmModeWasEnabled) {
    await session.setSwarmMode(true, 'task');
    setup.swarmEnabled = true;
    host.setAppState({ swarmMode: true });
    host.state.swarmModeEntry = 'task';
  }
  await forceUltraPlanMode(session, initialContext);
  setup.planChanged = true;
  host.setAppState({ planMode: true, ultraworkMode: true });
}

async function forceUltraPlanMode(
  session: ReturnType<SlashCommandHost['requireSession']>,
  initialContext = '',
): Promise<void> {
  try {
    await session.setPlanMode(true, true, initialContext);
  } catch (error) {
    if (!formatErrorMessage(error).includes('Already in plan mode')) throw error;
    await session.setPlanMode(false, false);
    await session.setPlanMode(true, true, initialContext);
  }
}

async function rollbackUltraworkSetup(
  host: SlashCommandHost,
  setup: UltraworkSetupState,
): Promise<void> {
  const session = host.requireSession();
  if (setup.planChanged) {
    await session.setPlanMode(setup.planModeWasEnabled, false).catch(() => {});
    host.setAppState({
      planMode: setup.planModeWasEnabled,
      ultraworkMode: setup.ultraworkModeWasEnabled,
    });
  }
  if (setup.swarmEnabled) {
    await session.setSwarmMode(false, 'task').catch(() => {});
    host.setAppState({ swarmMode: setup.swarmModeWasEnabled });
    host.state.swarmModeEntry = setup.previousSwarmModeEntry;
  }
}
