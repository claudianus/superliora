import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/agent';
import { resolveApprovedUltraworkPlanPath } from '../../src/ultrawork/approved-plan';
import { testKaos } from '../fixtures/test-kaos';

const APPROVED_PLAN = `# Ultra Plan

## Seed Spec
- Verifiable UltraGoal: Ship feature
- Acceptance Criteria: build passes
- Verification Plan: pnpm test

## WorkGraph
| node id | stage | description |
| WG-1 | integrate | scaffold |

Swarm decision: ENGAGE

## Execution Plan
1. Build
`;

describe('approved ultrawork plan resolution', () => {
  it('prefers an approved plan over a stale draft path', async () => {
    const homedir = join(tmpdir(), `approved-plan-${String(Date.now())}`);
    const plansDir = join(homedir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    const approvedPath = join(plansDir, 'spoiler-storm-cannonball.md');
    const stalePath = join(plansDir, 'vision-hal-jordan-thunder.md');
    writeFileSync(approvedPath, APPROVED_PLAN, 'utf8');
    writeFileSync(stalePath, '# Draft\n\n## Seed Spec\n- Verifiable UltraGoal: draft only\n', 'utf8');

    const agent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    await agent.planMode.enter('vision-hal-jordan-thunder', false, false, true, 'Resume');

    const resolved = await resolveApprovedUltraworkPlanPath(agent, [
      stalePath,
      agent.planMode.planFilePath ?? undefined,
    ]);

    expect(resolved).toBe(approvedPath);
  });
});
