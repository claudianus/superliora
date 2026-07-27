import { describe, expect, it } from 'vitest';

import {
  buildUltraSwarmIntegrationReportXml,
  extractHandoffDigest,
} from '../../src/tools/builtin/collaboration/ultra-swarm-integration-report';

describe('ultra-swarm integration report', () => {
  it('extracts structured handoff sections', () => {
    const body = [
      '## Summary',
      'Implemented minigame modules and wired economy state.',
      '',
      '## Findings',
      '- Created src/minigames/*.js',
      '- Updated state.js',
      '',
      '## Risks & Gaps',
      '- Integration tests still missing',
    ].join('\n');

    expect(extractHandoffDigest(body)).toMatchObject({
      summary: 'Implemented minigame modules and wired economy state.',
      findings: '- Created src/minigames/*.js - Updated state.js',
      risksAndGaps: '- Integration tests still missing',
    });
  });

  it('builds integration_report XML with per-agent summaries', () => {
    const xml = buildUltraSwarmIntegrationReportXml(
      [
        {
          spec: {
            expertId: 'impl-engineer',
            expertName: 'Impl Engineer',
            emoji: '🔧',
            phase: 'implement',
            focus: 'build',
            coverageLane: 'implement',
            workNodeIds: ['wg1'],
          },
          status: 'completed',
          verdict: 'PASS',
          evidenceIds: ['ev_1'],
          result: [
            '## Summary',
            'Built core gameplay loop.',
            '',
            '## Risks & Gaps',
            '- Needs QA pass',
          ].join('\n'),
        },
        {
          spec: {
            expertId: 'qa-reviewer',
            expertName: 'QA Reviewer',
            emoji: '✅',
            phase: 'review',
            focus: 'review',
            workNodeIds: [],
          },
          status: 'completed',
          verdict: 'BLOCKED',
          evidenceIds: [],
          result: '## Summary\nBlocked on missing tests.\n\n## Risks & Gaps\n- No automated coverage',
        },
      ],
      'run-1',
    );

    expect(xml).toContain('<integration_report run_id="run-1">');
    expect(xml).toContain('<headline>');
    expect(xml).toContain('agent expert_id="impl-engineer"');
    expect(xml).toContain('<summary>Built core gameplay loop.</summary>');
    expect(xml).toContain('verdict="BLOCKED"');
    expect(xml).toContain('<open_gaps>');
  });

  it('flags completed experts without cited evidence (T4-7b)', () => {
    const xml = buildUltraSwarmIntegrationReportXml(
      [
        {
          spec: {
            expertId: 'bare-claim',
            expertName: 'Bare Claim',
            emoji: '🫥',
            phase: 'implement',
            focus: 'build',
            workNodeIds: [],
          },
          status: 'completed',
          verdict: 'PASS',
          evidenceIds: [],
          result: '## Summary\nEverything works now, trust me.',
        },
        {
          spec: {
            expertId: 'cited',
            expertName: 'Cited Worker',
            emoji: '📎',
            phase: 'implement',
            focus: 'build',
            workNodeIds: [],
          },
          status: 'completed',
          verdict: 'PASS',
          evidenceIds: [],
          result: '## Summary\nFixed the parser at src/parse/lexer.ts:42 and added a regression test.',
        },
      ],
      'run-evidence',
    );

    expect(xml).toContain('expert_id="bare-claim"');
    expect(xml).toMatch(/expert_id="bare-claim"[^>]*evidence="missing"/);
    expect(xml).not.toMatch(/expert_id="cited"[^>]*evidence="missing"/);
    expect(xml).toContain('missing_evidence="1"');
    expect(xml).toContain('1 missing evidence');
  });
});
