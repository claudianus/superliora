import { describe, expect, it } from 'vitest';

import { buildStatusReportLines } from '#/tui/components/messages/status-panel';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('status panel report lines', () => {
  it('formats runtime status, context, and managed usage without account or AGENTS.md rows', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: 'Implement status',
      thinking: true,
      permissionMode: 'manual',
      planMode: false,
      swarmMode: true,
      goalStatus: 'active',
      contextUsage: 0.25,
      contextTokens: 2500,
      maxContextTokens: 10000,
      availableModels: {
        k2: {
          provider: 'managed:kimi-code',
          model: 'kimi-k2',
          maxContextSize: 10000,
          displayName: 'Kimi K2',
        },
      },
      status: {
        model: 'k2',
        thinkingLevel: 'high',
        permission: 'auto',
        planMode: true,
        contextTokens: 3000,
        maxContextTokens: 12000,
        contextUsage: 0.25,
      },
      gitStatus: {
        branch: 'main',
        dirty: false,
        ahead: 1,
        behind: 0,
        diffAdded: 12,
        diffDeleted: 3,
        pullRequest: null,
      },
      managedUsage: {
        summary: null,
        limits: [
          {
            label: '5h limit',
            used: 8,
            limit: 100,
            resetHint: 'resets in 1h',
          },
        ],
      },
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toContain('>_ Kimi Code (v1.2.3)');
    expect(output).toContain('Model        Kimi K2 (thinking on)');
    expect(output).toContain('Directory    /tmp/project');
    expect(output).toContain('Worktree     main [+12 -3 ↑1] clean');
    expect(output).toContain('Permissions  auto');
    expect(output).toContain('Plan mode    on');
    expect(output).toContain('Session      ses-1');
    expect(output).toContain('Title        Implement status');
    expect(output).toContain('Context window');
    expect(output).toContain('25.0%');
    expect(output).toContain('(3.0k / 12.0k)');
    expect(output).toContain('Readiness');
    expect(output).toMatch(/State\s+Ready/);
    expect(output).toMatch(/Checks\s+inspect -> test -> change -> verify -> summarize/);
    expect(output).toMatch(/Workflow\s+UltraPlan -> UltraGoal -> UltraSwarm -> Verify/);
    expect(output).toMatch(/Stages\s+Plan on \| Goal active \| Swarm armed \| Verify queued/);
    expect(output).toMatch(/Scope\s+small focused diff; no broad refactor/);
    expect(output).toMatch(/Coverage\s+test public behavior changes/);
    expect(output).toMatch(/Writing\s+human voice lanes; detectors advisory-only/);
    expect(output).toMatch(/Screen check\s+open changed screen before finishing/);
    expect(output).toMatch(/Done gate\s+tests \+ typecheck\/lint\/build \+ clean diff \+ TUI/);
    expect(output).toMatch(/Next\s+Describe task; Ultrawork links plan, goal, swarm, verify\./);
    expect(output).not.toContain('Advanced');
    expect(output).not.toContain('manual workflow commands');
    expect(output).not.toContain('Diagnostics');
    expect(output).not.toContain('harness QA');
    expect(output).not.toContain('internal QA');
    expect(output).not.toContain('/preflight');
    expect(output).not.toContain('/bench');
    expect(output).toContain('Ultrawork');
    expect(output).toContain('UltraPlan');
    expect(output).toContain('UltraGoal');
    expect(output).toContain('UltraSwarm');
    expect(output).not.toContain('/ultraswarm');
    expect(output).toContain('Plan usage');
    expect(output).toContain('8% used');
    expect(output).not.toContain('Account');
    expect(output).not.toContain('AGENTS.md');
    expect(output).not.toContain('Runtime');
  });

  it('falls back to app state and shows status load errors as warnings', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: '',
      workDir: '/tmp/project',
      sessionId: '',
      sessionTitle: null,
      thinking: false,
      permissionMode: 'manual',
      planMode: false,
      contextUsage: 0,
      contextTokens: 0,
      maxContextTokens: 0,
      availableModels: {},
      statusError: 'No active session',
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toContain('Model        not set');
    expect(output).toContain('Session      none');
    expect(output).toContain('Warning      No active session');
    expect(output).toContain('No context window data available.');
    expect(output).toMatch(/State\s+Model needed/);
    expect(output).toMatch(/Checks\s+inspect -> test -> change -> verify -> summarize/);
    expect(output).toMatch(/Workflow\s+UltraPlan -> UltraGoal -> UltraSwarm -> Verify/);
    expect(output).toMatch(/Stages\s+Plan off \| Goal ready \| Swarm standby \| Verify blocked/);
    expect(output).toMatch(/Scope\s+small focused diff; no broad refactor/);
    expect(output).toMatch(/Coverage\s+test public behavior changes/);
    expect(output).toMatch(/Writing\s+human voice lanes; detectors advisory-only/);
    expect(output).toMatch(/Screen check\s+open changed screen before finishing/);
    expect(output).toMatch(/Done gate\s+tests \+ typecheck\/lint\/build \+ clean diff \+ TUI/);
    expect(output).toMatch(/Next\s+Run \/login or \/provider first; use \/model after sign-in\./);
  });

  it('keeps readiness gate values compact enough for an 80 column status panel', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null,
      thinking: true,
      permissionMode: 'manual',
      planMode: true,
      contextUsage: 0.1,
      contextTokens: 1000,
      maxContextTokens: 10000,
      availableModels: {},
      humanWriting: {
        ready: true,
        advisoryOnly: true,
        nextAction: 'ready',
      },
    }).map(strip);

    const readinessLabels = ['Checks', 'Workflow', 'Stages', 'Scope', 'Coverage', 'Writing', 'Screen check', 'Done gate'];
    for (const label of readinessLabels) {
      const line = lines.find((candidate) => candidate.includes(label));
      expect(line, `${label} row`).toBeDefined();
      if (line === undefined) throw new Error(`${label} row missing`);
      expect(line.length, `${label} row should fit narrow terminals`).toBeLessThanOrEqual(72);
      expect(line).not.toContain('...');
    }
  });

  it('keeps ready next action on Ultrawork even before plan mode is enabled', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null,
      thinking: true,
      permissionMode: 'auto',
      planMode: false,
      swarmMode: false,
      contextUsage: 0.1,
      contextTokens: 1000,
      maxContextTokens: 10000,
      availableModels: {},
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toMatch(/State\s+Ready/);
    expect(output).toMatch(/Stages\s+Plan auto \| Goal ready \| Swarm auto \| Verify ready/);
    expect(output).toMatch(/Next\s+Describe task; Ultrawork links plan, goal, swarm, verify\./);
    expect(output).not.toContain('/ultrawork');
  });

  it('surfaces context pressure as the next readiness action', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null,
      thinking: true,
      permissionMode: 'manual',
      planMode: false,
      contextUsage: 0.9,
      contextTokens: 9000,
      maxContextTokens: 10000,
      availableModels: {},
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toMatch(/State\s+Context high/);
    expect(output).toMatch(/Stages\s+Plan off \| Goal ready \| Swarm standby \| Verify blocked/);
    expect(output).toMatch(/Next\s+Run \/compact before long work\./);
  });

  it('surfaces a dirty worktree as the next readiness action', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null,
      thinking: true,
      permissionMode: 'manual',
      planMode: true,
      contextUsage: 0.1,
      contextTokens: 1000,
      maxContextTokens: 10000,
      availableModels: {},
      gitStatus: {
        branch: 'feature',
        dirty: true,
        ahead: 0,
        behind: 0,
        diffAdded: 0,
        diffDeleted: 0,
        pullRequest: null,
      },
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toContain('Worktree     feature [±] dirty');
    expect(output).toMatch(/State\s+Worktree dirty/);
    expect(output).toMatch(/Stages\s+Plan on \| Goal ready \| Swarm standby \| Verify blocked/);
    expect(output).toMatch(/Next\s+Review changed files before finishing\./);
  });

  it('surfaces blocked writing guidance without exposing internal command names', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null,
      thinking: true,
      permissionMode: 'manual',
      planMode: false,
      contextUsage: 0.1,
      contextTokens: 1000,
      maxContextTokens: 10000,
      availableModels: {},
      humanWriting: {
        ready: false,
        advisoryOnly: false,
        nextAction: 'Restore writing-quality guidance before long autonomous work.',
      },
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toMatch(/State\s+Writing guidance blocked/);
    expect(output).toMatch(/Stages\s+Plan off \| Goal ready \| Swarm standby \| Verify blocked/);
    expect(output).toMatch(/Writing\s+voice-lane guidance blocked; detectors must stay advisory-only/);
    expect(output).toMatch(/Next\s+Restore writing-quality guidance before long autonomous work\./);
    expect(output).not.toContain('/preflight');
    expect(output).not.toContain('/bench');
    expect(output).not.toContain('/ultrawork');
    expect(output).not.toContain('/ultraswarm');
    expect(output).not.toContain('harness QA');
    expect(output).not.toContain('internal QA');
  });

  it('surfaces blocked goal state in Ultrawork stages', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null,
      thinking: true,
      permissionMode: 'manual',
      planMode: true,
      swarmMode: false,
      goalStatus: 'blocked',
      contextUsage: 0.1,
      contextTokens: 1000,
      maxContextTokens: 10000,
      availableModels: {},
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toMatch(/Stages\s+Plan on \| Goal blocked \| Swarm standby \| Verify blocked/);
  });
});
