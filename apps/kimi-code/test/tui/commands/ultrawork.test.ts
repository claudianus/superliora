import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildUltraworkCoverageMatrix,
  buildUltraworkPrompt,
  handleUltraworkCommand,
  parseUltraworkCommand,
  shouldAutoActivateUltrawork,
} from '#/tui/commands/ultrawork';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { currentTheme } from '#/tui/theme';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
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
    setPlanMode: vi.fn(async () => {}),
    setPermission: vi.fn(async () => {}),
    setSwarmMode: vi.fn(async () => {}),
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

describe('shouldAutoActivateUltrawork', () => {
  it('activates for explicit ultrawork branding and complex autonomous work', () => {
    expect(shouldAutoActivateUltrawork('Use ultrawork to ship the memory workflow')).toBe(true);
    expect(
      shouldAutoActivateUltrawork(
        'Use UltraPlan and UltraSwarm to implement this refactor, verify it, and finish automatically',
      ),
    ).toBe(true);
    expect(
      shouldAutoActivateUltrawork(
        '울트라플랜, 울트라 골, 울트라 스웜이 자동으로 연동되어 하나의 워크플로우로 작업을 완수하게 해줘',
      ),
    ).toBe(true);
    expect(
      shouldAutoActivateUltrawork(
        '울트라플랜 울트라 스웜 울트라 골이 모두 자동으로 연동및 발동되서 하나의 워크플로우(울트라워크)를 형성하여 훌륭하게 작업을 완수하게 해줘',
      ),
    ).toBe(true);
    expect(shouldAutoActivateUltrawork('울트라워크로 이 기능 구현하고 검증까지 끝내줘')).toBe(true);
  });

  it('does not activate for plain actionable requests without Ultrawork mode or explicit branding', () => {
    expect(shouldAutoActivateUltrawork('Implement the settings panel and verify it works')).toBe(false);
    expect(shouldAutoActivateUltrawork('Fix the TUI status panel bug and run tests')).toBe(false);
    expect(shouldAutoActivateUltrawork('Add a login screen')).toBe(false);
    expect(shouldAutoActivateUltrawork('Create an API endpoint for checkout')).toBe(false);
    expect(shouldAutoActivateUltrawork('Install the latest version and make a Galaga game')).toBe(false);
    expect(shouldAutoActivateUltrawork('이 기능 만들어서 테스트까지 돌려줘')).toBe(false);
    expect(shouldAutoActivateUltrawork('TUI 자동완성 버그 고치고 검수해줘')).toBe(false);
    expect(shouldAutoActivateUltrawork('로그인 화면 만들어줘')).toBe(false);
    expect(shouldAutoActivateUltrawork('최신버전 깔아서 갤러그 만들어줘')).toBe(false);
    expect(shouldAutoActivateUltrawork('브라우저 게임 만들어줘')).toBe(false);
    expect(
      shouldAutoActivateUltrawork(
        'Research latest best practices, design the architecture, implement it, run tests, and finish the goal automatically',
      ),
    ).toBe(false);
  });

  it('does not activate for simple prompts', () => {
    expect(shouldAutoActivateUltrawork('fix this typo')).toBe(false);
    expect(shouldAutoActivateUltrawork('rename this sentence')).toBe(false);
    expect(shouldAutoActivateUltrawork('what does this file do?')).toBe(false);
    expect(shouldAutoActivateUltrawork('what is ultrawork?')).toBe(false);
    expect(shouldAutoActivateUltrawork('ultrawork 뭐야?')).toBe(false);
    expect(shouldAutoActivateUltrawork('what is ultraswarm?')).toBe(false);
    expect(shouldAutoActivateUltrawork('울트라 스웜이 뭐야?')).toBe(false);
    expect(shouldAutoActivateUltrawork('explain ultrawork')).toBe(false);
    expect(shouldAutoActivateUltrawork('do not use ultrawork, just answer normally')).toBe(false);
  });
});

