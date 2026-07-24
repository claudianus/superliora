import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { seedUltraworkWorkflowReport } from '../../../../../packages/agent-core/src/ultrawork/workflow-report';
import {
  autoResumeUltraworkFromSession,
  buildUltraworkCoverageMatrix,
  buildUltraworkPrompt,
  handleUltraworkCommand,
  handleUltraworkModeToggle,
  isActiveUltraworkRun,
  parseUltraworkCommand,
} from '#/tui/commands/ultrawork';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { dispatchInput } from '#/tui/commands/dispatch';
import { currentTheme } from '#/tui/theme';

const ENTER = '\r';
const ESCAPE = '\u001B';
const DOWN = '\u001B[B';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

interface TestPicker {
  handleInput(data: string): void;
  render(width: number): string[];
}

function mountedPicker(host: SlashCommandHost): TestPicker {
  const mock = host.mountEditorReplacement as ReturnType<typeof vi.fn>;
  return mock.mock.calls[0]?.[0] as TestPicker;
}

/** Select Manual (default) or Auto/YOLO via Down then Enter, then flush start chain. */
async function chooseUltraworkStartMode(
  host: SlashCommandHost,
  choice: 'manual' | 'auto' | 'yolo' = 'manual',
): Promise<void> {
  const picker = mountedPicker(host);
  if (choice === 'auto') picker.handleInput(DOWN);
  if (choice === 'yolo') {
    picker.handleInput(DOWN);
    picker.handleInput(DOWN);
  }
  picker.handleInput(ENTER);
  await vi.waitFor(() => {
    expect(host.restoreEditor).toHaveBeenCalled();
  });
  const session = host.requireSession() as unknown as {
    setPermission: ReturnType<typeof vi.fn>;
    setPlanMode: ReturnType<typeof vi.fn>;
    createUltraworkRun: ReturnType<typeof vi.fn>;
  };
  // Always applies setPermission; then start may succeed or fail after prepare.
  await vi.waitFor(() => {
    expect(session.setPermission).toHaveBeenCalled();
  });
  // Terminal outcomes only: prompt sent, or start failed after permission.
  // Do not treat createUltraworkRun alone as done — evidence seed is still
  // async and sendNormalUserInput comes after it (CI race).
  await vi.waitFor(() => {
    const prompted = (host.sendNormalUserInput as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    const failed =
      (host.showError as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    expect(prompted || failed).toBe(true);
  });
}

interface TestComponent {
  render(width: number): string[];
}

function makeHost(
  overrides: {
    model?: string;
    hasSession?: boolean;
    permissionMode?: 'manual' | 'auto' | 'yolo';
    planMode?: boolean;
    swarmMode?: boolean;
    workDir?: string;
  } = {},
) {
  const session = {
    createGoal: vi.fn(async () => ({})),
    createUltraworkRun: vi.fn(async (payload: {
      id: string;
      objective: string;
      evidenceRoot: string;
      workDir: string;
      source: string;
      replaceGoal: boolean;
    }) => {
      seedUltraworkWorkflowReport({
        workDir: payload.workDir,
        evidenceRoot: payload.evidenceRoot,
        runId: payload.id,
        objective: payload.objective,
        createdAt: new Date().toISOString(),
        source: payload.source,
      });
      return {
        id: payload.id,
        objective: payload.objective,
        status: 'running',
        stage: 'plan',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
      };
    }),
    getUltraworkRun: vi.fn(async () => null),
    getStatus: vi.fn(async () => ({
      planMode: overrides.planMode ?? false,
      swarmMode: overrides.swarmMode ?? false,
      model: overrides.model ?? 'kimi-model',
      thinkingLevel: 'off',
      permission: overrides.permissionMode ?? 'auto',
    })),
    pauseUltrawork: vi.fn(async () => null),
    resumeUltrawork: vi.fn(async () => null),
    tryAutoResumeUltrawork: vi.fn(async () => null),
    cancelUltrawork: vi.fn(async () => null),
    setPlanMode: vi.fn(async () => {}),
    setPremiumQuality: vi.fn(async () => {}),
    setPermission: vi.fn(async () => {}),
    setSwarmMode: vi.fn(async () => {}),
    classifyUltraworkAutoActivation: vi.fn(async () => ({
      activate: false,
      confidence: 0,
      reason: 'test default',
    })),
    classifyUltraworkObjectiveProfile: vi.fn(async (text: string) => ({
      visualSurface: false,
      benchSurface: false,
      premiumDensity: 'code' as const,
      lanes: [
        'product_requirements',
        'architecture_implementation',
        'testing_evidence',
        'integration_ownership',
      ],
      confidence: 0,
      reason: `test fallback for ${text.slice(0, 40)}`,
      source: 'fallback' as const,
    })),
  };
  const hasSession = overrides.hasSession ?? true;
  const host = {
    state: {
      appState: {
        model: overrides.model ?? 'kimi-model',
        workDir: overrides.workDir ?? process.cwd(),
        permissionMode: overrides.permissionMode ?? 'auto',
        planMode: overrides.planMode ?? false,
        ultraworkMode: false,
        swarmMode: overrides.swarmMode ?? false,
      },
      theme: currentTheme,
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
    },
    session: hasSession ? session : undefined,
    requireSession: () => session,
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(host.state.appState, patch)),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    sendNormalUserInput: vi.fn(),
    track: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, session };
}

function renderedMarker(host: SlashCommandHost): string {
  const addChild = host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>;
  const component = addChild.mock.calls.at(-1)?.[0] as TestComponent | undefined;
  return stripAnsi(component?.render(80).join('\n') ?? '');
}

describe('dispatchInput without pre-agent Ultrawork routing', () => {
  it('sends natural language straight to the agent without classification', () => {
    const classify = vi.fn();
    const state = {
      appState: {
        streamingPhase: 'idle',
        isCompacting: false,
        ultraworkMode: false,
      },
    };
    const host = {
      state,
      session: { classifyUltraworkAutoActivation: classify },
      skillCommandMap: new Map<string, string>(),
      pluginCommandMap: new Map<string, string>(),
      sendNormalUserInput: vi.fn(),
      track: vi.fn(),
      showError: vi.fn(),
    } as unknown as SlashCommandHost & { sendNormalUserInput: ReturnType<typeof vi.fn> };

    dispatchInput(host, 'Ship this feature end-to-end with plan and verification');

    expect(host.sendNormalUserInput).toHaveBeenCalledWith(
      'Ship this feature end-to-end with plan and verification',
    );
    expect(classify).not.toHaveBeenCalled();
  });
});

describe('buildUltraworkCoverageMatrix', () => {
  it('uses LLM profile lanes without keyword guessing', () => {
    const gameLanes = buildUltraworkCoverageMatrix(
      '갤러그 형태의 2D 게임이고 아이템도 있습니다. 비주얼 검사까지 해주세요.',
      {
        visualSurface: true,
        lanes: [
          'product_requirements',
          'architecture_implementation',
          'domain_subject_matter',
          'ux_visual_content',
          'testing_evidence',
          'integration_ownership',
          'independent_review_loop',
        ],
      },
    ).map((lane) => lane.id);

    expect(gameLanes).toContain('product_requirements');
    expect(gameLanes).toContain('architecture_implementation');
    expect(gameLanes).toContain('domain_subject_matter');
    expect(gameLanes).toContain('ux_visual_content');
    expect(gameLanes).toContain('testing_evidence');
    expect(gameLanes).toContain('independent_review_loop');

    const securityLanes = buildUltraworkCoverageMatrix(
      'OAuth 로그인 보안 취약점을 고치고 권한 회귀 테스트를 추가해줘',
      {
        visualSurface: false,
        lanes: [
          'product_requirements',
          'architecture_implementation',
          'security_privacy',
          'testing_evidence',
          'integration_ownership',
        ],
      },
    ).map((lane) => lane.id);

    expect(securityLanes).toContain('security_privacy');
    expect(securityLanes).toContain('testing_evidence');
    expect(securityLanes).not.toContain('ux_visual_content');

    const fallbackLanes = buildUltraworkCoverageMatrix(
      'Redesign the dashboard UI with browser screenshots',
    ).map((lane) => lane.id);
    expect(fallbackLanes).toContain('product_requirements');
    expect(fallbackLanes).not.toContain('ux_visual_content');
  });
});

describe('buildUltraworkPrompt', () => {
  it('wraps the objective in a lean contract that points at the ultrawork skill', () => {
    const prompt = buildUltraworkPrompt('Ship feature X', 'manual');

    expect(prompt).toContain('<ultrawork_flow>');
    expect(prompt).toContain('Ship feature X');
    expect(prompt).toContain('activation: manual');
    expect(prompt).toContain('active_goal_already_created: false');
    expect(prompt).toContain('capability_visual_surface: false');
    expect(prompt).toContain('capability_bench_surface: false');

    // Methodology lives in the `ultrawork` builtin skill; the prompt is a lean pointer plus runtime data.
    expect(prompt).toContain('load the `ultrawork` builtin skill via the Skill tool');
    expect(prompt).toContain('phase checkpoints are advisory, not hard blocks');
    expect(prompt).toContain(
      'UltraResearch -> UltraPlan interview -> UltraGoal -> Swarm decision -> Integrate -> Verify -> Learn',
    );
    expect(prompt).toContain('ExitPlanMode is the approval point before post-plan implementation');
    expect(prompt).toContain('do not ask the user to choose /ultraplan, /ultraresearch, /ultragoal, or /ultraswarm');
    expect(prompt).toContain('울트라플랜');
    expect(prompt).toContain('UpdateGoal complete/blocked');

    // Methodology detail is no longer injected inline.
    expect(prompt).not.toContain('Ultrawork orchestration');
    expect(prompt).not.toContain('Core operating rules');
    expect(prompt).not.toContain('Liora Knowledge Map');
    expect(prompt).not.toContain('Shift-Tab turns Ultrawork mode ON');
    expect(prompt).not.toContain('Capability Coverage Matrix');
    expect(prompt).not.toContain('Baseline + Upgrade');
    // Non-visual/non-bench objectives omit surface-conditional blocks.
    expect(prompt).not.toContain('Browser / computer-use verification');
    expect(prompt).not.toContain('LioraBench');
    // Lean activation: skill pointer + runtime data only.
    expect(prompt.length).toBeLessThan(3_000);
  });

  it('includes GUI verification only when capabilities mark a visual surface', () => {
    const prompt = buildUltraworkPrompt(
      'Redesign the dashboard UI with browser screenshots',
      'manual',
      false,
      { capabilities: { visualSurface: true, benchSurface: false } },
    );
    expect(prompt).toContain('capability_visual_surface: true');
    expect(prompt).toContain('Browser / computer-use verification');
    expect(prompt).not.toContain('LioraBench');
  });

  it('includes bench guidance only when capabilities mark a bench surface', () => {
    const prompt = buildUltraworkPrompt(
      'Run the SuperLiora agent SOTA harness benchmark gate',
      'manual',
      false,
      { capabilities: { visualSurface: false, benchSurface: true } },
    );
    expect(prompt).toContain('capability_bench_surface: true');
    expect(prompt).toContain('LioraBench');
    expect(prompt).toContain('Bench surface detected');
    expect(prompt).toContain('do not treat browser-only UI as TUI success');
    expect(prompt).not.toContain('Browser / computer-use verification');
  });

  it('marks /goal activations as already-created goal seeds', () => {
    const prompt = buildUltraworkPrompt('Ship feature X', 'goal', false, {
      activeGoalAlreadyCreated: true,
    });

    expect(prompt).toContain('activation: goal');
    expect(prompt).toContain('active_goal_already_created: true');
    expect(prompt).toContain('Do not call CreateGoal again for the same work');
    expect(prompt).toContain('finish with UpdateGoal complete/blocked');
  });

  it('threads runtime evidence seed paths into the workflow contract', () => {
    const prompt = buildUltraworkPrompt('Ship feature X', 'manual', false, {
      evidenceSeed: {
        root: '.superliora/evidence/ultrawork-runs/run-1',
        wikiRootPath: '.superliora/wiki',
        wikiIndexPath: '.superliora/wiki/index.md',
        wikiManifestPath: '.superliora/wiki/manifest.json',
        wikiRunPath: '.superliora/wiki/runs/run-1.md',
        llmWikiPath: '.superliora/evidence/ultrawork-runs/run-1/llm-wiki.md',
        knowledgeMapPath: '.superliora/evidence/ultrawork-runs/run-1/liora-knowledge-map.json',
        coverageMatrixPath: '.superliora/evidence/ultrawork-runs/run-1/capability-coverage-matrix.json',
        reviewLoopPath: '.superliora/evidence/ultrawork-runs/run-1/expert-review-loop.md',
        learnLedgerPath: '.superliora/evidence/ultrawork-runs/run-1/knowledge-persistence-ledger.json',
        workflowReportPath: '.superliora/evidence/ultrawork-runs/run-1/workflow-report.md',
        workflowStagesPath: '.superliora/evidence/ultrawork-runs/run-1/workflow-stages.json',
      },
    });

    expect(prompt).toContain('Runtime evidence seed created');
    expect(prompt).toContain('llm_wiki_root: .superliora/wiki');
    expect(prompt).toContain('llm_wiki_index: .superliora/wiki/index.md');
    expect(prompt).toContain('llm_wiki_manifest: .superliora/wiki/manifest.json');
    expect(prompt).toContain('llm_wiki_run: .superliora/wiki/runs/run-1.md');
    expect(prompt).not.toContain('llm_wiki_seed:');
    expect(prompt).toContain('knowledge_map_seed: .superliora/evidence/ultrawork-runs/run-1/liora-knowledge-map.json');
    expect(prompt).toContain('coverage_matrix_seed: .superliora/evidence/ultrawork-runs/run-1/capability-coverage-matrix.json');
    expect(prompt).toContain('expert_review_loop_seed: .superliora/evidence/ultrawork-runs/run-1/expert-review-loop.md');
    expect(prompt).toContain(
      'knowledge_persistence_ledger: .superliora/evidence/ultrawork-runs/run-1/knowledge-persistence-ledger.json',
    );
    expect(prompt).toContain('workflow_report: .superliora/evidence/ultrawork-runs/run-1/workflow-report.md');
    expect(prompt).toContain('workflow_stages: .superliora/evidence/ultrawork-runs/run-1/workflow-stages.json');
    expect(prompt).toContain('Fill each stage narrative before leaving the stage');
  });

  it('records blocked evidence persistence when the seed cannot be written', () => {
    const prompt = buildUltraworkPrompt('Ship feature X', 'manual', false, {
      evidenceSeedError: 'permission denied',
    });

    expect(prompt).toContain('Runtime evidence seed could not be created: permission denied');
    expect(prompt).toContain('Mark llm_wiki and local evidence persistence blocked');
  });
});

describe('parseUltraworkCommand', () => {
  it('keeps empty-objective guidance focused on Ultrawork', () => {
    const parsed = parseUltraworkCommand('');

    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') return;
    expect(parsed.message).toContain('/ultrawork Ship feature X');
    expect(parsed.message).toContain('/ultrawork replace Ship feature X');
    expect(parsed.message).not.toMatch(/ultragoal/i);
  });

  it('parses control subcommands', () => {
    expect(parseUltraworkCommand('status')).toEqual({ kind: 'status' });
    expect(parseUltraworkCommand('pause')).toEqual({ kind: 'pause' });
    expect(parseUltraworkCommand('resume')).toEqual({ kind: 'resume', runId: undefined });
    expect(parseUltraworkCommand('resume run-123')).toEqual({ kind: 'resume', runId: 'run-123' });
    expect(parseUltraworkCommand('cancel')).toEqual({ kind: 'cancel' });
  });

  it('keeps replace-without-objective guidance focused on Ultrawork', () => {
    const parsed = parseUltraworkCommand('replace');

    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') return;
    expect(parsed.message).toContain('/ultrawork replace Ship feature X');
    expect(parsed.message).not.toContain('/goal Ship feature X');
  });
});

describe('handleUltraworkCommand', () => {
  it('forces ultra plan research phase and swarm mode first, then sends the workflow prompt without creating the goal upfront', async () => {
    const { host, session } = makeHost();

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');
    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    await chooseUltraworkStartMode(host, 'manual');

    expect(session.setPermission).toHaveBeenCalledWith('manual');
    expect(session.setPlanMode).toHaveBeenCalledWith(true, true, 'Ship feature X');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(host.setAppState).toHaveBeenCalledWith({
      planMode: true,
      ultraworkMode: true,
      premiumQualityMode: true,
      swarmMode: true,
      ultraworkPriorState: {
        planMode: false,
        swarmMode: false,
        swarmModeEntry: undefined,
        premiumQualityMode: false,
      },
    });
    expect(session.setPremiumQuality).toHaveBeenCalledWith(true);
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(session.createUltraworkRun).toHaveBeenCalled();
    expect(host.setAppState).toHaveBeenCalledWith({
      activityTip: 'Ultrawork mode: research first, then UltraPlan interview, verifiable UltraGoal, Swarm decision, verify',
    });
    expect(renderedMarker(host)).toContain('Ultrawork activated');
    expect(renderedMarker(host)).toContain('Research>UltraPlan>UltraGoal>Swarm?>Integrate>Verify>Learn');
    expect(renderedMarker(host)).toContain(
      'One Ultrawork: source-backed questions → verifiable goal → team → verify',
    );
    expect(renderedMarker(host)).toContain(
      'Research: local + provider/MCP accelerators; verified sources only',
    );
    expect(renderedMarker(host)).toContain(
      'Next: evidence pack before UltraPlan questions',
    );
    expect(renderedMarker(host)).toContain('Ship feature X');
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(
      expect.stringContaining('<ultrawork_flow>'),
      { displayText: 'Ship feature X' },
    );
    expect(host.sendNormalUserInput).not.toHaveBeenCalledWith(
      expect.stringContaining('<ultrawork_flow>'),
      { displayText: expect.stringContaining('<ultrawork_flow>') },
    );
  });

  it('always shows Manual-default chooser and applies Manual setPermission from prior auto', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto' });

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    expect(session.createUltraworkRun).not.toHaveBeenCalled();
    const text = stripAnsi(mountedPicker(host).render(80).join('\n'));
    expect(text).toContain('How should Ultrawork interview and approvals run?');
    expect(text).toContain('Manual (default)');
    expect(text).toContain('You answer every AskUserQuestion');
    expect(text).toContain('not remembered');

    await chooseUltraworkStartMode(host, 'manual');

    expect(session.setPermission).toHaveBeenCalledWith('manual');
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'manual' });
    expect(session.createUltraworkRun).toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(
      expect.stringContaining('<ultrawork_flow>'),
      { displayText: 'Ship feature X' },
    );
  });

  it('applies Auto or YOLO when chosen even if prior mode differs', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');
    await chooseUltraworkStartMode(host, 'yolo');

    expect(session.setPermission).toHaveBeenCalledWith('yolo');
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'yolo' });
    expect(session.createUltraworkRun).toHaveBeenCalled();
  });

  it('defaults headless create to Manual without showing the chooser', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto' });

    await handleUltraworkCommand(host, 'Ship feature X', 'headless');

    expect(host.mountEditorReplacement).not.toHaveBeenCalled();
    expect(session.setPermission).toHaveBeenCalledWith('manual');
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'manual' });
    expect(session.createUltraworkRun).toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(
      expect.stringContaining('activation: headless'),
      { displayText: 'Ship feature X' },
    );
  });

  it('cancels create without starting when chooser is dismissed', async () => {
    const { host, session } = makeHost({ permissionMode: 'yolo' });

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');
    mountedPicker(host).handleInput(ESCAPE);

    expect(host.restoreInputText).toHaveBeenCalledWith('/ultrawork Ship feature X');
    expect(host.showStatus).toHaveBeenCalledWith('Ultrawork not started.');
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.createUltraworkRun).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('creates project-local LLM Wiki, knowledge-map, coverage, and review seed evidence', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-ultrawork-seed-'));
    try {
      const { host, session } = makeHost({ workDir });
      (
        session as {
          classifyUltraworkObjectiveProfile: ReturnType<typeof vi.fn>;
        }
      ).classifyUltraworkObjectiveProfile = vi.fn(async () => ({
        visualSurface: true,
        benchSurface: false,
        premiumDensity: 'visual' as const,
        lanes: [
          'product_requirements',
          'architecture_implementation',
          'domain_subject_matter',
          'ux_visual_content',
          'testing_evidence',
          'integration_ownership',
          'independent_review_loop',
        ],
        confidence: 0.94,
        reason: 'test visual game profile',
        source: 'llm' as const,
      }));

      await handleUltraworkCommand(
        host,
        '갤러그 형태의 2D 게임이고 아이템도 있습니다. 비주얼 검사까지 해주세요.',
        'manual',
      );
      await chooseUltraworkStartMode(host, 'manual');

      const runsRoot = join(workDir, '.superliora/evidence/ultrawork-runs');
      const runDirs = readdirSync(runsRoot);
      expect(runDirs).toHaveLength(1);
      const runRoot = join(runsRoot, runDirs[0] ?? '');
      const wikiIndexPath = join(workDir, '.superliora/wiki/index.md');
      const wikiManifestPath = join(workDir, '.superliora/wiki/manifest.json');
      const wikiRunPath = join(workDir, '.superliora/wiki/runs', `${runDirs[0] ?? ''}.md`);
      const knowledgeMapPath = join(runRoot, 'liora-knowledge-map.json');
      const coverageMatrixPath = join(runRoot, 'capability-coverage-matrix.json');
      const reviewLoopPath = join(runRoot, 'expert-review-loop.md');
      const learnLedgerPath = join(runRoot, 'knowledge-persistence-ledger.json');
      const workflowReportPath = join(runRoot, 'workflow-report.md');
      const workflowStagesPath = join(runRoot, 'workflow-stages.json');

      for (const path of [
        wikiIndexPath,
        wikiManifestPath,
        wikiRunPath,
        knowledgeMapPath,
        coverageMatrixPath,
        reviewLoopPath,
        learnLedgerPath,
        workflowReportPath,
        workflowStagesPath,
      ]) {
        expect(existsSync(path)).toBe(true);
      }

      expect(existsSync(join(runRoot, 'llm-wiki.md'))).toBe(false);
      expect(readFileSync(workflowReportPath, 'utf8')).toContain('mandatory transparency ledger');
      expect(readFileSync(workflowStagesPath, 'utf8')).toContain('ultrawork-workflow-stages');
      expect(readFileSync(wikiRunPath, 'utf8')).toContain('workflow-report.md');
      expect(readFileSync(wikiRunPath, 'utf8')).toContain('.superliora/wiki/index.md');
      expect(readFileSync(wikiIndexPath, 'utf8')).toContain('This project-local wiki stores human-reviewable');
      expect(readFileSync(wikiRunPath, 'utf8')).toContain('Next Retrieval Hints');
      const manifest = JSON.parse(readFileSync(wikiManifestPath, 'utf8')) as {
        kind: string;
        latestRunId: string;
        runs: Array<{ path: string; llmWikiPath: string; evidenceState?: string }>;
      };
      expect(manifest.kind).toBe('llm-wiki-manifest');
      expect(manifest.latestRunId).toBe(runDirs[0]);
      expect(manifest.runs[0]?.path).toBe(`.superliora/wiki/runs/${runDirs[0]}.md`);
      expect(manifest.runs[0]?.llmWikiPath).toBe(`.superliora/wiki/runs/${runDirs[0]}.md`);
      expect(manifest.runs[0]?.evidenceState).toBe('seed');
      expect(readFileSync(reviewLoopPath, 'utf8')).toContain('Review required: yes');
      const knowledgeMap = JSON.parse(readFileSync(knowledgeMapPath, 'utf8')) as Record<string, unknown>;
      expect(knowledgeMap['kind']).toBe('liora knowledge map');
      const coverage = JSON.parse(readFileSync(coverageMatrixPath, 'utf8')) as {
        lanes: Array<{ id: string }>;
      };
      const laneIds = coverage.lanes.map((lane) => lane.id);
      expect(laneIds).toContain('domain_subject_matter');
      expect(laneIds).toContain('ux_visual_content');
      expect(laneIds).toContain('independent_review_loop');

      const prompt = (host.sendNormalUserInput as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
      expect(prompt).toContain('Runtime evidence seed created');
      expect(prompt).toContain('.superliora/evidence/ultrawork-runs');
      expect(prompt).toContain('.superliora/wiki/index.md');
      expect(prompt).toContain('knowledge_persistence_ledger');
      expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('Ultrawork evidence seed: '));
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('does not create a goal when ultra-plan setup fails', async () => {
    const { host, session } = makeHost();
    session.setPlanMode.mockRejectedValueOnce(new Error('plan denied'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');
    await chooseUltraworkStartMode(host, 'manual');

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true, 'Ship feature X');
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.state.appState.swarmMode).toBe(false);
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('continues when plan mode is already active', async () => {
    const { host, session } = makeHost({ planMode: true });
    session.setPlanMode.mockRejectedValueOnce(new Error('Already in plan mode'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');
    await chooseUltraworkStartMode(host, 'manual');

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true, 'Ship feature X');
    expect(session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(session.setPlanMode).toHaveBeenLastCalledWith(true, true, 'Ship feature X');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(
      expect.stringContaining('<ultrawork_flow>'),
      { displayText: 'Ship feature X' },
    );
  });

  it('continues when session state is already in plan mode but app state is stale', async () => {
    const { host, session } = makeHost({ planMode: false });
    session.setPlanMode.mockRejectedValueOnce(new Error('Already in plan mode'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');
    await chooseUltraworkStartMode(host, 'manual');

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true, 'Ship feature X');
    expect(session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(session.setPlanMode).toHaveBeenLastCalledWith(true, true, 'Ship feature X');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(host.setAppState).toHaveBeenCalledWith({
      planMode: true,
      ultraworkMode: true,
      premiumQualityMode: true,
      swarmMode: true,
      ultraworkPriorState: {
        planMode: false,
        swarmMode: false,
        swarmModeEntry: undefined,
        premiumQualityMode: false,
      },
    });
    expect(session.setPremiumQuality).toHaveBeenCalledWith(true);
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(
      expect.stringContaining('<ultrawork_flow>'),
      { displayText: 'Ship feature X' },
    );
  });

  it('does not create the goal upfront even if the goal API would reject', async () => {
    const { host, session } = makeHost();
    session.createGoal.mockRejectedValueOnce(new Error('goal denied'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');
    await chooseUltraworkStartMode(host, 'manual');

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true, 'Ship feature X');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.state.appState.planMode).toBe(true);
    expect(host.state.appState.swarmMode).toBe(true);
    expect(host.sendNormalUserInput).toHaveBeenCalled();
  });

  it('supports replace mode for /ultragoal', async () => {
    const { host, session } = makeHost();

    await handleUltraworkCommand(host, 'replace Ship feature Y', 'manual');
    await chooseUltraworkStartMode(host, 'manual');

    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(
      expect.stringContaining('goal_replace_requested: true'),
      { displayText: 'Ship feature Y' },
    );
  });

  it('resumes blocked runs without resetting plan mode', async () => {
    const { host, session } = makeHost({ planMode: true });
    session.getUltraworkRun.mockResolvedValue({
      id: 'run-blocked',
      objective: 'Resume me',
      status: 'blocked',
      stage: 'plan',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:05:00.000Z',
    } as never);
    session.resumeUltrawork.mockResolvedValue({
      run: {
        id: 'run-blocked',
        objective: 'Resume me',
        status: 'running',
        stage: 'plan',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:06:00.000Z',
      },
      recoveryPrompt: '<ultrawork_recovery>\nResume me\n</ultrawork_recovery>',
      goalResumed: false,
      report: {
        run: {
          id: 'run-blocked',
          objective: 'Resume me',
          status: 'running',
          stage: 'plan',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:06:00.000Z',
        },
        orphanedWorkNodes: [],
        orphanedExperts: [],
        lostBackgroundTasks: [],
        nextActions: [],
      },
    } as never);

    await handleUltraworkCommand(host, 'resume', 'manual');

    expect(host.mountEditorReplacement).not.toHaveBeenCalled();
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.setPlanMode).not.toHaveBeenCalledWith(false, false);
    expect(session.resumeUltrawork).toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(
      expect.stringContaining('<ultrawork_recovery>'),
      { displayText: 'Resume Ultrawork: Resume me' },
    );
  });

  it('routes blocked ultrawork auto activation through normal user input', async () => {
    const { host, session } = makeHost({ planMode: true });
    session.getUltraworkRun.mockResolvedValue({
      id: 'run-blocked',
      objective: 'Resume me',
      status: 'blocked',
      stage: 'research',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:05:00.000Z',
    } as never);

    await handleUltraworkCommand(host, '울트라워크로 readme 작업 재개해줘', 'auto');

    expect(session.createUltraworkRun).not.toHaveBeenCalled();
    expect(session.resumeUltrawork).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('울트라워크로 readme 작업 재개해줘');
  });
});

describe('handleUltraworkModeToggle', () => {
  it('blocks turning Ultrawork mode off while a run is active', async () => {
    const { host, session } = makeHost();
    host.state.appState.ultraworkMode = true;
    host.state.appState.planMode = true;
    session.getUltraworkRun.mockResolvedValue({
      id: 'run-active',
      objective: 'Ship feature X',
      status: 'running',
      stage: 'integrate',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    } as never);

    await handleUltraworkModeToggle(host, false);

    expect(session.setPlanMode).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('Ultrawork mode stays on while a workflow run is active.'),
    );
    expect(host.state.appState.ultraworkMode).toBe(true);
  });

  it('blocks turning Ultrawork mode off while a run is paused', async () => {
    const { host, session } = makeHost();
    host.state.appState.ultraworkMode = true;
    session.getUltraworkRun.mockResolvedValue({
      id: 'run-paused',
      objective: 'Ship feature X',
      status: 'blocked',
      stage: 'verify',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    } as never);

    await handleUltraworkModeToggle(host, false);

    expect(session.setPlanMode).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('run-paused'));
    expect(host.state.appState.ultraworkMode).toBe(true);
  });

  it('allows turning Ultrawork mode off when no active run exists', async () => {
    const { host, session } = makeHost();
    host.state.appState.ultraworkMode = true;
    host.state.appState.planMode = true;
    session.getUltraworkRun.mockResolvedValue(null);

    await handleUltraworkModeToggle(host, false);

    expect(session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(host.state.appState.ultraworkMode).toBe(false);
    expect(host.showNotice).toHaveBeenCalledWith('Ultrawork mode: OFF', undefined, {
      coalesceKey: 'ultrawork-mode',
    });
  });
});

describe('isActiveUltraworkRun', () => {
  it('treats running and blocked runs as active', () => {
    expect(
      isActiveUltraworkRun({
        id: 'run-1',
        objective: 'test',
        status: 'running',
        stage: 'plan',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      isActiveUltraworkRun({
        id: 'run-2',
        objective: 'test',
        status: 'blocked',
        stage: 'verify',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('treats done, failed, and missing runs as inactive', () => {
    expect(
      isActiveUltraworkRun({
        id: 'run-3',
        objective: 'test',
        status: 'done',
        stage: 'done',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
      }),
    ).toBe(false);
    expect(
      isActiveUltraworkRun({
        id: 'run-4',
        objective: 'test',
        status: 'failed',
        stage: 'verify',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
      }),
    ).toBe(false);
    expect(isActiveUltraworkRun(null)).toBe(false);
  });
});

describe('autoResumeUltraworkFromSession terminal-run guard', () => {
  it('does not re-force plan mode for a terminal resumed run', async () => {
    const { host, session } = makeHost();
    (session.tryAutoResumeUltrawork as ReturnType<typeof vi.fn>).mockResolvedValue({
      resumed: {
        run: {
          id: 'uw_terminal',
          objective: 'Ship feature',
          status: 'failed',
          stage: 'plan',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:01:00.000Z',
        },
        recoveryPrompt: 'Resume Ultrawork',
      },
      setupChanged: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resumed = await autoResumeUltraworkFromSession(host, session as any);

    expect(resumed).toBe(false);
    expect(host.setAppState).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('still re-prepares a non-terminal resumed run', async () => {
    const { host, session } = makeHost();
    (session.tryAutoResumeUltrawork as ReturnType<typeof vi.fn>).mockResolvedValue({
      resumed: {
        run: {
          id: 'uw_blocked',
          objective: 'Ship feature',
          status: 'blocked',
          stage: 'research',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:01:00.000Z',
        },
        recoveryPrompt: 'Resume Ultrawork',
      },
      setupChanged: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resumed = await autoResumeUltraworkFromSession(host, session as any);

    expect(resumed).toBe(true);
    expect(host.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({ ultraworkMode: true, planMode: true }),
    );
    expect(host.sendNormalUserInput).toHaveBeenCalled();
  });
});
