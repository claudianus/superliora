import { describe, expect, it } from 'vitest';

import {
  areDependenciesSatisfied,
  partitionReadyWorkNodeIds,
  preferReadyWorkNodeIds,
  readyNodeIds,
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

  it('preferReadyWorkNodeIds keeps only ready bound ids when any are ready', () => {
    const nodes = [n('a', 'queued'), n('b', 'queued', ['a']), n('c', 'queued')];
    expect(preferReadyWorkNodeIds(['a', 'b', 'c'], nodes)).toEqual(['a', 'c']);
  });

  it('preferReadyWorkNodeIds falls back to bound ids when none are ready', () => {
    const nodes = [n('a', 'running'), n('b', 'queued', ['a'])];
    expect(preferReadyWorkNodeIds(['b'], nodes)).toEqual(['b']);
  });
});
