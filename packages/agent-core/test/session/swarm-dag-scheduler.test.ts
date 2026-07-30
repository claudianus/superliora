import { describe, expect, it } from 'vitest';

import {
  SWARM_DAG_DONE_STATUSES,
  SWARM_DAG_TERMINAL_STATUSES,
  areDependenciesSatisfied,
  partitionReadyWorkNodeIds,
  preferReadyWorkNodeIds,
  readyNodeIds,
  rebindPhaseWorkNodeIds,
  type SwarmDagNode,
  type SwarmDagNodeStatus,
} from '../../src/collaboration/swarm-dag-scheduler';

function node(id: string, status: SwarmDagNodeStatus, dependsOn: readonly string[] = []): SwarmDagNode {
  return { id, status, dependsOn };
}

describe('swarm-dag-scheduler.ts — status sets', () => {
  it('pins the documented done/succeeded set and the broader terminal set', () => {
    expect([...SWARM_DAG_DONE_STATUSES]).toEqual(['done', 'succeeded']);
    expect([...SWARM_DAG_TERMINAL_STATUSES]).toEqual([
      'done',
      'succeeded',
      'failed',
      'blocked',
      'cancelled',
      'needs_integration',
    ]);
  });
});

describe('swarm-dag-scheduler.ts — readyNodeIds', () => {
  it('returns no ids when every node is terminal or running', () => {
    const nodes = [node('a', 'done'), node('b', 'running'), node('c', 'failed')];
    expect(readyNodeIds(nodes)).toEqual([]);
  });

  it('returns every non-terminal, non-running node when none have deps', () => {
    const nodes = [
      node('a', 'queued'),
      node('b', 'ready'),
      node('c', 'done'),
      node('d', 'running'),
    ];
    expect(readyNodeIds(nodes)).toEqual(['a', 'b']);
  });

  it('waits on a dependency whose status is queued/running (not done)', () => {
    const nodes = [
      node('a', 'queued'),
      node('b', 'queued', ['a']),
      node('c', 'queued', ['b']),
    ];
    expect(readyNodeIds(nodes)).toEqual(['a']);
  });

  it('treats unknown dependency ids as unsatisfied', () => {
    const nodes = [node('a', 'queued', ['missing'])];
    expect(readyNodeIds(nodes)).toEqual([]);
  });

  it('preserves the input order across mixed ready/dependent nodes', () => {
    const nodes = [
      node('a', 'queued'),
      node('b', 'queued', ['a']),
      node('c', 'queued'),
      node('d', 'queued', ['c']),
    ];
    expect(readyNodeIds(nodes)).toEqual(['a', 'c']);
  });
});

describe('swarm-dag-scheduler.ts — areDependenciesSatisfied', () => {
  it('returns true when no deps are listed', () => {
    expect(areDependenciesSatisfied(node('a', 'queued'), new Map())).toBe(true);
  });

  it('returns false when any dep is missing or not done', () => {
    const byId = new Map<string, SwarmDagNode>([
      ['a', node('a', 'done')],
      ['b', node('b', 'queued')],
    ]);
    expect(areDependenciesSatisfied(node('z', 'queued', ['a', 'missing']), byId)).toBe(false);
    expect(areDependenciesSatisfied(node('z', 'queued', ['a', 'b']), byId)).toBe(false);
    expect(areDependenciesSatisfied(node('z', 'queued', ['a']), byId)).toBe(true);
  });
});

describe('swarm-dag-scheduler.ts — partitionReadyWorkNodeIds', () => {
  it('splits bound-but-non-terminal nodes into ready vs blocked', () => {
    // 'a' is still queued so c and d remain blocked; 'a' (no deps) and
    // 'b' (no deps) are ready.
    const nodes = [
      node('a', 'queued'),
      node('b', 'queued'),
      node('c', 'queued', ['a']),
      node('d', 'queued', ['a']),
    ];
    expect(partitionReadyWorkNodeIds(nodes)).toEqual({
      readyIds: ['a', 'b'],
      blockedIds: ['c', 'd'],
    });
  });
});

describe('swarm-dag-scheduler.ts — preferReadyWorkNodeIds', () => {
  it('returns the bound ids when none are ready (no starvation)', () => {
    const nodes = [node('a', 'done'), node('b', 'queued', ['a'])];
    expect(preferReadyWorkNodeIds(['b'], nodes)).toEqual(['b']);
  });

  it('filters the bound list to currently ready ids', () => {
    const nodes = [node('a', 'queued'), node('b', 'queued', ['a']), node('c', 'queued')];
    expect(preferReadyWorkNodeIds(['a', 'b', 'c'], nodes)).toEqual(['a', 'c']);
  });
});

describe('swarm-dag-scheduler.ts — rebindPhaseWorkNodeIds', () => {
  it('returns the original specs when both inputs are empty', () => {
    expect(rebindPhaseWorkNodeIds([], [], [])).toEqual([]);
  });

  it('keeps a spec that already holds ready ids untouched', () => {
    const nodes = [node('a', 'queued'), node('b', 'queued')];
    const specs = [{ workNodeIds: ['a', 'b'] }];
    expect(rebindPhaseWorkNodeIds(specs, ['a', 'b'], nodes)).toEqual(specs);
  });

  it('moves freed ready nodes onto an empty spec', () => {
    const nodes = [node('a', 'queued'), node('b', 'queued')];
    const specs: { workNodeIds: string[] }[] = [{ workNodeIds: [] }];
    const out = rebindPhaseWorkNodeIds(specs, ['a', 'b'], nodes);
    expect(out[0]?.workNodeIds).toEqual(['a', 'b']);
  });

  it('prunes non-ready ids and assigns free ready nodes to empty specs', () => {
    // 'a' is already done (terminal → not schedulable); 'b' and 'c' are
    // queued with no deps and therefore ready. Spec 0 holds 'a' + 'b' →
    // 'a' is pruned, 'b' is kept. Spec 1 is empty so the leftover ready
    // 'c' is assigned to it.
    const nodes = [
      node('a', 'done'),
      node('b', 'queued'),
      node('c', 'queued'),
    ];
    const specs: { workNodeIds: string[] }[] = [{ workNodeIds: ['a', 'b'] }, { workNodeIds: [] }];
    const out = rebindPhaseWorkNodeIds(specs, ['a', 'b', 'c'], nodes);
    expect(out[0]?.workNodeIds).toEqual(['b']);
    expect(out[1]?.workNodeIds).toEqual(['c']);
  });
});
