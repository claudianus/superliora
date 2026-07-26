import { describe, expect, it } from 'vitest';

import { humanizeCollaborationEvent, looksLikeProtocolMessage } from '../../src/session/swarm-humanize';

describe('swarm-humanize.ts — looksLikeProtocolMessage', () => {
  it('returns true for a string containing an XML tag', () => {
    expect(looksLikeProtocolMessage('<handoff>body</handoff>')).toBe(true);
    expect(looksLikeProtocolMessage('plain <b>text</b> prose')).toBe(true);
  });

  it('returns false for free prose without XML', () => {
    expect(looksLikeProtocolMessage('just plain text')).toBe(false);
    expect(looksLikeProtocolMessage('  ')).toBe(false);
  });
});

describe('swarm-humanize.ts — humanizeCollaborationEvent', () => {
  it('emits from-only header for empty body', () => {
    const out = humanizeCollaborationEvent({
      fromExpertId: 'e-1',
      body: '   ',
    });
    expect(out.headline).toBe('e-1');
    expect(out.body).toBe('');
    expect(out.humanized).toBe(false);
  });

  it('keeps free prose as the body (non-protocol)', () => {
    const out = humanizeCollaborationEvent({
      fromExpertId: 'e-1',
      body: 'just plain text',
    });
    expect(out.headline).toBe('e-1');
    expect(out.body).toBe('just plain text');
    expect(out.humanized).toBe(false);
  });

  it('humanizes <handoff> with expert/phase/verdict and inner body', () => {
    const out = humanizeCollaborationEvent({
      fromExpertId: 'e-1',
      body: '<handoff expert_id="e-1" phase="implement" verdict="PASS">shipped</handoff>',
    });
    expect(out.headline).toBe('e-1 · implement · 통과');
    expect(out.body).toBe('shipped');
    expect(out.severity).toBe('success');
    expect(out.humanized).toBe(true);
  });

  it('humanizes <handoff> with FAIL verdict as error severity', () => {
    const out = humanizeCollaborationEvent({
      fromExpertId: 'e-1',
      body: '<handoff expert_id="e-1" phase="review" verdict="FAIL">block</handoff>',
    });
    expect(out.severity).toBe('error');
  });

  it('humanizes <expert> blocks with name/outcome/verdict', () => {
    const out = humanizeCollaborationEvent({
      fromExpertId: 'e-1',
      body: '<expert name="Alpha" outcome="completed" verdict="PASS"><selection_reason>best</selection_reason></expert>',
    });
    expect(out.headline).toBe('Alpha · completed · 통과');
    expect(out.body).toBe('best');
    expect(out.severity).toBe('success');
  });

  it('humanizes <team_roster> with up to 6 unique names', () => {
    const out = humanizeCollaborationEvent({
      fromExpertId: 'e-1',
      body: '<team_roster><e name="Alpha"/><e name="Bravo"/><e name="Alpha"/><e name="Charlie"/><e name="Delta"/><e name="Echo"/><e name="Foxtrot"/><e name="Golf"/></team_roster>',
    });
    expect(out.headline).toBe('팀 로스터');
    expect(out.body).toContain('Alpha');
    expect(out.body).toContain('…');
  });

  it('humanizes <swarm_channel_rules> as neutral preamble', () => {
    const out = humanizeCollaborationEvent({
      fromExpertId: 'e-1',
      body: '<swarm_channel_rules>Use SwarmChannel for coordination.</swarm_channel_rules>',
    });
    expect(out.headline).toBe('협업 규칙');
    expect(out.body).toContain('Use SwarmChannel');
    expect(out.severity).toBe('neutral');
  });
});
