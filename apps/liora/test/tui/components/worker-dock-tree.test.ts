import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Event } from '@superliora/sdk';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import { WorkerDockPanelComponent } from '#/tui/components/panes/worker-dock/panel';
import { projectWorkerTree, type WorkerDockTreeInput, type WorkerTreeNode } from '#/tui/components/panes/worker-dock/worker-tree';
import { WorkerDockRegistry, type DockWorker } from '#/tui/controllers/worker-dock/registry';
import { type DockWorkerAncestry, type DockIndependentFact } from '#/tui/controllers/worker-dock/tree-registry';
import { emptyConductorJobsSnapshot } from '#/tui/utils/job/job-strip';

const strip = (text: string): string => text.replaceAll(/\u001B\[[0-9;]*m/g, '');
const render = (panel: WorkerDockPanelComponent): string[] => panel.render(120).map(strip);
const node = (id: string, parentAgentId: string | null | undefined, phase: WorkerTreeNode['phase'] = 'running'): WorkerTreeNode => ({ id, parentAgentId, phase, label: id, role: 'builder' });
const input = (nodes: readonly WorkerTreeNode[]): WorkerDockTreeInput => ({ rootAgentId: 'session:main', sessionId: 'session', nodes });
const worker = (id: string, liveText = 'compiling sources'): DockWorker => ({ id, name: id, kind: 'subagent', status: 'running', runInBackground: true, toolCount: 1, tokens: 20, elapsedMs: 2, spawnedAtMs: 0, lastActivityAtMs: 1, liveText, liveAtMs: 1 });
const ancestry = (sessionId: string, agentId: string, parentSessionId: string | null, parentAgentId: string | null): DockWorkerAncestry => ({ sessionId, agentId, parentSessionId, parentAgentId, rootSessionId: 'session', rootAgentId: 'main', status: parentSessionId === null ? 'root' : 'linked' });
function event(type: string, fields: Record<string, unknown>, workerAncestry: DockWorkerAncestry): Event {
  return { type, agentId: workerAncestry.agentId, sessionId: workerAncestry.sessionId, ...fields, workerAncestry } as unknown as Event;
}
function push(panel: WorkerDockPanelComponent, registry: WorkerDockRegistry): void {
  panel.setView({ snapshot: registry.snapshot(), tree: registry.treeSnapshot('session'), jobs: emptyConductorJobsSnapshot() });
}
function panelFor(tree: WorkerDockTreeInput, workers: readonly DockWorker[] = []): WorkerDockPanelComponent {
  const panel = new WorkerDockPanelComponent();
  panel.setView({ tree, snapshot: { version: 1, workers, activeCount: workers.length, totalTokens: 0, ops: [] }, jobs: emptyConductorJobsSnapshot() });
  return panel;
}
beforeEach(() => setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' }));
afterEach(() => setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES));

describe('explicit worker ancestry tree', () => {
  it('renders immediate nested/grandchild edges and separates semantic counts, excluding root', () => {
    const tree = input([node('session:main', null), node('a', 'session:main'), node('b', 'a'), node('c', 'b', 'queued'), { ...node('parked', 'session:main', 'idle'), reusable: true }, node('done', 'session:main', 'completed'), node('error', 'session:main', 'error')]);
    const projection = projectWorkerTree(tree, [], new Map(), 'c');
    expect(projection.counts).toEqual({ running: 2, queued: 1, idle: 1, completed: 1, error: 1 });
    expect(projection.rows.find(row => row.id === 'c')).toMatchObject({ depth: 3, parentId: 'b' });
    expect(projection.rows.find(row => row.id === 'c')?.connector).toContain('└─');
    expect(projection.rows.some(row => row.id === 'parked')).toBe(false);
    const lines = render(panelFor(tree));
    expect(lines.join('\n')).toContain('Run 2 · Queue 1 · Reusable idle 1 · Done 1 · Error 1');
    expect(lines.join('\n')).toContain('Session · Main');
  });



  it('keeps unmanaged live workers visible as explicit orphans when ancestry input is empty', () => {
    const panel = panelFor(input([]), [worker('unmanaged')]);
    expect(panel.isEmpty()).toBe(false);
    expect(render(panel).join('\n')).toContain('Orphans');
    expect(render(panel).join('\n')).toContain('unmanaged');
  });

  it('defaults to root and direct active rows, keeping grandchildren summarized until disclosure', () => {
    const tree = input([node('a', 'session:main'), node('b', 'a'), node('c', 'b')]);
    const projection = projectWorkerTree(tree, [worker('c', 'checking nested tests')], new Map());
    expect(projection.rows.map(row => row.id)).toEqual(['session:main', 'a']);
    expect(projection.rows[1]).toMatchObject({ expanded: false, activeDescendants: 2, liveActivity: 'checking nested tests' });
    const panel = panelFor(tree, [worker('c', 'checking nested tests')]);
    expect(render(panel).join('\n')).toContain('2 active below');
    expect(render(panel).join('\n')).toContain('checking nested tests');
    expect(panel.selectWorker('c')).toBe(true); // explicit selection reveals only its path
    expect(render(panel).some(line => /[▾·] c/.test(line))).toBe(true);
    panel.toggleTreeNode('a');
    expect(panel.selectedWorker).toBe('a');
    expect(render(panel).join('\n')).toContain('▸ a');
  });

  it('makes missing ancestry and cycles explicit and bounds excessively deep inputs', () => {
    const nodes = [node('orphan', 'absent'), node('unknown', undefined), node('x', 'y'), node('y', 'x'), node('nested', 'x')];
    for (let i = 0; i < 1000; i++) nodes.push(node(`deep${i}`, i === 0 ? 'session:main' : `deep${i - 1}`));
    const projected = projectWorkerTree(input(nodes), [], new Map(), 'nested');
    expect(projected.rows.some(row => row.label.includes('Orphans'))).toBe(true);
    expect(projected.rows.some(row => row.label.includes('cycle/depth'))).toBe(true);
    expect(new Set(projected.rows.map(row => row.id)).size).toBe(projected.rows.length);
    expect(Math.max(...projected.rows.map(row => row.depth))).toBeLessThanOrEqual(50);
    expect(projected.rows.find(row => row.id === 'nested')?.parentId).toBe('x');
  });

  it('collapses selected descendants to their visible ancestor, with left/right and existing Enter', () => {
    const panel = panelFor(input([node('a', 'session:main'), node('b', 'a'), node('c', 'b')]));
    panel.selectWorker('c');
    expect(panel.toggleTreeNode('a')).toBe(true);
    expect(panel.selectedWorker).toBe('a');
    expect(render(panel).join('\n')).not.toContain('builder · /c');
    expect(panel.handleSelectionKey('right').handled).toBe(true);
    panel.handleSelectionKey('right');
    expect(panel.selectedWorker).toBe('b');
    expect(panel.handleSelectionKey('enter')).toEqual({ handled: true, openWorkerId: 'b' });
    panel.handleSelectionKey('right');
    panel.handleSelectionKey('left');
    expect(panel.selectedWorker).toBe('b'); // collapse b first, then select its parent
    panel.handleSelectionKey('left');
    expect(panel.selectedWorker).toBe('a');
  });

  it('caret clicks toggle without opening and collapsed ancestors retain live aggregates', () => {
    const tree = input([node('a', 'session:main'), node('b', 'a'), node('c', 'b')]);
    const panel = panelFor(tree, [worker('c', 'tests 7/12')]);
    panel.toggleTreeNode('a');
    const lines = render(panel);
    const y = lines.findIndex(line => /▾ a/.test(line));
    const x = lines[y]!.indexOf('▾');
    expect(panel.handleTreePointer(x, y)).toBe(true);
    const collapsed = render(panel).join('\n');
    expect(collapsed).toContain('2 active below');
    expect(collapsed).toContain('tests 7/12');
    panel.setView({ tree, snapshot: { version: 2, workers: [worker('c', 'tests 10/12')], activeCount: 1, totalTokens: 0, ops: [] }, jobs: emptyConductorJobsSnapshot() });
    expect(render(panel).join('\n')).toContain('tests 10/12');
    expect(render(panel).join('\n')).toContain('▸ a');
  });

  it('keeps selected IDs and focus stable through ordinary roster additions and stream updates', () => {
    const panel = panelFor(input([node('b', 'session:main')]));
    panel.selectWorker('b'); panel.focused = false;
    panel.setView({ tree: input([node('a', 'session:main'), node('b', 'session:main')]), snapshot: { version: 2, workers: [worker('b')], activeCount: 1, totalTokens: 0, ops: [] }, jobs: emptyConductorJobsSnapshot() });
    expect(panel.selectedWorker).toBe('b'); expect(panel.focused).toBe(false);
    const text = render(panel).join('\n');
    expect(text).toContain('builder'); expect(text).toContain('/b');
    expect(text.match(/❯/g)).toHaveLength(1);
  });
});

describe('real registry ancestry and attention adapters', () => {

  it('counts queued ownership before ownerStatus active, and reusable idle only with explicit capability', () => {
    const registry = new WorkerDockRegistry(() => 1);
    registry.applyIndependentFacts('session', [
      { id: 'accepted', status: 'accepted', ownerStatus: 'active', reusable: false, workerAncestry: ancestry('accepted', 'main', 'session', 'main') },
      { id: 'admitting', status: 'admitting', ownerStatus: 'active', reusable: false, workerAncestry: ancestry('admitting', 'main', 'session', 'main') },
      { id: 'idle', status: 'idle', ownerStatus: 'parked', reusable: true, workerAncestry: ancestry('idle', 'main', 'session', 'main') },
      { id: 'yielded', status: 'yielded', ownerStatus: 'parked', reusable: true, workerAncestry: ancestry('yielded', 'main', 'session', 'main') },
      { id: 'unsupported', status: 'idle', ownerStatus: 'parked', reusable: false, workerAncestry: ancestry('unsupported', 'main', 'session', 'main') },
      { id: 'finished', status: 'finished', ownerStatus: 'completed', reusable: false, workerAncestry: ancestry('finished', 'main', 'session', 'main') },
    ]);
    const projection = projectWorkerTree(registry.treeSnapshot('session'), [], new Map());
    expect(projection.counts).toEqual({ running: 0, queued: 2, idle: 2, completed: 2, error: 0 });
    const panel = new WorkerDockPanelComponent(); push(panel, registry);
    expect(render(panel).join('\n')).toContain('Run 0 · Queue 2 · Reusable idle 2 · Done 2 · Error 0');
  });



  it.each([
    ['accepted', 'active', false, 'queued'], ['admitting', 'active', false, 'queued'],
    ['idle', 'idle', true, 'idle'], ['yielded', 'yielded', true, 'idle'],
    ['idle', 'idle', false, 'completed'], ['yielded', 'yielded', false, 'completed'],
    ['finished', 'finished', false, 'completed'], ['interrupted', 'interrupted', false, 'error'],
    ['cancel_requested', 'settling', false, 'running'], ['completed', 'settling', false, 'running'],
  ] as const)('maps fact %s/%s/reusable=%s to semantic %s', (status, ownerStatus, reusable, phase) => {
    const registry = new WorkerDockRegistry(() => 1);
    registry.applyIndependentFacts('session', [{ id: 'owner', status, ownerStatus, reusable, workerAncestry: ancestry('owner', 'main', 'session', 'main') }]);
    expect(registry.treeSnapshot('session').nodes[0]?.phase).toBe(phase);
    if (phase === 'error') expect(registry.treeSnapshot('session').nodes[0]?.attention).toBe('error');
  });

  it('keeps cross-session main without direct metadata an orphan instead of borrowing owner ancestry', () => {
    const registry = new WorkerDockRegistry(() => 1);
    const owner: DockIndependentFact = { id: 'owner', status: 'running', workerAncestry: ancestry('one', 'main', 'session', 'main') };
    const incoming = { type: 'assistant.delta', sessionId: 'two', agentId: 'main', delta: 'different session' } as Event;
    registry.applyIndependentEvent('session', owner, incoming);
    const node = registry.treeSnapshot('session').nodes.find(item => item.id === 'two:main');
    expect(node?.parentAgentId).toBeUndefined();
    expect(registry.treeSnapshot('session').nodes.find(item => item.id === 'record:session:owner')?.parentAgentId).toBe('session:main');
  });


  it('never aliases a legacy pipeline caller root tuple to an operation record', () => {
    const registry = new WorkerDockRegistry(() => 1);
    registry.applyIndependentFacts('session', [{ id: 'pipeline', kind: 'pipeline', status: 'accepted', reusable: false, purpose: 'Verify release', workerAncestry: ancestry('session', 'main', null, null) }]);
    const panel = new WorkerDockPanelComponent(); push(panel, registry); panel.selectWorker('session:main');
    registry.apply(event('turn.started', { turnId: 1 }, ancestry('session', 'main', null, null))); push(panel, registry);
    expect(panel.selectedWorker).toBe('session:main');
    expect(registry.treeSnapshot('session').rootAgentId).toBe('session:main');
    const operation = registry.treeSnapshot('session').nodes.find(item => item.id === 'record:session:pipeline');
    expect(operation?.parentAgentId).toBeUndefined();
    expect(operation?.role).toBe('pipeline');
    expect(registry.workerTranscriptTarget('record:session:pipeline')).toBeUndefined();
    expect(registry.treeSnapshot('session').nodes.some(item => item.id === 'session:main')).toBe(true);
  });


  it('parents pipeline operations using explicit caller tuples without aliasing origin Session workers', () => {
    const registry = new WorkerDockRegistry(() => 1);
    const origin = ancestry('session', 'main', null, null);
    registry.applyIndependentFacts('session', [{ id: 'operation', coordinationId: 'operation', kind: 'pipeline', status: 'running', reusable: false, purpose: 'Verify release', originAncestry: origin, parentSessionId: origin.sessionId, parentAgentId: origin.agentId }]);
    const tree = registry.treeSnapshot('session');
    expect(tree.nodes[0]).toMatchObject({ id: 'record:session:operation', role: 'pipeline', parentAgentId: 'session:main' });
    expect(tree.nodes[0]?.sessionId).toBeUndefined();
    const panel = new WorkerDockPanelComponent(); push(panel, registry); panel.selectWorker('record:session:operation');
    expect(panel.handleSelectionKey('enter')).toEqual({ handled: true });
    expect(registry.workerTranscriptTarget('record:session:operation')).toBeUndefined();
    expect(render(panel).join('\n')).toContain('pipeline · record operation');
  });

  it('aliases early admitted events by stable coordination ID before the actual session fact arrives', () => {
    const registry = new WorkerDockRegistry(() => 1);
    const accepted: DockIndependentFact = { id: 'coord', status: 'accepted', purpose: 'Build', workerAncestry: { ...ancestry('coord', 'main', 'session', 'main'), coordinationId: 'coord' } };
    registry.applyIndependentFacts('session', [accepted]);
    const panel = new WorkerDockPanelComponent(); push(panel, registry); panel.selectWorker('record:session:coord');
    registry.applyIndependentEvent('session', accepted, event('assistant.delta', { delta: 'building API' }, { ...ancestry('actual', 'main', 'session', 'main'), coordinationId: 'coord' }));
    registry.applyIndependentEvent('session', accepted, event('subagent.spawned', { subagentId: 'child', subagentName: 'Nested', runInBackground: true, parentToolCallId: 'tool' }, { ...ancestry('actual', 'child', 'actual', 'main'), coordinationId: 'coord' }));
    push(panel, registry);
    const nodes = registry.treeSnapshot('session').nodes;
    expect(nodes.map(item => item.id)).toEqual(['record:session:coord', 'actual:child']);
    expect(nodes[1]?.parentAgentId).toBe('record:session:coord');
    expect(panel.selectedWorker).toBe('record:session:coord');
    expect(registry.snapshot().workers.some(item => item.id === 'actual:main')).toBe(false);
    expect(registry.snapshot().workers.some(item => item.id === 'record:session:coord')).toBe(true);
  });

  it('retains scoped coordinator totals and explicitly labels a bounded partial graph', () => {
    const registry = new WorkerDockRegistry(() => 1);
    const totals = { total: 42, truncated: true, counts: { byStatus: { running: 1, failed: 1, finished: 40 }, attention: 1 } };
    registry.applyIndependentFacts('session', [
      { id: 'live', status: 'running', workerAncestry: ancestry('live', 'main', 'session', 'main') },
      { id: 'failed', status: 'failed', workerAncestry: ancestry('failed', 'main', 'session', 'main') },
    ], totals);
    expect(registry.treeSnapshot('session').coordinatorTotals).toEqual(totals);
    const panel = new WorkerDockPanelComponent(); push(panel, registry);
    const text = render(panel).join('\n');
    expect(text).toContain('Visible · Run 1');
    expect(text).toContain('Coordinator: 42 records · partial tree · 1 attention');
  });

  it('qualifies separate sessions and actual immediate parent tuples, never names', () => {
    const registry = new WorkerDockRegistry(() => 1);
    const facts: DockIndependentFact[] = [
      { id: 'one', purpose: 'same label', status: 'running', workerAncestry: ancestry('one-session', 'main', 'session', 'main') },
      { id: 'two', purpose: 'same label', status: 'running', workerAncestry: ancestry('two-session', 'main', 'one-session', 'main') },
    ];
    registry.applyIndependentFacts('session', facts);
    const tree = registry.treeSnapshot('session');
    expect(tree.nodes.map(item => item.id)).toEqual(['record:session:one', 'record:session:two']);
    expect(tree.nodes[1]?.parentAgentId).toBe('record:session:one');
    expect(projectWorkerTree(tree, [], new Map(), 'record:session:two').rows.find(row => row.id === 'record:session:two')?.depth).toBe(2);
  });

  it('preserves selection and user disclosure through queued→admitting→running promotion', () => {
    const registry = new WorkerDockRegistry(() => 1);
    const panel = new WorkerDockPanelComponent();
    const accepted: DockIndependentFact = { id: 'coord', revision: 1, status: 'accepted', purpose: 'Build API', workerAncestry: ancestry('coord', 'main', 'session', 'main') };
    registry.applyIndependentFacts('session', [accepted]); push(panel, registry);
    const owner = 'record:session:coord';
    panel.selectWorker(owner);
    registry.apply(event('subagent.spawned', { subagentId: 'child', subagentName: 'Child', parentAgentId: 'main', parentToolCallId: 'tool', runInBackground: true }, ancestry('coord', 'child', 'coord', 'main')));
    push(panel, registry); panel.toggleTreeNode(owner); panel.toggleTreeNode(owner);
    expect(panel.selectedWorker).toBe(owner);
    const running: DockIndependentFact = { ...accepted, revision: 3, status: 'running', workerAncestry: ancestry('actual-session', 'main', 'session', 'main') };
    registry.applyIndependentFacts('session', [running]);
    registry.applyIndependentFacts('session', [{ ...accepted, revision: 2, status: 'starting' }]);
    push(panel, registry);
    expect(panel.selectedWorker).toBe(owner);
    expect(render(panel).join('\n')).toContain('▸ Build API');
    expect(registry.treeSnapshot('session').nodes.filter(row => row.id === owner)).toHaveLength(1);
    const child = registry.treeSnapshot('session').nodes.find(row => row.id === 'coord:child');
    expect(child?.parentAgentId).toBe(owner);
  });

  it('adapts real failed events and source question callbacks without reopening user collapse', () => {
    const registry = new WorkerDockRegistry(() => 1);
    const parent = ancestry('session', 'parent', 'session', 'main');
    const child = ancestry('session', 'child', 'session', 'parent');
    for (const [meta, label] of [[parent, 'Parent'], [child, 'Child']] as const) registry.apply(event('subagent.spawned', { subagentId: meta.agentId, subagentName: label, parentToolCallId: 'tool', runInBackground: true }, meta));
    const panel = new WorkerDockPanelComponent(); push(panel, registry);
    panel.selectWorker('session:parent'); panel.toggleTreeNode('session:parent'); panel.toggleTreeNode('session:parent');
    registry.apply(event('subagent.failed', { subagentId: 'child', error: 'test failed' }, child)); push(panel, registry);
    expect(registry.treeSnapshot('session').nodes.find(row => row.id === 'session:child')).toMatchObject({ phase: 'error', attention: 'error' });
    expect(render(panel).join('\n')).toContain('▸ Parent');
    expect(render(panel).join('\n')).toContain('attention below');
    expect(registry.setWorkerAttention('session', 'child', 'question')).toBe(true);
    expect(registry.setWorkerAttention('session', 'child', 'question')).toBe(false);
    push(panel, registry);
    expect(panel.selectedWorker).toBe('session:parent'); expect(panel.focused).toBe(false);
    expect(render(panel).join('\n')).toContain('▸ Parent');
    panel.handleSelectionKey('right');
    expect(render(panel).join('\n')).toContain('needs input');
    expect(registry.setWorkerAttention('session', 'child', undefined)).toBe(true);
  });
});