describe('buildUltraworkCoverageMatrix', () => {
  it('derives generic specialist lanes without making visual work the only special case', () => {
    const gameLanes = buildUltraworkCoverageMatrix(
      '갤러그 형태의 2D 게임이고 아이템도 있습니다. 비주얼 검사까지 해주세요.',
    ).map((lane) => lane.id);

    expect(gameLanes).toContain('product_requirements');
    expect(gameLanes).toContain('architecture_implementation');
    expect(gameLanes).toContain('domain_subject_matter');
    expect(gameLanes).toContain('ux_visual_content');
    expect(gameLanes).toContain('testing_evidence');
    expect(gameLanes).toContain('independent_review_loop');

    const securityLanes = buildUltraworkCoverageMatrix(
      'OAuth 로그인 보안 취약점을 고치고 권한 회귀 테스트를 추가해줘',
    ).map((lane) => lane.id);

    expect(securityLanes).toContain('security_privacy');
    expect(securityLanes).toContain('testing_evidence');
    expect(securityLanes).not.toContain('ux_visual_content');
  });
});

describe('buildUltraworkPrompt', () => {
  it('wraps the objective in the branded workflow contract', () => {
    const prompt = buildUltraworkPrompt('Ship feature X', 'manual');

    expect(prompt).toContain('<ultrawork_flow>');
    expect(prompt).toContain('Ship feature X');
    expect(prompt).toContain('Ultrawork orchestration');
    expect(prompt).toContain('UltraResearch prelude -> UltraPlan interview -> UltraGoal -> Swarm decision -> Integrate -> Verify -> Learn');
    expect(prompt).toContain('one workflow, not separate user-facing modes');
    expect(prompt).toContain('Ultrawork is the product workflow; UltraPlan, UltraGoal, Research, and Swarm decision are internal stages');
    expect(prompt).toContain('normalize it into the same Ultrawork run');
    expect(prompt).toContain('source-backed UltraResearch prelude');
    expect(prompt).toContain('hardens an already-created /goal seed into a verifiable UltraGoal contract');
    expect(prompt).toContain('force Ultra Plan mode into Research phase first');
    expect(prompt).toContain('gather current source-backed evidence before any user question options');
    expect(prompt).toContain('active_goal_already_created: false');
    expect(prompt).toContain('Shift-Tab toggles Ultrawork and off');
    expect(prompt).toContain('General /plan remains explicit steering');
    expect(prompt).toContain('/ultrawork is an explicit steering override');
    expect(prompt).toContain('UltraPlan: clarify the request until the future UltraGoal can be judged complete or incomplete as 1 or 0');
    expect(prompt).toContain('UltraPlan must produce and surface the Ouroboros plan before implementation');
    expect(prompt).toContain('Do not skip directly from one interview question into implementation');
    expect(prompt).toContain('before asking the user anything, search/fetch/read enough current evidence');
    expect(prompt).toContain('Ongoing research discipline');
    expect(prompt).toContain('do not stop researching after the prelude');
    expect(prompt).toContain('UltraResearch: when latest APIs, papers, security, benchmarks');
    expect(prompt).toContain('produce and refresh evidence packs before and during implementation');
    expect(prompt).toContain('UltraGoal: create or replace the active goal only after UltraPlan has produced the verifiable objective');
    expect(prompt).toContain('If Ultrawork is entered through /goal and an active goal already exists');
    expect(prompt).toContain('UltraSwarm: decide ENGAGE or DEFER after the verifiable UltraGoal exists');
    expect(prompt).toContain('UltraSwarm subagents may use WebSearch and FetchURL as much as their scope needs');
    expect(prompt).toContain('latest papers, framework guidance, verified libraries, security advisories');
    expect(prompt).toContain('UltraSwarm is not proof by badge');
    expect(prompt).toContain('ENGAGE is an execution commitment, not a status label');
    expect(prompt).toContain('call UltraSwarm as the only tool call before product-file edits');
    expect(prompt).toContain('Write a Swarm decision before implementation');
    expect(prompt).toContain('Swarm decision: ENGAGE|DEFER');
    expect(prompt).toContain('ENGAGE when parallel PM, architecture, TUI, QA, security, performance');
    expect(prompt).toContain('DEFER when single-agent execution is faster and lower-risk');
    expect(prompt).toContain('value: <specialist value or none>; owner: <verification owner>');
    expect(prompt).toContain('include the reason, expected specialist value or none, and verification owner');
    expect(prompt).toContain('Do not ask the user to choose /ultraplan, /ultraresearch, /ultragoal, or /ultraswarm');
    expect(prompt).toContain('When the task looks actionable, still pass the UltraPlan gate');
    expect(prompt).toContain('Treat Korean brand mentions such as 울트라플랜, 울트라리서치, 울트라골, and 울트라 스웜 as the same internal stages');
    expect(prompt).toContain('ultra-plan');
    expect(prompt).toContain('kanban');
    expect(prompt).toContain('Kimi Lean Context');
    expect(prompt).toContain('KimiContext');
    expect(prompt).toContain('codegraph');
    expect(prompt).toContain('Kimi Knowledge Map');
    expect(prompt).toContain('compact project knowledge map');
    expect(prompt).toContain('EXTRACTED, INFERRED, or AMBIGUOUS');
    expect(prompt).toContain('path/affected-style questions');
    expect(prompt).toContain('Memory / LLM Wiki observability');
    expect(prompt).toContain('Do not silently claim Learn');
    expect(prompt).toContain('Knowledge persistence ledger');
    expect(prompt).toContain('kimi_recall');
    expect(prompt).toContain('llm_wiki');
    expect(prompt).toContain('wrote`, `skipped`, or `blocked');
    expect(prompt).toContain('path/id/evidence');
    expect(prompt).toContain('never hide the only proof inside chat');
    expect(prompt).toContain('UltraResearch / Kimi Free Web Research');
    expect(prompt).toContain('no-subscription web research as a primary Ultrawork capability');
    expect(prompt).toContain('built-in WebSearch and FetchURL tools');
    expect(prompt).toContain('Re-search throughout the run, not only during UltraResearch prelude');
    expect(prompt).toContain('LocalResearchStack is always the free fallback path');
    expect(prompt).toContain('precise 3-12 keyword queries');
    expect(prompt).toContain('fetch primary sources before relying on snippets');
    expect(prompt).toContain('official docs, release notes, GitHub issues and PRs, papers, benchmark pages');
    expect(prompt).toContain('Feed verified durable findings back into Kimi Knowledge Map, memory, LLM Wiki');
    expect(prompt).toContain('Absorb Scrapling-class ideas');
    expect(prompt).toContain('CSS selector targeting, main-content extraction, screenshots, session reuse');
    expect(prompt).toContain('rendered DOM observation, screenshots, downloads, PDF extraction');
    expect(prompt).toContain(
      'user-provided authenticated sessions, and explicitly authorized test targets',
    );
    expect(prompt).toContain('do not defeat CAPTCHA, paywall, login');
    expect(prompt).toContain('without a paid search subscription or extra-cost search API');
    expect(prompt).toContain('Browser / computer-use verification');
    expect(prompt).toContain('default harness capabilities for rendered web pages, visual QA');
    expect(prompt).toContain('headless/background browser sessions and cua-driver background capture');
    expect(prompt).toContain('Prefer BrowserObserve refs and ComputerCapture SOM element indexes');
    expect(prompt).toContain('safe GUI actions may run automatically');
    expect(prompt).toContain('High-risk GUI actions still require explicit approval');
    expect(prompt).toContain('Kimi Agent Bench');
    expect(prompt).toContain('node scripts/kimi-agent-sota-gate.mjs');
    expect(prompt).toContain('node scripts/qa-super-kimi-autonomous.mjs --phase sota-gate');
    expect(prompt).toContain('C001');
    expect(prompt).toContain('C002');
    expect(prompt).toContain('C003');
    expect(prompt).toContain('pass rate');
    expect(prompt).toContain('budget/cleanup/secret-scan regression proof');
    expect(prompt).toContain('rebranded into Super Kimi internals');
    expect(prompt).toContain(
      'Do not use apps/kimi-web or browser UI paths as a success surface',
    );
    expect(prompt).toContain('Capability coverage / expert routing');
    expect(prompt).toContain('Capability Coverage Matrix');
    expect(prompt).toContain('product/requirements, domain subject matter, architecture/implementation');
    expect(prompt).toContain('Use the expert catalog as a searchable capability index');
    expect(prompt).toContain('tags, capabilities, whenToUse, and division matching');
    expect(prompt).toContain('Default Swarm decision to ENGAGE when the matrix has more than one material lane');
    expect(prompt).toContain('required_experts only for lanes whose mandatory expert is known');
    expect(prompt).toContain('Visual/game work is just one instance of this generic rule');
    expect(prompt).toContain('Do not ship placeholders unless the user explicitly asked for a prototype');
    expect(prompt).toContain('XP-lite / Definition of Done');
    expect(prompt).toContain('harness-level work contract, not optional style advice');
    expect(prompt).toContain('automated readiness, QA gates, and final reports');
    expect(prompt).toContain('Inspect the relevant files, tests, and project rules before editing');
    expect(prompt).toContain('Keep each change small, focused, and free of unrelated refactors');
    expect(prompt).toContain('Update or add focused tests before core logic changes when practical');
    expect(prompt).toContain('Public behavior changes need focused tests unless they are cosmetic or docs-only');
    expect(prompt).toContain('Run the relevant tests, typecheck, lint, build, and real-surface checks');
    expect(prompt).toContain('explicit available tools, MCP/plugin app-state capture');
    expect(prompt).toContain('Do not decide that browser/computer-use is unavailable');
    expect(prompt).toContain('Puppeteer or Playwright');
    expect(prompt).toContain('Summarize changed files, behavior, verification results, and remaining risks');
    expect(prompt).toContain('Human Writing / Anti-Slop');
    expect(prompt).toContain('harness-level output quality gate');
    expect(prompt).toContain('surface-specific voice lane');
    expect(prompt).toContain('plain specific claims, concrete nouns and verbs');
    expect(prompt).toContain('source-backed details');
    expect(prompt).toContain('self-audit for template openings');
    expect(prompt).toContain('avoid-ai-writing style checks');
    expect(prompt).toContain('product UX microcopy uses friendly 해요체');
    expect(prompt).toContain('positive-first recovery');
    expect(prompt).toContain('specific CTAs');
    expect(prompt).toContain('institutional corporate copy uses formal 합니다/습니다');
    expect(prompt).toContain('proof before emotion');
    expect(prompt).toContain('future-facing continuity');
    expect(prompt).toContain('style-analysis inputs only');
    expect(prompt).toContain('do not copy source passages');
    expect(prompt).toContain('claim official affiliation');
    expect(prompt).toContain('Do not treat AI-writing detectors as truth');
    expect(prompt).toContain('never use detector signals to accuse an author');
    expect(prompt).toContain('deterministic unslop cleanup only as advisory pattern checks');
    expect(prompt).toContain('second-pass rewrite or deterministic cleanup');
    expect(prompt).toContain('reread the result for changed meaning');
    expect(prompt).toContain('use read-only research tools plus TodoList for progress tracking and NextPhase');
    expect(prompt).toContain('use only AskUserQuestion or NextPhase');
    expect(prompt).toContain('If AskUserQuestion is unavailable or rejected by policy');
    expect(prompt).toContain('Base discrete options on research evidence when possible');
    expect(prompt).toContain('omit options for open-ended answers');
    expect(prompt).toContain('Do not cap the interview by an arbitrary question count');
    expect(prompt).toContain('continue the same Ultrawork turn toward a complete plan');
    expect(prompt).toContain('call NextPhase({ phase: "interview" }) before asking questions');
    expect(prompt).toContain('call NextPhase({ phase: "design" }) before design exploration or plan writing');
    expect(prompt).toContain('UltraGoal has been created from that plan');
    expect(prompt).toContain('call UltraSwarm as the first post-plan execution tool');
    expect(prompt).toContain('UpdateGoal');
  });

  it('marks /goal activations as already-created goal seeds', () => {
    const prompt = buildUltraworkPrompt('Ship feature X', 'goal', false, {
      activeGoalAlreadyCreated: true,
    });

    expect(prompt).toContain('activation: goal');
    expect(prompt).toContain('active_goal_already_created: true');
    expect(prompt).toContain('Do not call CreateGoal again for the same work');
    expect(prompt).toContain('use UltraPlan to make the active goal verifiable');
  });

  it('threads runtime evidence seed paths into the workflow contract', () => {
    const prompt = buildUltraworkPrompt('Ship feature X', 'manual', false, {
      evidenceSeed: {
        root: '.super-kimi/evidence/ultrawork-runs/run-1',
        wikiRootPath: '.super-kimi/wiki',
        wikiIndexPath: '.super-kimi/wiki/index.md',
        wikiManifestPath: '.super-kimi/wiki/manifest.json',
        wikiRunPath: '.super-kimi/wiki/runs/run-1.md',
        llmWikiPath: '.super-kimi/evidence/ultrawork-runs/run-1/llm-wiki.md',
        knowledgeMapPath: '.super-kimi/evidence/ultrawork-runs/run-1/kimi-knowledge-map.json',
        coverageMatrixPath: '.super-kimi/evidence/ultrawork-runs/run-1/capability-coverage-matrix.json',
        reviewLoopPath: '.super-kimi/evidence/ultrawork-runs/run-1/expert-review-loop.md',
        learnLedgerPath: '.super-kimi/evidence/ultrawork-runs/run-1/knowledge-persistence-ledger.json',
      },
    });

    expect(prompt).toContain('Runtime evidence seed was created before this turn');
    expect(prompt).toContain('llm_wiki_root: .super-kimi/wiki');
    expect(prompt).toContain('llm_wiki_index: .super-kimi/wiki/index.md');
    expect(prompt).toContain('llm_wiki_manifest: .super-kimi/wiki/manifest.json');
    expect(prompt).toContain('llm_wiki_run: .super-kimi/wiki/runs/run-1.md');
    expect(prompt).toContain('llm_wiki_seed: .super-kimi/evidence/ultrawork-runs/run-1/llm-wiki.md');
    expect(prompt).toContain('knowledge_map_seed: .super-kimi/evidence/ultrawork-runs/run-1/kimi-knowledge-map.json');
    expect(prompt).toContain('coverage_matrix_seed: .super-kimi/evidence/ultrawork-runs/run-1/capability-coverage-matrix.json');
    expect(prompt).toContain('expert_review_loop_seed: .super-kimi/evidence/ultrawork-runs/run-1/expert-review-loop.md');
    expect(prompt).toContain(
      'knowledge_persistence_ledger: .super-kimi/evidence/ultrawork-runs/run-1/knowledge-persistence-ledger.json',
    );
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

  it('keeps non-create guidance focused on Ultrawork', () => {
    const parsed = parseUltraworkCommand('status');

    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') return;
    expect(parsed.message).toContain('Ultrawork');
    expect(parsed.message).toContain('/goal status');
    expect(parsed.message).not.toMatch(/ultragoal/i);
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

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true, 'Ship feature X');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.setAppState).toHaveBeenCalledWith({ planMode: true, ultraworkMode: true });
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.setAppState).toHaveBeenCalledWith({
      activityTip: 'Ultrawork mode: research first, then UltraPlan interview, verifiable UltraGoal, Swarm decision, verify',
    });
    expect(renderedMarker(host)).toContain('Ultrawork activated');
    expect(renderedMarker(host)).toContain('Research>UltraPlan>UltraGoal>Swarm?>Integrate>Verify>Learn');
    expect(renderedMarker(host)).toContain(
      'One Ultrawork: source-backed questions, verifiable goal, decide team, verify',
    );
    expect(renderedMarker(host)).toContain(
      'Research: local fallback + provider/MCP accelerators; verified sources only',
    );
    expect(renderedMarker(host)).toContain(
      'Next: research evidence pack before UltraPlan questions',
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

  it('creates project-local LLM Wiki, knowledge-map, coverage, and review seed evidence', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-ultrawork-seed-'));
    try {
      const { host } = makeHost({ workDir });

      await handleUltraworkCommand(
        host,
        '갤러그 형태의 2D 게임이고 아이템도 있습니다. 비주얼 검사까지 해주세요.',
        'manual',
      );

      const runsRoot = join(workDir, '.super-kimi/evidence/ultrawork-runs');
      const runDirs = readdirSync(runsRoot);
      expect(runDirs).toHaveLength(1);
      const runRoot = join(runsRoot, runDirs[0] ?? '');
      const wikiIndexPath = join(workDir, '.super-kimi/wiki/index.md');
      const wikiManifestPath = join(workDir, '.super-kimi/wiki/manifest.json');
      const wikiRunPath = join(workDir, '.super-kimi/wiki/runs', `${runDirs[0] ?? ''}.md`);
      const llmWikiPath = join(runRoot, 'llm-wiki.md');
      const knowledgeMapPath = join(runRoot, 'kimi-knowledge-map.json');
      const coverageMatrixPath = join(runRoot, 'capability-coverage-matrix.json');
      const reviewLoopPath = join(runRoot, 'expert-review-loop.md');
      const learnLedgerPath = join(runRoot, 'knowledge-persistence-ledger.json');

      for (const path of [
        wikiIndexPath,
        wikiManifestPath,
        wikiRunPath,
        llmWikiPath,
        knowledgeMapPath,
        coverageMatrixPath,
        reviewLoopPath,
        learnLedgerPath,
      ]) {
        expect(existsSync(path)).toBe(true);
      }

      expect(readFileSync(llmWikiPath, 'utf8')).toContain('Current Understanding');
      expect(readFileSync(llmWikiPath, 'utf8')).toContain('.super-kimi/wiki/index.md');
      expect(readFileSync(wikiIndexPath, 'utf8')).toContain('This project-local wiki stores human-reviewable');
      expect(readFileSync(wikiRunPath, 'utf8')).toContain('Next Retrieval Hints');
      const manifest = JSON.parse(readFileSync(wikiManifestPath, 'utf8')) as {
        kind: string;
        latestRunId: string;
        runs: Array<{ path: string; llmWikiPath: string }>;
      };
      expect(manifest.kind).toBe('llm-wiki-manifest');
      expect(manifest.latestRunId).toBe(runDirs[0]);
      expect(manifest.runs[0]?.path).toBe(`.super-kimi/wiki/runs/${runDirs[0]}.md`);
      expect(manifest.runs[0]?.llmWikiPath).toContain('llm-wiki.md');
      expect(readFileSync(reviewLoopPath, 'utf8')).toContain('Review required: yes');
      const knowledgeMap = JSON.parse(readFileSync(knowledgeMapPath, 'utf8')) as Record<string, unknown>;
      expect(knowledgeMap['kind']).toBe('kimi knowledge map');
      const coverage = JSON.parse(readFileSync(coverageMatrixPath, 'utf8')) as {
        lanes: Array<{ id: string }>;
      };
      const laneIds = coverage.lanes.map((lane) => lane.id);
      expect(laneIds).toContain('domain_subject_matter');
      expect(laneIds).toContain('ux_visual_content');
      expect(laneIds).toContain('independent_review_loop');

      const prompt = (host.sendNormalUserInput as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
      expect(prompt).toContain('Runtime evidence seed was created before this turn');
      expect(prompt).toContain('.super-kimi/evidence/ultrawork-runs');
      expect(prompt).toContain('.super-kimi/wiki/index.md');
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

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true, 'Ship feature X');
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.state.appState.swarmMode).toBe(false);
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('continues when plan mode is already active', async () => {
    const { host, session } = makeHost({ planMode: true });
    session.setPlanMode.mockRejectedValueOnce(new Error('Already in plan mode'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

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

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true, 'Ship feature X');
    expect(session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(session.setPlanMode).toHaveBeenLastCalledWith(true, true, 'Ship feature X');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(host.setAppState).toHaveBeenCalledWith({ planMode: true, ultraworkMode: true });
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

    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(
      expect.stringContaining('goal_replace_requested: true'),
      { displayText: 'Ship feature Y' },
    );
  });
});
