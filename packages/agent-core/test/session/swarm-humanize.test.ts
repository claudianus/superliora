import { describe, expect, it } from 'vitest';

import {
  humanizeCollaborationEvent,
  looksLikeProtocolMessage,
} from '../../src/session/swarm-humanize';

describe('looksLikeProtocolMessage', () => {
  it('detects XML handoff / team roster payloads', () => {
    expect(
      looksLikeProtocolMessage(
        '<handoff expert_id="a" phase="implement" verdict="PASS">done</handoff>',
      ),
    ).toBe(true);
    expect(looksLikeProtocolMessage('<team_roster><expert name="Alice"/></team_roster>')).toBe(
      true,
    );
    expect(looksLikeProtocolMessage('VERDICT: PASS')).toBe(true);
    expect(
      looksLikeProtocolMessage(
        '<debate_draft_pack><debate_draft phase="critic">x</debate_draft></debate_draft_pack>',
      ),
    ).toBe(true);
  });

  it('leaves plain chat alone', () => {
    expect(looksLikeProtocolMessage('auth middleware missing tests')).toBe(false);
    expect(looksLikeProtocolMessage('patch ready for review')).toBe(false);
  });
});

describe('humanizeCollaborationEvent', () => {
  it('passes plain bodies through', () => {
    const result = humanizeCollaborationEvent({
      body: 'auth middleware missing tests',
      fromName: 'AppSec',
      channel: 'blocker',
    });
    expect(result.humanized).toBe(false);
    expect(result.body).toBe('auth middleware missing tests');
    expect(result.severity).toBe('warning');
  });

  it('humanizes handoff XML into a scannable line', () => {
    const result = humanizeCollaborationEvent({
      body: '<handoff expert_id="impl-1" phase="implement" verdict="PASS">Dashboard attach scenario green</handoff>',
      fromName: 'Impl',
    });
    expect(result.humanized).toBe(true);
    expect(result.headline).toContain('impl-1');
    expect(result.body).toContain('Dashboard attach');
    expect(result.severity).toBe('success');
  });

  it('humanizes team roster XML', () => {
    const result = humanizeCollaborationEvent({
      body: '<team_roster><expert name="Alice"/><expert name="Bob"/></team_roster>',
    });
    expect(result.humanized).toBe(true);
    expect(result.headline).toContain('로스터');
    expect(result.body).toMatch(/Alice|Bob/);
  });

  it('humanizes debate envelopes', () => {
    const result = humanizeCollaborationEvent({
      body: '<debate id="d1" work_node="ac_1"><artifact>foo()</artifact><current_phase>critic</current_phase><instruction>Be adversarial</instruction></debate>',
    });
    expect(result.humanized).toBe(true);
    expect(result.headline.toLowerCase()).toContain('토론');
    expect(result.body.length).toBeGreaterThan(0);
  });

  it('humanizes debate_draft_pack for reviewers', () => {
    const result = humanizeCollaborationEvent({
      body:
        '<debate_draft_pack><debate_draft debate_id="d1" work_node="ac_1" author="impl" critic="rev" risk="medium" phase="critic">use auth middleware</debate_draft></debate_draft_pack>',
    });
    expect(result.humanized).toBe(true);
    expect(result.headline).toContain('토론 초안');
    expect(result.body).toMatch(/ac_1|auth middleware/);
  });

  it('humanizes dependency_handoff upstream summaries', () => {
    const result = humanizeCollaborationEvent({
      body:
        '<dependency_handoff><upstream expert_id="impl-1" phase="implement" verdict="PASS">ok</upstream></dependency_handoff>',
    });
    expect(result.humanized).toBe(true);
    expect(result.headline).toContain('의존');
    expect(result.body).toMatch(/impl-1|통과|PASS/);
  });

  it('humanizes review_revision_request', () => {
    const result = humanizeCollaborationEvent({
      body:
        '<review_revision_request><prior_review expert_id="rev-1" verdict="FAIL">missing tests</prior_review></review_revision_request>',
    });
    expect(result.humanized).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.headline).toContain('수정');
  });
});
