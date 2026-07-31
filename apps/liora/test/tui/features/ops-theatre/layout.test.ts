import { describe, expect, it, afterEach } from 'vitest';

import {
  buildOpsTheatreInterventionTray,
  buildOpsTheatrePanes,
  collectOpsGitDiffSnippetLines,
  formatOpsGitDiffSnippetLines,
  resolveOpsMissionRunLine,
  type OpsTheatreInput,
} from '#/tui/features/ops-theatre/build-panes';
import {
  DEFAULT_OPS_THEATRE_WIDTH,
  MIN_OPS_THEATRE_WIDTH,
  renderOpsTheatreGrid,
} from '#/tui/features/ops-theatre/layout';
import { FLEET_DUAL_EMIT_ENV, fleetDualEmitStatusLine, MISSION_DUAL_EMIT_ENV, missionDualEmitStatusLine, VERIFICATION_SENSOR_GOAL_DONE_TIP } from '@superliora/sdk';
import {
  OPS_FLEET_MAKER_CHECKER_SOFT_TIP,
  OPS_FLEET_COST_GUARD_TIP,
  OPS_FLEET_PARALLEL_FANOUT_TIP,
} from '#/tui/utils/fleet/fleet-glance';
import { PERMISSION_AUTO_EXPIRE_ENV } from '#/tui/utils/never-halt/intervention-glance';

function sampleInput(overrides: Partial<OpsTheatreInput> = {}): OpsTheatreInput {
  return {
    refreshedAt: '10:00:00 AM',
    sessionsLine: 'Sessions: 2 in workspace',
    goal: { status: 'active', objective: 'Ship Ops Theatre grid', xpGlance: { turnsUsed: 2 } },
    git: {
      branch: 'main',
      dirty: true,
      changedFileCount: 5,
      diffAdded: 12,
      diffDeleted: 3,
      ahead: 1,
      behind: 0,
    },
    cwd: '/tmp/superliora',
    mcpLine: 'MCP: 1/2 connected · 1 need attention',
    cacheHitLine: 'Cache hit: 88%',
    cachePrefixLine: null,
    cacheMissReasonLine: null,
    cacheFreezeLine: null,
    tokenGlanceLine: 'Tokens: in 12.3K · out 1.2K · cache 99%',
    lastStepTtftLine: null,
    breakerLine: 'Breakers: (no trips) · breakers: see /settings never-halt',
    authLine: 'Auth: ok',
    routeLine: null,
    search: { configured: ['brave'], searchDegraded: false, lateChannelSuffix: '', cascadeLine: null, researchHopsLine: null },
    degraded: null,
    model: 'gpt-test',
    permissionMode: 'manual',
    pendingApprovalToolName: null,
    missionDualEmitLine: missionDualEmitStatusLine({}),
    fleetDualEmitLine: fleetDualEmitStatusLine({}),
    ...overrides,
  };
}

function lineWidth(line: string): number {
  return line.length;
}

describe('formatOpsGitDiffSnippetLines', () => {
  it('skips context rows and caps output lines', () => {
    expect(
      formatOpsGitDiffSnippetLines([
        { kind: 'context', code: 'unchanged' },
        { kind: 'add', code: 'added' },
        { kind: 'delete', code: 'removed' },
      ]),
    ).toEqual(['+added', '−removed']);
    expect(
      formatOpsGitDiffSnippetLines(
        [
          { kind: 'add', code: 'one' },
          { kind: 'add', code: 'two' },
          { kind: 'add', code: 'three' },
          { kind: 'add', code: 'four' },
          { kind: 'add', code: 'five' },
        ],
        4,
      ),
    ).toHaveLength(4);
  });

  it('collects snippet lines across files', () => {
    expect(
      collectOpsGitDiffSnippetLines([
        { lines: [{ kind: 'add', code: 'a' }] },
        { lines: [{ kind: 'delete', code: 'b' }] },
      ]),
    ).toEqual(['+a', '−b']);
  });
});

