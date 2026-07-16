import { describe, expect, it, vi } from 'vitest';

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
          provider: 'managed:kimi-api',
          model: 'kimi-k2',
          maxContextSize: 10000,
          displayName: 'Kimi K2',
        },
      },
      availableProviders: {
        'managed:kimi-api': {
          type: 'kimi',
          defaultModel: 'k2',
          oauth: {
            storage: 'file',
            key: 'managed-kimi-code',
          },
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
    expect(output).toContain('>_ SuperLiora (v1.2.3)');
    expect(output).toContain('Model        Kimi K2 (thinking high)');
    expect(output).toContain('Directory    /tmp/project');
    expect(output).toContain('Worktree     main [+12 -3 ↑1] clean');
    expect(output).toContain('Permissions  auto');
    expect(output).toMatch(/Ultrawork\s+goal active/);
    expect(output).not.toMatch(/Planning\s+Ultrawork/);
    expect(output).toContain('Session      ses-1');
    expect(output).toContain('Title        Implement status');
    expect(output).toContain('Context window');
    expect(output).toContain('25.0%');
    expect(output).toContain('(3.0K / 12.0K)');
    expect(output).toContain('Readiness');
    expect(output).toMatch(/State\s+Ready/);
    expect(output).toMatch(/Checks\s+inspect -> test -> change -> verify -> summarize/);
    expect(output).toMatch(/Workflow\s+research → interview → goal → swarm → integrate → verify → learn/);
    expect(output).toMatch(/Engine\s+UltraPlan \| UltraGoal \| Research \| Swarm decision \| Integrate \| Verify \| Learn/);
    expect(output).toMatch(/Auto\s+Shift-Tab toggles Ultrawork\/off; no regex promotion/);
    expect(output).toMatch(/Autonomy\s+bounded now -> headless target/);
    expect(output).toMatch(/Recovery\s+resumable evidence needed -> durable target/);
    expect(output).toMatch(/Tools\s+search first; load tools on demand/);
    expect(output).toMatch(/Research\s+WebSearch \+ FetchURL \+ Context7 ready \(local fallback\)/);
    expect(output).toMatch(/Bench\s+LioraBench seed\/holdout · web\/media\/ZDR · a28\/m2\/sw300\/s38/);
    expect(output).toMatch(
      /Media\s+set OPENAI_API_KEY or GOOGLE\/GEMINI_API_KEY for GenerateImage\/GenerateVideo \(no MCP\)/,
    );
    expect(output).toMatch(/Catalog\s+1 models \/ 1 providers; active managed:kimi-api/);
    expect(output).toMatch(/Memory\s+prefs \| session recall \| long-run notes \| auto-dream/);
    expect(output).toMatch(/Flow\s+███░ 3\/4 verify queued/);
    expect(output).toMatch(/Stages\s+Plan on \| Goal active \| Swarm armed \| Verify queued/);
    expect(output).toMatch(/Blockers\s+none detected/);
    expect(output).toMatch(/Scope\s+small focused diff; no broad refactor/);
    expect(output).toMatch(/Coverage\s+test public behavior changes/);
    expect(output).toMatch(/Writing\s+human voice lanes; detectors advisory-only/);
    expect(output).toMatch(/Screen check\s+open changed screen before finishing/);
    expect(output).toMatch(/Done gate\s+tests \+ typecheck\/lint\/build \+ clean diff \+ TUI/);
    expect(output).toMatch(
      /Next\s+Press Shift-Tab to toggle Ultrawork\/off, or type normally\./,
    );
    expect(output).not.toContain('Ultrawork plans, sets goal, swarms, verifies.');
    expect(output).not.toContain('helpers');
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
    expect(output).toContain('Swarm decision');
    expect(output).not.toContain('/ultraswarm');
    expect(output).toContain('Plan usage');
    expect(output).toContain('8% used');
    expect(output).not.toContain('Account');
    expect(output).not.toContain('AGENTS.md');
    expect(output).not.toContain('Runtime');
  });

  it('shows the upstream baseline under the release version', () => {
    const lines = buildStatusReportLines({
      version: '0.20.1',
      upstreamBaseline: 'kimi-code 0.22.x @ main@8fbe8553 (sync 2026-07-05, 8fbe85531b05)',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null,
      thinking: false,
      permissionMode: 'manual',
      planMode: false,
      contextUsage: 0,
      contextTokens: 0,
      maxContextTokens: 0,
      availableModels: {},
    }).map(strip);

    const output = lines.join('\n');
    expect(output).toContain('>_ SuperLiora (v0.20.1)');
    expect(output).toContain('Upstream  kimi-code 0.22.x @ main@8fbe8553 (sync 2026-07-05, 8fbe85531b05)');
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
    expect(output).toMatch(/Workflow\s+research → interview → goal → swarm → integrate → verify → learn/);
    expect(output).toMatch(/Engine\s+UltraPlan \| UltraGoal \| Research \| Swarm decision \| Integrate \| Verify \| Learn/);
    expect(output).toMatch(/Auto\s+Shift-Tab toggles Ultrawork\/off; no regex promotion/);
    expect(output).toMatch(/Autonomy\s+bounded now -> headless target/);
    expect(output).toMatch(/Recovery\s+resumable evidence needed -> durable target/);
    expect(output).toMatch(/Tools\s+search first; load tools on demand/);
    expect(output).toMatch(/Research\s+WebSearch \+ FetchURL \+ Context7 ready \(local fallback\)/);
    expect(output).toMatch(/Bench\s+LioraBench seed\/holdout · web\/media\/ZDR · a28\/m2\/sw300\/s38/);
    expect(output).toMatch(
      /Media\s+set OPENAI_API_KEY or GOOGLE\/GEMINI_API_KEY for GenerateImage\/GenerateVideo \(no MCP\)/,
    );
    expect(output).toMatch(/Memory\s+prefs \| session recall \| long-run notes \| auto-dream/);
    expect(output).toMatch(/Flow\s+███░ 3\/4 verify blocked/);
    expect(output).toMatch(/Stages\s+Plan off \| Goal ready \| Swarm off \| Verify blocked/);
    expect(output).toMatch(/Blockers\s+model setup/);
    expect(output).toMatch(/Scope\s+small focused diff; no broad refactor/);
    expect(output).toMatch(/Coverage\s+test public behavior changes/);
    expect(output).toMatch(/Writing\s+human voice lanes; detectors advisory-only/);
    expect(output).toMatch(/Screen check\s+open changed screen before finishing/);
    expect(output).toMatch(/Done gate\s+tests \+ typecheck\/lint\/build \+ clean diff \+ TUI/);
    expect(output).toMatch(/Next\s+Run \/login to add a provider, then \/model to pick one\./);
    expect(output).toMatch(/Ultrawork\s+needs readiness/);
    expect(output).not.toMatch(/Planning\s+Ultrawork/);
  });

  it('shows provider route health without exposing secret key values', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let lines: string[] = [];
    try {
      lines = buildStatusReportLines({
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
        providerRouteStatus: {
          modelAlias: 'k2',
          strategy: 'round_robin',
          candidates: [
            {
              modelAlias: 'k2',
              providerName: 'openai',
              credentialLabel: 'api_key:1',
              providerModel: 'gpt-primary',
              weight: 3,
              rateLimits: [
                {
                  name: 'requests',
                  limit: 100,
                  remaining: 0,
                  resetAt: now + 60_000,
                },
              ],
              rateLimitHeadroom: 0,
              cooldownUntil: now + 60_000,
              cooldownKind: 'rate_limit',
              lastLatencyMs: 300,
              avgLatencyMs: 140,
              lastFailureAt: now,
              failureCount: 1,
            },
            {
              modelAlias: 'k2',
              providerName: 'openai',
              credentialLabel: 'api_key:2',
              providerModel: 'gpt-backup',
              lastSuccessAt: now,
              successCount: 3,
            },
          ],
        },
      }).map(strip);
    } finally {
      vi.useRealTimers();
    }

    const output = lines.join('\n');
    expect(output).toMatch(/Route\s+round_robin 1\/2 ready; 1 cooling/);
    expect(output).toContain('Provider route');
    expect(output).toMatch(/Strategy\s+round_robin 1\/2 ready; 1 cooling/);
    expect(output).toMatch(
      /#1\s+cooling rate_limit .* openai:api_key:1 -> k2\/gpt-primary weight 3 latency 140ms headroom 0% \[requests:0\/100@1m\] \(fail 1\)/,
    );
    expect(output).toMatch(/#2\s+ready openai:api_key:2 -> k2\/gpt-backup \(ok 3\)/);
    expect(output).not.toContain('sk-real');
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

    const output = lines.join('\n');
    expect(output).toMatch(/Flow\s+███░ 3\/4 verify queued/);
    const readinessLabels = [
      'Checks',
      'Workflow',
      'Engine',
      'Auto',
      'Autonomy',
      'Recovery',
      'Tools',
      'Research',
      'Bench',
      'Catalog',
      'Memory',
      'Flow',
      'Stages',
      'Blockers',
      'Scope',
      'Coverage',
      'Writing',
      'Screen check',
      'Done gate',
    ];
    for (const label of readinessLabels) {
      const line = lines.find((candidate) => candidate.includes(label));
      expect(line, `${label} row`).toBeDefined();
      if (line === undefined) throw new Error(`${label} row missing`);
      expect(line.length, `${label} row should fit narrow terminals`).toBeLessThanOrEqual(100);
      expect(line).not.toContain('...');
    }
  });
  it('surfaces Context7 readiness when research tools are active', () => {
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
      activeToolNames: ['WebSearch', 'FetchURL', 'Context7Resolve', 'Context7Docs'],
      humanWriting: {
        ready: true,
        advisoryOnly: true,
        nextAction: 'ready',
      },
    }).map(strip);

    // Prefer the readiness Research row over the Engine gate that also contains the word Research.
    const researchRow =
      lines.find((line) => /Research\s+ready ·/.test(line) || /Research\s+WebSearch/.test(line) || /Research\s+partial/.test(line) || /Research\s+unavailable/.test(line)) ??
      lines.find((line) => line.includes('WebSearch + FetchURL'));
    expect(researchRow).toBeDefined();
    expect(researchRow ?? '').toContain('WebSearch + FetchURL active');
    expect(researchRow ?? '').toContain('Context7 on');
  });


  it('surfaces ready recovery evidence in the harness radar row', () => {
    const lines = buildStatusReportLines({
      version: '1.2.3',
      model: 'k2',
      workDir: '/tmp/project',
      sessionId: 'ses-1',
      sessionTitle: null,
      thinking: true,
      permissionMode: 'auto',
      planMode: false,
      contextUsage: 0.1,
      contextTokens: 1000,
      maxContextTokens: 10000,
      availableModels: {},
      recovery: {
        ready: true,
        nextAction: 'Recovery evidence ready.',
        evidencePath: '.superliora/evidence/sota/sota-gate-summary.json',
      },
    }).map(strip);

    expect(lines.join('\n')).toMatch(/Recovery\s+resumable evidence ready -> durable target/);
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
    expect(output).toMatch(/Flow\s+████ 4\/4 ready to run/);
    expect(output).toMatch(/Stages\s+Plan off \| Goal ready \| Swarm decision pending \| Verify ready/);
    expect(output).toMatch(/Blockers\s+none detected/);
    expect(output).toMatch(
      /Next\s+Press Shift-Tab to toggle Ultrawork\/off, or type normally\./,
    );
    expect(output).not.toContain('Ultrawork plans, sets goal, swarms, verifies.');
    expect(output).not.toContain('helpers');
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
    expect(output).toMatch(/Flow\s+███░ 3\/4 verify blocked/);
    expect(output).toMatch(/Stages\s+Plan off \| Goal ready \| Swarm off \| Verify blocked/);
    expect(output).toMatch(/Blockers\s+context high/);
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
    expect(output).toMatch(/Flow\s+███░ 3\/4 verify blocked/);
    expect(output).toMatch(/Stages\s+Plan on \| Goal ready \| Swarm off \| Verify blocked/);
    expect(output).toMatch(/Blockers\s+worktree dirty/);
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
    expect(output).toMatch(/Flow\s+███░ 3\/4 verify blocked/);
    expect(output).toMatch(/Stages\s+Plan off \| Goal ready \| Swarm off \| Verify blocked/);
    expect(output).toMatch(/Blockers\s+writing guidance/);
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
    expect(output).toMatch(/State\s+Goal blocked/);
    expect(output).toMatch(/Flow\s+███░ 3\/4 verify blocked/);
    expect(output).toMatch(/Stages\s+Plan on \| Goal blocked \| Swarm off \| Verify blocked/);
    expect(output).toMatch(/Blockers\s+goal blocked/);
    expect(output).toMatch(/Next\s+Resolve or replace the blocked goal before continuing\./);
  });

  it('includes Context OS health when compacted pages exist', () => {
    const lines = buildStatusReportLines({
      version: '0.0.0-test',
      model: 'test-model',
      workDir: '/tmp/work',
      sessionId: 'sess-1',
      sessionTitle: null,
      thinking: false,
      permissionMode: 'manual',
      planMode: false,
      contextUsage: 0.1,
      contextTokens: 1000,
      maxContextTokens: 10000,
      availableModels: {},
      contextOS: {
        pageCount: 2,
        readyPageCount: 1,
        needsRehydrationPageCount: 1,
        atRiskPageCount: 0,
        missingEvidencePageCount: 1,
        evidenceIdRecallScore: 0.5,
        latestContinuityStatus: 'needs_rehydration',
      },
    });
    const joined = lines.join('\n');
    expect(joined).toContain('Context OS');
    expect(joined).toContain('needs_rehydration');
    expect(joined).toContain('evidence 0.50');
    expect(joined).toContain('missing 1');
  });

  it('includes Micro clear when micro-compaction has fired', () => {
    const lines = buildStatusReportLines({
      version: '0.0.0-test',
      model: 'test-model',
      workDir: '/tmp/work',
      sessionId: 'sess-1',
      sessionTitle: null,
      thinking: false,
      permissionMode: 'manual',
      planMode: false,
      contextUsage: 0.1,
      contextTokens: 1000,
      maxContextTokens: 10000,
      availableModels: {},
      microCompaction: {
        total: 4,
        lastTrigger: 'swarm_pressure',
        lastContextUsageRatio: 0.8,
        byTrigger: { swarm_pressure: 3, usage_pressure: 1 },
      },
    });
    const joined = lines.join('\n');
    expect(joined).toContain('Micro clear');
    expect(joined).toContain('4 clears');
    expect(joined).toContain('swarm_pressure');
  });

  it('shows privacy/ZDR posture when telemetry flag is known', () => {
    const on = buildStatusReportLines({
      version: '0.0.0-test',
      model: 'test-model',
      workDir: '/tmp/work',
      sessionId: 'sess-1',
      sessionTitle: null,
      thinking: false,
      permissionMode: 'manual',
      planMode: false,
      contextUsage: 0.1,
      contextTokens: 1000,
      maxContextTokens: 10000,
      availableModels: {},
      privacyTelemetryEnabled: true,
    }).join('\n');
    expect(on).toContain('Privacy');
    expect(on).toContain('Telemetry ON');

    const off = buildStatusReportLines({
      version: '0.0.0-test',
      model: 'test-model',
      workDir: '/tmp/work',
      sessionId: 'sess-1',
      sessionTitle: null,
      thinking: false,
      permissionMode: 'manual',
      planMode: false,
      contextUsage: 0.1,
      contextTokens: 1000,
      maxContextTokens: 10000,
      availableModels: {},
      privacyTelemetryEnabled: false,
    }).join('\n');
    expect(off).toContain('Telemetry OFF');
  });
});
