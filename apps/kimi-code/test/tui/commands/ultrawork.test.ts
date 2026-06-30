import { describe, expect, it, vi } from 'vitest';

import {
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
        permissionMode: overrides.permissionMode ?? 'auto',
        planMode: overrides.planMode ?? false,
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
    expect(
      shouldAutoActivateUltrawork(
        'Research latest best practices, design the architecture, implement it, run tests, and finish the goal automatically',
      ),
    ).toBe(true);
  });

  it('activates for plain actionable vibe-coding requests', () => {
    expect(shouldAutoActivateUltrawork('Implement the settings panel and verify it works')).toBe(true);
    expect(shouldAutoActivateUltrawork('Fix the TUI status panel bug and run tests')).toBe(true);
    expect(shouldAutoActivateUltrawork('이 기능 만들어서 테스트까지 돌려줘')).toBe(true);
    expect(shouldAutoActivateUltrawork('TUI 자동완성 버그 고치고 검수해줘')).toBe(true);
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

describe('buildUltraworkPrompt', () => {
  it('wraps the objective in the branded workflow contract', () => {
    const prompt = buildUltraworkPrompt('Ship feature X', 'manual');

    expect(prompt).toContain('<ultrawork_flow>');
    expect(prompt).toContain('Ship feature X');
    expect(prompt).toContain('Ultrawork orchestration');
    expect(prompt).toContain('UltraPlan -> UltraGoal -> UltraSwarm');
    expect(prompt).toContain('one workflow, not separate user-facing modes');
    expect(prompt).toContain('automatically links and activates UltraPlan, UltraGoal, UltraSwarm');
    expect(prompt).toContain('create or replace the UltraGoal, enable UltraPlan, arm UltraSwarm');
    expect(prompt).toContain('Normal task text is the preferred entry point');
    expect(prompt).toContain('/ultrawork is an advanced steering override');
    expect(prompt).toContain('UltraPlan: clarify ambiguous or large requests');
    expect(prompt).toContain('UltraGoal: keep the active goal as the durable execution contract');
    expect(prompt).toContain('UltraSwarm: auto-engage specialist agents');
    expect(prompt).toContain('UltraSwarm is armed by Ultrawork setup');
    expect(prompt).toContain('proactively invoke specialist agents');
    expect(prompt).toContain('Do not ask the user to choose /ultraplan, /ultragoal, or /ultraswarm');
    expect(prompt).toContain('When the task is already actionable, do not stall in UltraPlan');
    expect(prompt).toContain('Treat Korean brand mentions such as 울트라플랜, 울트라골, and 울트라 스웜 as the same internal stages');
    expect(prompt).toContain('ultra-plan');
    expect(prompt).toContain('kanban');
    expect(prompt).toContain('Kimi Lean Context');
    expect(prompt).toContain('KimiContext');
    expect(prompt).toContain('codegraph');
    expect(prompt).toContain('Kimi Knowledge Map');
    expect(prompt).toContain('compact project knowledge map');
    expect(prompt).toContain('EXTRACTED, INFERRED, or AMBIGUOUS');
    expect(prompt).toContain('path/affected-style questions');
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
    expect(prompt).toContain('XP-lite / Definition of Done');
    expect(prompt).toContain('harness-level work contract, not optional style advice');
    expect(prompt).toContain('automated readiness, QA gates, and final reports');
    expect(prompt).toContain('Inspect the relevant files, tests, and project rules before editing');
    expect(prompt).toContain('Keep each change small, focused, and free of unrelated refactors');
    expect(prompt).toContain('Update or add focused tests before core logic changes when practical');
    expect(prompt).toContain('Public behavior changes need focused tests unless they are cosmetic or docs-only');
    expect(prompt).toContain('Run the relevant tests, typecheck, lint, build, and real-surface checks');
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
    expect(prompt).toContain('use only AskUserQuestion or NextPhase');
    expect(prompt).toContain('If AskUserQuestion is unavailable or rejected by policy');
    expect(prompt).toContain('at most 4 options per question');
    expect(prompt).toContain('Never ask more than 3 total interview questions');
    expect(prompt).toContain('continue the same Ultrawork turn toward implementation');
    expect(prompt).toContain('call NextPhase before any search, read, edit, shell, or skill tool');
    expect(prompt).toContain('UpdateGoal');
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
  it('creates an ultragoal, enables ultra plan and swarm, then sends the workflow prompt', async () => {
    const { host, session } = makeHost();

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

    expect(session.createGoal).toHaveBeenCalledWith({
      objective: 'Ship feature X',
      replace: false,
    });
    expect(session.setPlanMode).toHaveBeenCalledWith(true, true);
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(host.setAppState).toHaveBeenCalledWith({ planMode: true });
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.setAppState).toHaveBeenCalledWith({
      activityTip: 'Ultrawork auto-orchestrates UltraPlan, UltraGoal, UltraSwarm, Verify',
    });
    expect(renderedMarker(host)).toContain('Ultrawork activated');
    expect(renderedMarker(host)).toContain('UltraPlan -> UltraGoal -> UltraSwarm -> Verify');
    expect(renderedMarker(host)).toContain(
      'Auto-orchestrated: UltraPlan | UltraGoal | UltraSwarm | Verify',
    );
    expect(renderedMarker(host)).toContain('Ship feature X');
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(expect.stringContaining('Ship feature X'));
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(expect.stringContaining('<ultrawork_flow>'));
  });

  it('does not create a goal when ultra-plan setup fails', async () => {
    const { host, session } = makeHost();
    session.setPlanMode.mockRejectedValueOnce(new Error('plan denied'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setPlanMode).toHaveBeenCalledWith(true, true);
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(session.setSwarmMode).toHaveBeenLastCalledWith(false, 'task');
    expect(host.state.appState.swarmMode).toBe(false);
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('continues when plan mode is already active', async () => {
    const { host, session } = makeHost({ planMode: true });

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

    expect(session.setPlanMode).not.toHaveBeenCalled();
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.createGoal).toHaveBeenCalledWith({
      objective: 'Ship feature X',
      replace: false,
    });
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(expect.stringContaining('<ultrawork_flow>'));
  });

  it('continues when session state is already in plan mode but app state is stale', async () => {
    const { host, session } = makeHost({ planMode: false });
    session.setPlanMode.mockRejectedValueOnce(new Error('Already in plan mode'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true);
    expect(host.setAppState).toHaveBeenCalledWith({ planMode: true });
    expect(session.createGoal).toHaveBeenCalledWith({
      objective: 'Ship feature X',
      replace: false,
    });
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(expect.stringContaining('<ultrawork_flow>'));
  });

  it('rolls back ultrawork setup when goal creation fails', async () => {
    const { host, session } = makeHost();
    session.createGoal.mockRejectedValueOnce(new Error('goal denied'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setPlanMode).toHaveBeenCalledWith(true, true);
    expect(session.setPlanMode).toHaveBeenLastCalledWith(false, false);
    expect(session.setSwarmMode).toHaveBeenLastCalledWith(false, 'task');
    expect(host.state.appState.planMode).toBe(false);
    expect(host.state.appState.swarmMode).toBe(false);
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('supports replace mode for /ultragoal', async () => {
    const { host, session } = makeHost();

    await handleUltraworkCommand(host, 'replace Ship feature Y', 'manual');

    expect(session.createGoal).toHaveBeenCalledWith({
      objective: 'Ship feature Y',
      replace: true,
    });
  });
});