describe('renderOpsTheatreGrid', () => {
  it('renders a 2×2 bordered grid with pane titles', () => {
    const panes = buildOpsTheatrePanes(sampleInput());
    const lines = renderOpsTheatreGrid(panes);

    expect(lines[0]).toMatch(/^┌─ Fleet \/ Agents ─+/);
    expect(lines[0]).toContain('┬');
    expect(lines[0]).toContain('Mission / Goal');
    expect(lines[0]?.endsWith('┐')).toBe(true);

    const mid = lines.find((line) => line.startsWith('├'));
    expect(mid).toBeDefined();
    expect(mid).toContain('Git / Workspace');
    expect(mid).toContain('Runtime Health');
    expect(mid).toContain('┼');
    expect(mid?.endsWith('┤')).toBe(true);

    expect(lines.at(-1)).toMatch(/^└─+/);
    expect(lines.at(-1)).toContain('┴');
    expect(lines.at(-1)?.endsWith('┘')).toBe(true);

    expect(lines.some((line) => line.startsWith('│') && line.includes('Sessions:'))).toBe(true);
    expect(lines.some((line) => line.startsWith('│') && line.includes('Goal:'))).toBe(true);
    expect(lines.some((line) => line.startsWith('│') && line.includes('Cache hit:'))).toBe(true);
  });

  it('keeps every grid row within the requested width', () => {
    for (const width of [MIN_OPS_THEATRE_WIDTH, 60, DEFAULT_OPS_THEATRE_WIDTH, 120]) {
      const panes = buildOpsTheatrePanes(sampleInput());
      const lines = renderOpsTheatreGrid(panes, width);
      for (const line of lines) {
        expect(lineWidth(line)).toBe(width);
      }
    }
  });

  it('clamps width below the minimum', () => {
    const panes = buildOpsTheatrePanes(sampleInput());
    const lines = renderOpsTheatreGrid(panes, 12);
    for (const line of lines) {
      expect(lineWidth(line)).toBe(MIN_OPS_THEATRE_WIDTH);
    }
  });

  it('truncates overflowing pane content deterministically', () => {
    const longObjective = 'A'.repeat(200);
    const panes = buildOpsTheatrePanes(
      sampleInput({
        goal: { status: 'active', objective: longObjective },
        git: null,
        cwd: '/'.repeat(200),
      }),
    );
    const lines = renderOpsTheatreGrid(panes, 50);

    const contentLines = lines.filter((line) => line.startsWith('│'));
    for (const line of contentLines) {
      expect(lineWidth(line)).toBe(50);
    }

    const goalRow = contentLines.find((line) => line.includes('Goal:'));
    expect(goalRow).toBeDefined();
    expect(goalRow).toContain('…');
    expect(goalRow).not.toContain(longObjective);
  });

  it('appends late-channel suffix to Runtime Health search line', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        search: {
          configured: [],
          searchDegraded: false,
          lateChannelSuffix: ' · Ch5 chrome-ext ON',
          cascadeLine: null,
          researchHopsLine: null,
        },
      }),
    );
    expect(panes.health.join('\n')).toContain('Ch5 chrome-ext ON');
  });

  it('appends Ch5 smoke-verified suffix to Runtime Health search line', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        search: {
          configured: [],
          searchDegraded: false,
          lateChannelSuffix: ' · Ch5 smoke verified (0.1.0-stub)',
          cascadeLine: null,
          researchHopsLine: null,
        },
      }),
    );
    expect(panes.health.join('\n')).toContain('Ch5 smoke verified (0.1.0-stub)');
  });

  it('shows cascade line in Runtime Health when present', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        search: {
          configured: ['brave'],
          searchDegraded: true,
          lateChannelSuffix: '',
          cascadeLine: 'Cascade: ch1→ch4',
          researchHopsLine: null,
        },
      }),
    );
    expect(panes.health.join('\n')).toContain('Cascade: ch1→ch4');
  });

  it('shows research hops line in Runtime Health when present', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        search: {
          configured: ['brave'],
          searchDegraded: false,
          lateChannelSuffix: '',
          cascadeLine: null,
          researchHopsLine: 'Research hops: 3',
        },
      }),
    );
    expect(panes.health.join('\n')).toContain('Research hops: 3');
  });

  it('shows cascade fallback in Runtime Health when search degraded without live cascade', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        search: {
          configured: ['brave'],
          searchDegraded: true,
          lateChannelSuffix: '',
          cascadeLine: null,
          researchHopsLine: null,
        },
      }),
    );
    expect(panes.health.join('\n')).toContain('Cascade: never-empty · Ch4 browser · Ch5 chrome-ext');
  });

  it('shows never-empty telemetry line in Runtime Health when counters exist', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        search: {
          configured: ['brave'],
          searchDegraded: true,
          lateChannelSuffix: '',
          cascadeLine: 'Cascade: ch1→ch3',
          researchHopsLine: null,
          neverEmptyTelemetryLine: 'Never-empty: hard-fail 0 · soft-degrade 2',
        },
      }),
    );
    expect(panes.health.join('\n')).toContain('Never-empty: hard-fail 0 · soft-degrade 2');
  });

  it('omits never-empty telemetry line when counters are absent', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        search: {
          configured: ['brave'],
          searchDegraded: false,
          lateChannelSuffix: '',
          cascadeLine: null,
          researchHopsLine: null,
          neverEmptyTelemetryLine: null,
        },
      }),
    );
    expect(panes.health.join('\n')).not.toContain('Never-empty:');
  });

  it('shows LocalResearchCache hit line in Runtime Health when telemetry exists', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        search: {
          configured: ['brave'],
          searchDegraded: false,
          lateChannelSuffix: '',
          cascadeLine: null,
          researchHopsLine: null,
          localResearchCacheHitLine: 'LocalResearchCache: hit 80% · 4/5 lookups',
        },
      }),
    );
    expect(panes.health.join('\n')).toContain('LocalResearchCache: hit 80% · 4/5 lookups');
  });

  it('omits LocalResearchCache hit line when telemetry is absent', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        search: {
          configured: ['brave'],
          searchDegraded: false,
          lateChannelSuffix: '',
          cascadeLine: null,
          researchHopsLine: null,
          localResearchCacheHitLine: null,
        },
      }),
    );
    expect(panes.health.join('\n')).not.toContain('LocalResearchCache:');
  });

  it('shows cache prefix line in Runtime Health when present', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({ cachePrefixLine: 'Prefix: tool block changed' }),
    );
    expect(panes.health.join('\n')).toContain('Prefix: tool block changed');
  });

  it('shows cache miss-reason histogram in Runtime Health when present', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        cacheMissReasonLine: 'Miss reasons: prefix_drift 67% · model_switch 33%',
      }),
    );
    expect(panes.health.join('\n')).toContain('Miss reasons: prefix_drift 67%');
  });

  it('omits cache miss-reason line when cacheMissReasonLine is null', () => {
    const panes = buildOpsTheatrePanes(sampleInput({ cacheMissReasonLine: null }));
    expect(panes.health.join('\n')).not.toContain('Miss reasons:');
  });

  it('shows last TTFT line in Runtime Health when wired from appState', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        lastStepTtftLine: 'Last TTFT: 180ms (turn 4 step 1) · in-process path',
      }),
    );
    expect(panes.health.join('\n')).toContain('Last TTFT: 180ms (turn 4 step 1) · in-process path');
  });

  it('omits last TTFT line when lastStepTtftLine is null', () => {
    const panes = buildOpsTheatrePanes(sampleInput({ lastStepTtftLine: null }));
    expect(panes.health.join('\n')).not.toContain('Last TTFT:');
  });

  it('shows live breaker open count in Runtime Health when wired from AppState', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        breakerLine: 'Breakers: 2 open · 1 half · 3 closed · last: brave 429',
      }),
    );
    expect(panes.health.join('\n')).toContain('Breakers: 2 open · 1 half · 3 closed');
  });

  it('falls back to breaker tip when AppState registry is absent', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        breakerLine: 'Breakers: (no trips) · breakers: see /settings never-halt',
      }),
    );
    expect(panes.health.join('\n')).toContain('Breakers: (no trips)');
    expect(panes.health.join('\n')).toContain('breakers: see /settings never-halt');
  });

  it('shows cache freeze line in Runtime Health when present', () => {
    const idle = buildOpsTheatrePanes(
      sampleInput({ cacheFreezeLine: 'Freeze: idle' }),
    );
    expect(idle.health.join('\n')).toContain('Freeze: idle');

    const active = buildOpsTheatrePanes(
      sampleInput({ cacheFreezeLine: 'Freeze: active (mid-turn)' }),
    );
    expect(active.health.join('\n')).toContain('Freeze: active (mid-turn)');
  });

  it('omits cache freeze line when cacheFreezeLine is null', () => {
    const panes = buildOpsTheatrePanes(sampleInput({ cacheFreezeLine: null }));
    expect(panes.health.join('\n')).not.toContain('Freeze:');
  });

  it('shows auth line in Runtime Health', () => {
    const ok = buildOpsTheatrePanes(sampleInput({ authLine: 'Auth: ok' }));
    expect(ok.health.join('\n')).toContain('Auth: ok');

    const poolRefresh = buildOpsTheatrePanes(
      sampleInput({ authLine: 'Auth: ok · pool×2 · next refresh 3m' }),
    );
    expect(poolRefresh.health.join('\n')).toContain('Auth: ok · pool×2 · next refresh 3m');

    const degraded = buildOpsTheatrePanes(
      sampleInput({ authLine: 'Auth: refresh due · token_refresh_failed' }),
    );
    expect(degraded.health.join('\n')).toContain('Auth: refresh due · token_refresh_failed');
  });

  it('shows route line in Runtime Health when present', () => {
    const primary = buildOpsTheatrePanes(sampleInput({ routeLine: 'Route: primary' }));
    expect(primary.health.join('\n')).toContain('Route: primary');

    const failover = buildOpsTheatrePanes(
      sampleInput({ routeLine: 'Route: failover→backup (provider-failover)' }),
    );
    expect(failover.health.join('\n')).toContain('Route: failover→backup (provider-failover)');
  });

  it('omits route line when routeLine is null', () => {
    const panes = buildOpsTheatrePanes(sampleInput({ routeLine: null }));
    expect(panes.health.join('\n')).not.toContain('Route:');
  });

  it('shows explicit Permission line in Runtime Health', () => {
    const panes = buildOpsTheatrePanes(sampleInput({ permissionMode: 'auto' }));
    expect(panes.health.join('\n')).toContain('Permission: auto');
    expect(panes.health.join('\n')).not.toContain('permission: auto');
    expect(panes.health.at(-2)).toBe('Model: gpt-test');
    expect(panes.health.at(-1)).toBe('Permission: auto');
  });

  it('shows live session confirmation when permissionFromSession is wired', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        permissionMode: 'auto',
        permissionFromSession: 'auto',
      }),
    );
    expect(panes.health.at(-1)).toBe('Permission: auto · live session confirms');
  });

  it('shows TUI vs session mismatch when permissionFromSession differs', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        permissionMode: 'auto',
        permissionFromSession: 'manual',
      }),
    );
    expect(panes.health.at(-1)).toBe('Permission: auto (TUI) · session manual');
  });

  it('notes trusted workspace when permission is yolo', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({ permissionMode: 'yolo', permissionFromSession: 'yolo' }),
    );
    expect(panes.health.at(-1)).toBe(
      'Permission: yolo · live session · trusted workspace assumed',
    );
  });

  it('shows fleet worker lines when fleetWorkers are present', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        fleetWorkers: [
          { name: 'lint-fix', status: 'running' },
          { name: 'docs-pass', status: 'idle' },
        ],
      }),
    );

    expect(panes.fleet).toEqual([
      'live 10:00:00 AM',
      '• running lint-fix',
      '• idle docs-pass',
      'Evidence: Maker≠Checker · requiredEvidence match',
      'Maker≠Checker (soft): same expert make+check',
      'Budget: ≥2 wasted rounds → kill suggest',
      OPS_FLEET_COST_GUARD_TIP,
      OPS_FLEET_PARALLEL_FANOUT_TIP,
      fleetDualEmitStatusLine({}),
    ]);
  });

  it('shows live parallel tool count in the Ops Fleet pane when wired', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        parallelTools: { parallelToolsInFlight: 2, maxParallelTools: 2 },
      }),
    );
    expect(panes.fleet.at(-2)).toBe('Parallel tools: 2 in flight');
    expect(panes.fleet.at(-1)).toBe(fleetDualEmitStatusLine({}));
  });

  it('shows live maker-checker soft warn in the Ops Fleet pane when wired', () => {
    const warn =
      'Maker≠Checker (soft): expert "lint-fix" both implements and reviews — consider splitting roles.';
    const panes = buildOpsTheatrePanes(
      sampleInput({
        makerCheckerSoftWarn: warn,
      }),
    );
    expect(panes.fleet).toContain(warn);
    expect(panes.fleet).not.toContain(OPS_FLEET_MAKER_CHECKER_SOFT_TIP);
  });

  it('falls back to maker-checker soft tip when AppState warn is absent', () => {
    const panes = buildOpsTheatrePanes(sampleInput({ makerCheckerSoftWarn: null }));
    expect(panes.fleet).toContain(OPS_FLEET_MAKER_CHECKER_SOFT_TIP);
  });

  it('shows live Cost Guard line when session spend and env cap are wired', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        costGuardOpsLine: 'Cost Guard: Spent $1.25 / $5.00 · $3.75 remaining',
      }),
    );
    expect(panes.fleet).toContain('Cost Guard: Spent $1.25 / $5.00 · $3.75 remaining');
    expect(panes.fleet).not.toContain(OPS_FLEET_COST_GUARD_TIP);
  });

  it('falls back to Cost Guard tip when AppState spend scan is absent', () => {
    const panes = buildOpsTheatrePanes(sampleInput());
    expect(panes.fleet).toContain(OPS_FLEET_COST_GUARD_TIP);
  });

  it('falls back to sessions line when no fleet workers', () => {
    const panes = buildOpsTheatrePanes(sampleInput());
    expect(panes.fleet).toEqual([
      'live 10:00:00 AM',
      'Sessions: 2 in workspace',
      'Evidence: Maker≠Checker · requiredEvidence match',
      'Maker≠Checker (soft): same expert make+check',
      'Budget: ≥2 wasted rounds → kill suggest',
      OPS_FLEET_COST_GUARD_TIP,
      OPS_FLEET_PARALLEL_FANOUT_TIP,
      fleetDualEmitStatusLine({}),
    ]);
  });

  it('shows governance one-liners in the Ops Fleet pane', () => {
    const panes = buildOpsTheatrePanes(sampleInput());
    const text = panes.fleet.join('\n');
    expect(text).toContain('Maker≠Checker');
    expect(text).not.toContain('swarm-evidence-gate');
    expect(text).toContain('≥2 wasted rounds');
    expect(text).toContain('kill suggest');
  });

  it('shows live Goal XP line in the Mission pane when wired', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        goal: {
          status: 'active',
          objective: 'Ship Ops Theatre grid',
          xpGlance: { turnsUsed: 4, evidenceCount: 2 },
        },
      }),
    );
    expect(panes.goal[1]).toBe('XP: 4 turns · 2 evidence');
  });

  it('shows mission dual-emit SSOT line in the Mission pane (OFF by default)', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        missionDualEmitLine: missionDualEmitStatusLine({}),
      }),
    );
    expect(panes.goal).toEqual([
      'Goal: active · Ship Ops Theatre grid',
      'XP: 2 turns',
      VERIFICATION_SENSOR_GOAL_DONE_TIP,
      missionDualEmitStatusLine({}),
    ]);
    expect(panes.goal[3]).toContain('Dual-emit: OFF');
  });

  it('shows live goal soft advisory in the Mission pane when wired', () => {
    const advisory = 'Soft sensor: RunProjectChecks failed — tests red';
    const panes = buildOpsTheatrePanes(
      sampleInput({
        goalSoftAdvisory: advisory,
      }),
    );
    expect(panes.goal).toContain(advisory);
    expect(panes.goal).not.toContain(VERIFICATION_SENSOR_GOAL_DONE_TIP);
  });

  it('shows live mission run line in Goal pane when wired from getUltraworkRun SSOT', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        ultraworkMode: true,
        missionRun: {
          active: true,
          status: 'running',
          stage: 'swarm',
          objective: 'Ops Mission wire',
        },
      }),
    );
    expect(panes.goal[0]).toBe('Mission run: active · stage swarm · "Ops Mission wire"');
    expect(panes.goal[1]).toContain('Goal: active');
  });

  it('omits mission run line when Mission mode is off and no run metadata', () => {
    expect(resolveOpsMissionRunLine({ ultraworkMode: false })).toBeNull();
    const panes = buildOpsTheatrePanes(sampleInput({ ultraworkMode: false }));
    expect(panes.goal[0]).toContain('Goal:');
    expect(panes.goal.join('\n')).not.toContain('Mission run:');
  });

  it('shows awaiting mission metadata when ultrawork mode is on without run', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        goal: null,
        ultraworkMode: true,
        missionRun: { active: false, status: 'awaiting' },
      }),
    );
    expect(panes.goal[0]).toBe('Mission mode: ON (awaiting run metadata)');
  });

  it('falls back to W6 soft tip when AppState goalSoftAdvisory is absent', () => {
    const panes = buildOpsTheatrePanes(sampleInput({ goalSoftAdvisory: null }));
    expect(panes.goal).toContain(VERIFICATION_SENSOR_GOAL_DONE_TIP);
  });

  it('shows mission dual-emit ON when env gate is set', () => {
    const onLine = missionDualEmitStatusLine({ [MISSION_DUAL_EMIT_ENV]: '1' });
    const panes = buildOpsTheatrePanes(
      sampleInput({
        goal: null,
        missionDualEmitLine: onLine,
      }),
    );
    expect(panes.goal).toEqual(['Goal: (none)', VERIFICATION_SENSOR_GOAL_DONE_TIP, onLine]);
    expect(panes.goal[2]).toContain('Dual-emit: ON');
    expect(panes.goal[2]).toContain(MISSION_DUAL_EMIT_ENV);
  });

  it('shows fleet dual-emit SSOT line in the Fleet pane (OFF by default)', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        fleetDualEmitLine: fleetDualEmitStatusLine({}),
      }),
    );
    const fleetText = panes.fleet.join('\n');
    expect(fleetText).toContain('Dual-emit: OFF');
    expect(panes.fleet.at(-1)).toBe(fleetDualEmitStatusLine({}));
  });

  it('shows fleet dual-emit ON when env gate is set', () => {
    const onLine = fleetDualEmitStatusLine({ [FLEET_DUAL_EMIT_ENV]: '1' });
    const panes = buildOpsTheatrePanes(
      sampleInput({
        fleetDualEmitLine: onLine,
      }),
    );
    expect(panes.fleet.at(-1)).toBe(onLine);
    expect(panes.fleet.at(-1)).toContain('Dual-emit: ON');
    expect(panes.fleet.at(-1)).toContain(FLEET_DUAL_EMIT_ENV);
  });

  it('shows at most three fleet worker lines', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        fleetWorkers: [
          { name: 'one', status: 'running' },
          { name: 'two', status: 'idle' },
          { name: 'three', status: 'running' },
          { name: 'four', status: 'idle' },
        ],
      }),
    );

    expect(panes.fleet.filter((line) => line.startsWith('• '))).toHaveLength(3);
    expect(panes.fleet).not.toContain('• idle four');
  });

  it('renders changed-file previews in the Git pane', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        git: {
          branch: 'feat/ops-git',
          dirty: true,
          changedFileCount: 3,
          diffAdded: 4,
          diffDeleted: 1,
          ahead: 0,
          behind: 0,
          changedFiles: ['M apps/liora/src/tui/foo.ts', '~ scratch.tmp', 'D gone.ts'],
        },
      }),
    );

    expect(panes.git).toEqual([
      'Git: feat/ops-git · dirty · 3 files · +4/−1',
      'M apps/liora/src/tui/foo.ts',
      '~ scratch.tmp',
      'D gone.ts',
      'cwd: /tmp/superliora',
    ]);
  });

  it('shows git churn spark line when churnDelta is set', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        git: {
          branch: 'main',
          dirty: true,
          changedFileCount: 1,
          diffAdded: 4,
          diffDeleted: 1,
          ahead: 0,
          behind: 0,
          changedFiles: ['M one.ts'],
          churnDelta: 2,
        },
      }),
    );

    expect(panes.git).toContain('churn +2');
  });

  it('shows at most three changed-file lines in the Git pane', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        git: {
          branch: 'main',
          dirty: true,
          changedFileCount: 4,
          diffAdded: 1,
          diffDeleted: 0,
          ahead: 0,
          behind: 0,
          changedFiles: ['M one.ts', 'M two.ts', 'M three.ts', 'M four.ts'],
        },
      }),
    );

    expect(panes.git.filter((line) => line.startsWith('M '))).toHaveLength(3);
    expect(panes.git).not.toContain('M four.ts');
  });

  it('shows porcelain changed-file count on dirty git header', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        git: {
          branch: 'main',
          dirty: true,
          changedFileCount: 12,
          diffAdded: 4,
          diffDeleted: 1,
          ahead: 0,
          behind: 0,
        },
      }),
    );

    expect(panes.git[0]).toBe('Git: main · dirty · 12 files · +4/−1');
  });

  it('omits changed-file count when worktree is clean', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        git: {
          branch: 'main',
          dirty: false,
          changedFileCount: 0,
          diffAdded: 0,
          diffDeleted: 0,
          ahead: 0,
          behind: 0,
        },
      }),
    );

    expect(panes.git[0]).toBe('Git: main · clean · +0/−0');
  });

  it('shows git diff snippet lines in the Git pane when wired', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        git: {
          branch: 'main',
          dirty: true,
          changedFileCount: 1,
          diffAdded: 2,
          diffDeleted: 1,
          ahead: 0,
          behind: 0,
          changedFiles: ['M src/foo.ts'],
          diffSnippet: ['+const x = 1;', '−const x = 0;'],
        },
      }),
    );
    expect(panes.git).toContain('+const x = 1;');
    expect(panes.git).toContain('−const x = 0;');
  });

  it('caps git diff snippet at four lines', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        git: {
          branch: 'main',
          dirty: true,
          changedFileCount: 1,
          diffAdded: 5,
          diffDeleted: 0,
          ahead: 0,
          behind: 0,
          diffSnippet: ['+one', '+two', '+three', '+four', '+five'],
        },
      }),
    );
    const snippetLines = panes.git.filter((line) => line.startsWith('+') || line.startsWith('−'));
    expect(snippetLines).toHaveLength(4);
  });

  it('renders changed files inside the grid layout', () => {
    const panes = buildOpsTheatrePanes(
      sampleInput({
        git: {
          branch: 'main',
          dirty: true,
          changedFileCount: 1,
          diffAdded: 2,
          diffDeleted: 0,
          ahead: 0,
          behind: 0,
          changedFiles: ['M src/foo.ts'],
        },
      }),
    );
    const lines = renderOpsTheatreGrid(panes, 80);
    expect(panes.git).toContain('M src/foo.ts');
    expect(lines.some((line) => line.includes('src/foo.ts'))).toBe(true);
  });
});

