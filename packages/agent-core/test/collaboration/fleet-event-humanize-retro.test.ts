import { describe, expect, it } from 'vitest';

import { humanizeCollaborationEvent, looksLikeProtocolMessage } from '#/fleet';

/**
 * S3-R7 retro guard for event-humanize (registry R6 retro_guard_needed):
 * the original swarm-humanize body shipped without characterization tests.
 * These cases pin the humanizer's protocol branches so later cleanup cannot
 * silently regress the TUI live feed.
 */
describe('fleet/event-humanize.ts — retro guard (S3-R7)', () => {
  it('flags VERDICT lines and protocol blocks, ignores prose', () => {
    expect(looksLikeProtocolMessage('VERDICT: PASS')).toBe(true);
    expect(looksLikeProtocolMessage('<team_roster><member name="A"/></team_roster>')).toBe(true);
    expect(looksLikeProtocolMessage('The deploy finished cleanly.')).toBe(false);
  });

  it('humanizes handoff blocks with localized verdict tokens', () => {
    const out = humanizeCollaborationEvent({
      body: '<handoff expert_id="e-9" phase="review" verdict="PASS">Review <b>notes</b> here</handoff>',
    });
    expect(out.headline).toBe('e-9 · review · 통과');
    expect(out.body).toBe('Review notes here');
    expect(out.severity).toBe('success');
    expect(out.humanized).toBe(true);
  });

  it('falls back to the default handoff body when the block is empty', () => {
    const out = humanizeCollaborationEvent({
      body: '<handoff expert_id="e-9" phase="review" verdict="BLOCK"></handoff>',
    });
    expect(out.body).toBe('전문가 핸드오프를 전달했습니다.');
    expect(out.severity).toBe('error');
  });

  it('maps failed expert outcomes to error severity', () => {
    const out = humanizeCollaborationEvent({
      body: '<expert name="Alpha" outcome="failed" verdict="REJECT">attempt log</expert>',
    });
    expect(out.headline).toBe('Alpha · failed · 차단/실패');
    expect(out.severity).toBe('error');
  });

  it('keeps free prose untouched except whitespace collapse', () => {
    const out = humanizeCollaborationEvent({
      fromName: 'Scout',
      body: '  Build   is green.\n',
    });
    expect(out.headline).toBe('Scout');
    expect(out.body).toBe('Build is green.');
    expect(out.humanized).toBe(false);
  });

  it('derives severity from channel/tag for non-protocol events', () => {
    expect(
      humanizeCollaborationEvent({ body: 'halt requested', channel: 'block' }).severity,
    ).toBe('warning');
    expect(
      humanizeCollaborationEvent({ body: 'round complete', tag: 'done' }).severity,
    ).toBe('success');
  });

  it('strips unknown protocol XML down to plain text', () => {
    const out = humanizeCollaborationEvent({
      fromExpertId: 'e-2',
      body: '<custom_envelope><inner>payload</inner></custom_envelope>',
    });
    expect(out.headline).toBe('e-2');
    expect(out.body).toBe('payload');
    expect(out.humanized).toBe(true);
  });
});
