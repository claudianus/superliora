import { describe, expect, it } from 'vitest';

import { createSwarmBudgetState, SWARM_DAG_DONE_STATUSES, FLEET_BUDGET_USD_ENV, FLEET_WORKTREE_ENV } from '#/fleet';

describe('fleet facade', () => {
  it('re-exports collaboration public API', () => {
    expect(SWARM_DAG_DONE_STATUSES.has('done')).toBe(true);
    expect(createSwarmBudgetState()).toMatchObject({
      rounds: 0,
      wastedRounds: 0,
    });
    expect(FLEET_WORKTREE_ENV).toBe('SUPERLIORA_FLEET_WORKTREE');
    expect(FLEET_BUDGET_USD_ENV).toBe('SUPERLIORA_FLEET_BUDGET_USD');
  });
});
