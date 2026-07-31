/**
 * Deterministic Ops Theatre grid for visual-smoke / snapshot fixtures.
 * Future harness: call `renderOpsTheatreSmokeGrid()` from `pnpm -C apps/liora run smoke:visual`.
 */

import { fleetDualEmitStatusLine, missionDualEmitStatusLine } from '@superliora/sdk';

import { buildOpsTheatrePanes, type OpsTheatreInput } from './build-panes';
import { DEFAULT_OPS_THEATRE_WIDTH, renderOpsTheatreGrid } from './layout';

export function buildOpsTheatreSmokeInput(
  overrides: Partial<OpsTheatreInput> = {},
): OpsTheatreInput {
  return {
    refreshedAt: '10:00:00 AM',
    sessionsLine: 'Sessions: 2 in workspace',
    fleetWorkers: [
      { name: 'main', status: 'running' },
      { name: 'explore-1', status: 'idle' },
    ],
    goal: { status: 'active', objective: 'Ship Ops Theatre grid' },
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
    cacheFreezeLine: 'Freeze: idle',
    tokenGlanceLine: 'Tokens: in 12.3K · out 1.2K · cache 99%',
    lastStepTtftLine: 'Last TTFT: 320ms (turn 1 step 0) · in-process path',
    breakerLine: 'Breakers: (no trips) · breakers: see /settings never-halt',
    authLine: 'Auth: ok',
    routeLine: null,
    search: {
      configured: ['brave'],
      searchDegraded: true,
      lateChannelSuffix: ' · Ch4 browser · Ch5 chrome-ext',
      cascadeLine: 'Cascade: ch1→ch3→ch4 · hops 2',
      researchHopsLine: null,
    },
    degraded: null,
    model: 'gpt-test',
    permissionMode: 'manual',
    pendingApprovalToolName: null,
    missionDualEmitLine: missionDualEmitStatusLine(),
    fleetDualEmitLine: fleetDualEmitStatusLine(),
    ...overrides,
  };
}

export function renderOpsTheatreSmokeGrid(
  width = DEFAULT_OPS_THEATRE_WIDTH,
): string[] {
  const panes = buildOpsTheatrePanes(buildOpsTheatreSmokeInput());
  return renderOpsTheatreGrid(panes, width);
}
