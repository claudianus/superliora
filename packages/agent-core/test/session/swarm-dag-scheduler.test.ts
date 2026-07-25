import { describe, expect, it } from 'vitest';

import {
  areDependenciesSatisfied,
  partitionReadyWorkNodeIds,
  preferReadyWorkNodeIds,
  readyNodeIds,
  rebindPhaseWorkNodeIds,
  type SwarmDagNode,
} from '../../src/session/swarm-dag-scheduler';

function n(
  id: string,
  status: SwarmDagNode['status'],
  dependsOn?: readonly string[],
): SwarmDagNode {
  return { id, status, dependsOn };
}

describe('swarm-dag-scheduler', () => {
  it('returns roots with no deps as ready', () => {
    const nodes = [n('a', 'queued'), n('b', 'queued')];
    expect(readyNodeIds(nodes)).toEqual(['a', 'b']);
  });

  it('schedules diamond: roots first, then middle, then tip', () => {
    //     a
    //    / \
    //   b   c
    //    \ /
    //     d
    const initial = [
      n('a', 'queued'),
      n('b', 'queued', ['a']),
      n('c', 'queued', ['a']),
      n('d', 'queued', ['b', 'c']),
    ];
    expect(readyNodeIds(initial)).toEqual(['a']);

    const afterA = [
      n('a', 'done'),
      n('b', 'queued', ['a']),
      n('c', 'queued', ['a']),
      n('d', 'queued', ['b', 'c']),
    ];
    expect(readyNodeIds(afterA)).toEqual(['b', 'c']);

    const afterB = [
      n('a', 'done'),
      n('b', 'done', ['a']),
      n('c', 'queued', ['a']),
      n('d', 'queued', ['b', 'c']),
    ];
    expect(readyNodeIds(afterB)).toEqual(['c']);

    const afterBC = [
      n('a', 'done'),
      n('b', 'succeeded', ['a']),
      n('c', 'done', ['a']),
      n('d', 'queued', ['b', 'c']),
    ];
    expect(readyNodeIds(afterBC)).toEqual(['d']);
  });

  it('blocks dependents when a dependency is failed', () => {
    const nodes = [
      n('a', 'failed'),
      n('b', 'queued', ['a']),
      n('c', 'queued'),
    ];
    expect(readyNodeIds(nodes)).toEqual(['c']);
  });

  it('blocks dependents when a dependency is still running/queued', () => {
    const nodes = [
      n('a', 'running'),
      n('b', 'queued', ['a']),
    ];
    expect(readyNodeIds(nodes)).toEqual([]);
  });

  it('skips terminal nodes themselves', () => {
    const nodes = [
      n('a', 'done'),
      n('b', 'failed'),
      n('c', 'blocked'),
      n('d', 'queued'),
    ];
    expect(readyNodeIds(nodes)).toEqual(['d']);
  });

  it('treats unknown dependency ids as unsatisfied', () => {
    const nodes = [n('b', 'queued', ['missing'])];
    expect(readyNodeIds(nodes)).toEqual([]);
  });

  it('areDependenciesSatisfied mirrors ready-set rules', () => {
    const byId = new Map<string, SwarmDagNode>([
      ['a', n('a', 'done')],
      ['b', n('b', 'queued', ['a'])],
    ]);
    expect(areDependenciesSatisfied(byId.get('b')!, byId)).toBe(true);
    expect(areDependenciesSatisfied(n('c', 'queued', ['missing']), byId)).toBe(false);
  });

  it('partitionReadyWorkNodeIds splits ready vs blocked', () => {
    const nodes = [
      n('a', 'queued'),
      n('b', 'queued', ['a']),
      n('c', 'done'),
    ];
    expect(partitionReadyWorkNodeIds(nodes)).toEqual({
      readyIds: ['a'],
      blockedIds: ['b'],
    });
  });

  it('treats needs_integration as unschedulable (not ready)', () => {
    const nodes = [
      n('a', 'needs_integration'),
      n('b', 'queued', ['a']),
      n('c', 'queued'),
    ];
    // a is terminal-for-schedule; b still blocked because deps require done/succeeded
    expect(readyNodeIds(nodes)).toEqual(['c']);
    expect(partitionReadyWorkNodeIds(nodes)).toEqual({
      readyIds: ['c'],
      blockedIds: ['b'],
    });
  });

  it('preferReadyWorkNodeIds keeps only ready bound ids when any are ready', () => {
    const nodes = [n('a', 'queued'), n('b', 'queued', ['a']), n('c', 'queued')];
    expect(preferReadyWorkNodeIds(['a', 'b', 'c'], nodes)).toEqual(['a', 'c']);
  });

  it('preferReadyWorkNodeIds falls back to bound ids when none are ready', () => {
    const nodes = [n('a', 'running'), n('b', 'queued', ['a'])];
    expect(preferReadyWorkNodeIds(['b'], nodes)).toEqual(['b']);
  });

  it('rebindPhaseWorkNodeIds keeps held ready nodes and assigns free ready to empty specs', () => {
    // a done → b,c ready; d still blocked on b
    const nodes = [
      n('a', 'done'),
      n('b', 'queued', ['a']),
      n('c', 'queued', ['a']),
      n('d', 'queued', ['b']),
    ];
    const specs = [
      { expertId: 'e1', workNodeIds: ['b'] },
      { expertId: 'e2', workNodeIds: [] as string[] },
      { expertId: 'e3', workNodeIds: ['d'] }, // blocked — should drop and wait free
    ];
    const rebound = rebindPhaseWorkNodeIds(specs, ['a', 'b', 'c', 'd'], nodes);
    expect(rebound[0]?.workNodeIds).toEqual(['b']);
    // e2 empty + e3 blocked → free ready is only c
    expect(rebound[1]?.workNodeIds).toEqual(['c']);
    // no more free ready after c assigned
    expect(rebound[2]?.workNodeIds).toEqual([]);
  });

  it('rebindPhaseWorkNodeIds round-robins leftover free ready nodes', () => {
    const nodes = [n('a', 'queued'), n('b', 'queued'), n('c', 'queued')];
    const specs = [{ expertId: 'only', workNodeIds: [] as string[] }];
    const rebound = rebindPhaseWorkNodeIds(specs, ['a', 'b', 'c'], nodes);
    expect(rebound[0]?.workNodeIds).toEqual(['a', 'b', 'c']);
  });

  it('rebindPhaseWorkNodeIds is a no-op when nothing is free', () => {
    const nodes = [n('a', 'queued'), n('b', 'queued', ['a'])];
    const specs = [{ expertId: 'e1', workNodeIds: ['a'] }];
    const rebound = rebindPhaseWorkNodeIds(specs, ['a', 'b'], nodes);
    expect(rebound).toEqual(specs);
  });
});
