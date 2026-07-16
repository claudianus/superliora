import { describe, expect, it } from 'vitest';

import {
  compactSwarmToolResult,
  expandSwarmArchivedBody,
  isSwarmToolResult,
  maskStaleSwarmToolResult,
  SWARM_TOTAL_RESULT_MAX_CHARS,
} from '../../../src/agent/compaction/boundary-compaction';
import { collapseForHandoff } from '../../../src/agent/compaction/handoff-collapse';
import { expandArchivedContent } from '../../../src/tools/builtin/context/context-archive';
import type { ToolStore } from '../../../src/tools/store';

function mockStore(): ToolStore {
  const data = new Map<string, unknown>();
  return {
    get: (key: string) => data.get(key),
    set: (key: string, value: unknown) => {
      data.set(key, value);
    },
    update: (key: string, updater: (current: unknown) => unknown) => {
      const current = data.get(key);
      data.set(key, updater(current));
    },
  } as unknown as ToolStore;
}

function buildUltraSwarmXml(expertCount: number, bodySize: number): string {
  const lines = [
    '<ultra_swarm_result run_id="run-test-1">',
    '<task>integration task</task>',
    '<strategy>parallel</strategy>',
    '<summary>completed: 1, failed: 0, aborted: 0</summary>',
  ];
  for (let i = 0; i < expertCount; i++) {
    const body = `VERDICT: PASS evidence_ids: ev-${String(i)} ${'x'.repeat(bodySize)}`;
    lines.push(
      `<expert expert_id="expert-${String(i)}" name="Expert ${String(i)}" emoji="🔬" color="blue" phase="implement" focus="code" outcome="completed" verdict="PASS" required_for_completion="true" evidence_ids="ev-${String(i)}">`,
      body,
      '</expert>',
    );
  }
  lines.push(
    '<integration_report run_id="run-test-1"><headline>summary</headline></integration_report>',
    '<integration_handoff>Parent agent must integrate the accepted specialist handoffs into product-file changes and verification evidence.</integration_handoff>',
    '</ultra_swarm_result>',
  );
  return lines.join('\n');
}

describe('boundary compaction', () => {
  it('collapseForHandoff caps at 70 chars by default', () => {
    expect(collapseForHandoff('a'.repeat(2_000)).length).toBe(70);
  });

  it('detects swarm tool results', () => {
    expect(isSwarmToolResult('<ultra_swarm_result run_id="x">')).toBe(true);
    expect(isSwarmToolResult('<agent_swarm_result>')).toBe(true);
    expect(isSwarmToolResult('plain text')).toBe(false);
  });

  it('archives expert bodies and preserves metadata for many experts', () => {
    const store = mockStore();
    const raw = buildUltraSwarmXml(16, 4_000);
    const result = compactSwarmToolResult(store, raw, { runId: 'run-test-1' });

    expect(result.applied).toBe(true);
    expect(result.archiveIds).toHaveLength(16);
    expect(result.output.length).toBeLessThanOrEqual(SWARM_TOTAL_RESULT_MAX_CHARS);
    expect(result.output).toContain('expert_id="expert-0"');
    expect(result.output).toContain('verdict="PASS"');
    expect(result.output).toContain('evidence_ids="ev-0"');
    expect(result.output).toContain('[liora-archived id=');
    expect(result.output).toContain('LioraExpand');
    expect(result.output).not.toContain('x'.repeat(500));
  });

  it('round-trips archived expert bodies through LioraExpand', () => {
    const store = mockStore();
    const body = 'VERDICT: PASS detailed implementation notes';
    const raw = [
      '<ultra_swarm_result run_id="run-rt">',
      '<task>t</task>',
      `<expert expert_id="coder" name="Coder" emoji="💻" color="green" phase="implement" focus="code" outcome="completed" verdict="PASS" required_for_completion="true">`,
      body,
      '</expert>',
      '</ultra_swarm_result>',
    ].join('\n');
    const compacted = compactSwarmToolResult(store, raw, { runId: 'run-rt' });
    const archiveId = compacted.archiveIds[0]!;
    const restored = expandSwarmArchivedBody(store, archiveId);
    expect(restored).toBe(body);
    expect(expandArchivedContent(store, archiveId).found).toBe(true);
  });

  it('masks stale swarm tool results for projection', () => {
    const store = mockStore();
    const raw = buildUltraSwarmXml(2, 2_000);
    const compacted = compactSwarmToolResult(store, raw);
    const masked = maskStaleSwarmToolResult(compacted.output);
    expect(masked).toContain('[liora-archived id=');
    expect(masked).not.toContain('x'.repeat(500));
  });

  it('compacts agent_swarm_result subagent bodies', () => {
    const store = mockStore();
    const raw = [
      '<agent_swarm_result>',
      '<summary>completed: 1</summary>',
      `<subagent outcome="completed">${'y'.repeat(3_000)}</subagent>`,
      '</agent_swarm_result>',
    ].join('\n');
    const result = compactSwarmToolResult(store, raw);
    expect(result.archiveIds).toHaveLength(1);
    expect(result.output).toContain('[liora-archived id=');
    expect(result.output).not.toContain('y'.repeat(500));
  });
});
