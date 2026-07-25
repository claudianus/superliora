import { describe, expect, it } from 'vitest';

import {
  buildDebateDraftHandoffPack,
  debateDraftPhasesForHandoff,
} from '../../../../src/index';

describe('buildDebateDraftHandoffPack', () => {
  it('returns empty string when no drafts match the phase', () => {
    expect(
      buildDebateDraftHandoffPack(
        [
          {
            debateId: 'd1',
            workNodeId: 'n1',
            phase: 'implement',
            riskLevel: 'complex',
            authorExpertId: 'author',
            criticExpertId: 'critic',
            draftExcerpt: 'draft body',
          },
        ],
        'review',
      ),
    ).toBe('');
  });

  it('serializes matching drafts with escaped XML for review handoff', () => {
    const pack = buildDebateDraftHandoffPack(
      [
        {
          debateId: 'd1',
          workNodeId: 'node-a',
          phase: 'implement',
          riskLevel: 'complex',
          authorExpertId: 'eng-a',
          criticExpertId: 'rev-b',
          draftExcerpt: 'Changed <path> & ran tests',
        },
      ],
      'implement',
    );
    expect(pack).toContain('<debate_draft_pack>');
    expect(pack).toContain('debate_id="d1"');
    expect(pack).toContain('work_node="node-a"');
    expect(pack).toContain('author="eng-a"');
    expect(pack).toContain('critic="rev-b"');
    expect(pack).toContain('phase="implement"');
    expect(pack).toContain('Changed &lt;path&gt; &amp; ran tests');
    expect(pack).toContain('Reviewers: cite claims');
  });

  it('includes multi-phase drafts for review handoff', () => {
    const pack = buildDebateDraftHandoffPack(
      [
        {
          debateId: 'd-impl',
          workNodeId: 'n1',
          phase: 'implement',
          riskLevel: 'high',
          authorExpertId: 'author-1',
          criticExpertId: 'critic-1',
          draftExcerpt: 'Implement draft body',
        },
        {
          debateId: 'd-review',
          workNodeId: 'n2',
          phase: 'review',
          riskLevel: 'med',
          authorExpertId: 'author-2',
          criticExpertId: 'critic-2',
          draftExcerpt: 'Review draft body',
        },
      ],
      debateDraftPhasesForHandoff('review'),
    );
    expect(pack).toContain('debate_id="d-impl"');
    expect(pack).toContain('debate_id="d-review"');
    expect(debateDraftPhasesForHandoff('implement')).toEqual(['implement', 'plan']);
  });
});
