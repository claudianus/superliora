import { describe, expect, it } from 'vitest';

import {
  extractSwarmRunsFromMessages,
  extractSwarmRunsFromText,
  renderSwarmRunsMemorySection,
} from '../../../src/agent/compaction/swarm-memory-extract';

describe('extractSwarmRunsFromText', () => {
  it('returns an empty list for non-swarm input', () => {
    expect(extractSwarmRunsFromText('plain prose')).toEqual([]);
  });

  it('extracts a single ultra_swarm run with experts, evidence, archive, and work_node_ids', () => {
    const xml = [
      '<ultra_swarm_result run_id="run-1">',
      '<selection_reason>...</selection_reason>',
      '<expert expert_id="e-1" verdict="PASS" phase="plan" evidence_ids="ac-1,ac-2">',
      'body [liora-archived id=2b184b224f87]',
      '</expert>',
      '<expert expert_id="e-2" verdict="FAIL" evidence_ids="ac-3">',
      'body',
      '</expert>',
      'work_node_ids="n-1,n-2"',
      '</ultra_swarm_result>',
    ].join('\n');
    const runs = extractSwarmRunsFromText(xml);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe('run-1');
    expect(runs[0]?.experts).toHaveLength(2);
    expect(runs[0]?.experts[0]?.expertId).toBe('e-1');
    expect(runs[0]?.experts[0]?.verdict).toBe('PASS');
    expect(runs[0]?.experts[0]?.phase).toBe('plan');
    expect(runs[0]?.experts[0]?.evidenceIds).toEqual(['ac-1', 'ac-2']);
    expect(runs[0]?.experts[0]?.archiveId).toBe('2b184b224f87');
    expect(runs[0]?.experts[1]?.verdict).toBe('FAIL');
    expect(runs[0]?.workNodeIds).toEqual(['n-1', 'n-2']);
  });

  it('falls back to unknown-run and unknown expert when attributes are missing', () => {
    // Pin the realistic empty-attrs case: an `<expert ...>` whose attr
    // group matches a single whitespace character. The parser then
    // treats the absent `expert_id` / `verdict` / `evidence_ids` as
    // `unknown` / `PASS` / `[]`.
    const xml = [
      '<agent_swarm_result>',
      '<expert ',
      '>',
      'body',
      '</expert>',
      '</agent_swarm_result>',
    ].join('\n');
    const runs = extractSwarmRunsFromText(xml);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe('unknown-run');
    expect(runs[0]?.experts[0]?.expertId).toBe('unknown');
    expect(runs[0]?.experts[0]?.verdict).toBe('PASS');
    expect(runs[0]?.experts[0]?.archiveId).toBeUndefined();
  });
});

describe('extractSwarmRunsFromMessages', () => {
  it('walks every message and concatenates text parts before parsing', () => {
    const messages = [
      {
        content: [
          {
            type: 'text',
            text: '<ultra_swarm_result run_id="r1">\n<expert expert_id="e-1" verdict="PASS" evidence_ids="a-1">\nx\n</expert>\n</ultra_swarm_result>',
          },
        ],
      },
    ];
    const runs = extractSwarmRunsFromMessages(messages);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe('r1');
  });

  it('skips messages with no text content', () => {
    const messages = [
      { content: [{ type: 'image', src: 'x' }] },
      { content: [] },
    ];
    expect(extractSwarmRunsFromMessages(messages)).toEqual([]);
  });
});

describe('renderSwarmRunsMemorySection', () => {
  it('returns an empty string for no runs', () => {
    expect(renderSwarmRunsMemorySection([])).toBe('');
  });

  it('renders run_id, expert attributes, and work_node_ids', () => {
    const runs = [
      {
        runId: 'run-1',
        experts: [
          {
            expertId: 'e-1',
            verdict: 'PASS',
            evidenceIds: ['ac-1', 'ac-2'],
            archiveId: '2b184b224f87',
            phase: 'plan',
          },
        ],
        workNodeIds: ['n-1', 'n-2'],
      },
    ];
    const text = renderSwarmRunsMemorySection(runs);
    expect(text).toContain('swarm_runs:');
    expect(text).toContain('run_id=run-1');
    expect(text).toContain('expert_id=e-1');
    expect(text).toContain('verdict=PASS');
    expect(text).toContain('evidence_ids=ac-1,ac-2');
    expect(text).toContain('archive_id=2b184b224f87');
    expect(text).toContain('phase=plan');
    expect(text).toContain('work_node_ids=n-1,n-2');
  });

  it('emits evidence_ids=none when an expert has no evidence', () => {
    const runs = [
      {
        runId: 'run-2',
        experts: [
          { expertId: 'e-1', verdict: 'FAIL', evidenceIds: [] },
        ],
        workNodeIds: [],
      },
    ];
    const text = renderSwarmRunsMemorySection(runs);
    expect(text).toContain('evidence_ids=none');
  });
});
