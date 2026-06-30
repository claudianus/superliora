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
    expect(output).toMatch(/Workflow\s+Kimi chooses planning, goal tracking, or team mode as needed\./);
    expect(output).toMatch(/Scope\s+small focused diff; no broad refactor/);
    expect(output).toMatch(/Coverage\s+test public behavior changes/);
    expect(output).toMatch(/Screen check\s+open changed screen before finishing/);
    expect(output).toMatch(/Done gate\s+tests\/typecheck\/lint\/build \+ clean diff \+ TUI/);
    expect(output).toMatch(/Next\s+Describe the task; Kimi will plan first\./);
    expect(output).not.toContain('Advanced');
    expect(output).not.toContain('manual workflow commands');
    expect(output).not.toContain('Diagnostics');
    expect(output).not.toContain('harness QA');
    expect(output).not.toContain('internal QA');
    expect(output).not.toContain('/preflight');
    expect(output).not.toContain('/bench');
    expect(output).not.toContain('/ultrawork');
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
    expect(output).toMatch(/Workflow\s+Kimi chooses planning, goal tracking, or team mode as needed\./);
    expect(output).toMatch(/Scope\s+small focused diff; no broad refactor/);
    expect(output).toMatch(/Coverage\s+test public behavior changes/);
    expect(output).toMatch(/Screen check\s+open changed screen before finishing/);
    expect(output).toMatch(/Done gate\s+tests\/typecheck\/lint\/build \+ clean diff \+ TUI/);
    expect(output).toMatch(/Next\s+Run \/login or \/provider first; use \/model after sign-in\./);
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
    expect(output).toMatch(/Next\s+Review changed files before finishing\./);
  });
});