describe('buildOpsTheatreInterventionTray', () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it('renders sticky intervention lines below the grid', () => {
    const tray = buildOpsTheatreInterventionTray({
      pendingApprovalToolName: 'Shell',
      interventionCount: 2,
    });
    expect(tray).toHaveLength(4);
    expect(tray[0]).toBe('▼ Intervention tray');
    expect(tray[1]).toBe('Approval: Shell · approve/deny in panel');
    expect(tray[2]).toBe('Never-Halt queue: 2 pending · oldest ?');
    expect(tray[3]).toBe('Ctrl-S steer mid-turn · /ops auto-refreshes');
  });

  it('shows stale×N when stale interventions are reported', () => {
    process.env[PERMISSION_AUTO_EXPIRE_ENV] = '120000';
    const tray = buildOpsTheatreInterventionTray({
      pendingApprovalToolName: null,
      interventionCount: 3,
      staleInterventionCount: 2,
      oldestInterventionAgeMs: 130_000,
    });
    expect(tray).toHaveLength(4);
    expect(tray[1]).toBe('Never-Halt queue: 3 pending · oldest 2m 10s · stale×2');
    expect(tray[2]).toBe('Orphans: orphan drop imminent');
    expect(tray[3]).toContain('Ctrl-S steer mid-turn');
  });

  it('prefers auto-expire countdown over steer when approval and stale queue fill four lines', () => {
    process.env[PERMISSION_AUTO_EXPIRE_ENV] = '120000';
    const tray = buildOpsTheatreInterventionTray({
      pendingApprovalToolName: 'Shell',
      interventionCount: 2,
      staleInterventionCount: 1,
      oldestInterventionAgeMs: 90_000,
    });
    expect(tray).toHaveLength(4);
    expect(tray[1]).toBe('Approval: Shell · approve/deny in panel');
    expect(tray[2]).toBe('Never-Halt queue: 2 pending · oldest 1m 30s · stale×1');
    expect(tray[3]).toBe('Orphans: orphan drop in 30s');
  });

  it('keeps the tray at most four lines when idle', () => {
    const tray = buildOpsTheatreInterventionTray({
      pendingApprovalToolName: null,
      interventionCount: 0,
    });
    expect(tray).toHaveLength(3);
    expect(tray[1]).toBe('Approval: (clear) · Interventions: (none)');
    expect(tray[2]).toBe('Ctrl-S steer mid-turn · /ops auto-refreshes');
  });

  it('shows approval action hint without intervention line when only approval is pending', () => {
    const tray = buildOpsTheatreInterventionTray({
      pendingApprovalToolName: 'Write',
      interventionCount: 0,
    });
    expect(tray).toHaveLength(3);
    expect(tray[1]).toBe('Approval: Write · approve/deny in panel');
    expect(tray[2]).toBe('Ctrl-S steer mid-turn · /ops auto-refreshes');
  });
});
