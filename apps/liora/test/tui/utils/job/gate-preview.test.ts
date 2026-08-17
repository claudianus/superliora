import { describe, expect, it } from 'vitest';

import {
  formatBriefPreviewLines,
  formatGateAckDetail,
  formatGateChecklistLine,
  formatMissingGateEvidence,
} from '#/tui/utils/job/gate-preview';
import { upsertConductorJobCard } from '#/tui/utils/job/job-strip';
import type { JobSnapshot } from '@superliora/protocol';

describe('gate-preview', () => {
  it('formats checklist glyphs', () => {
    expect(
      formatGateChecklistLine({
        visual: 'pass',
        review: 'pending',
        tests: 'fail',
        typecheck: 'na',
      }),
    ).toBe('visual✓ review… tests✗ typecheck–');
  });

  it('lists pending/fail gates as missing evidence', () => {
    expect(
      formatMissingGateEvidence({
        visual: 'pass',
        review: 'pending',
        tests: 'fail',
        typecheck: 'na',
      }),
    ).toEqual(['review: pending', 'tests: fail']);
  });

  it('maps brief + gate into ACK detail', () => {
    const detail = formatGateAckDetail({
      gateChecklist: {
        visual: 'na',
        review: 'pass',
        tests: 'pass',
        typecheck: 'pass',
      },
      briefPreview: {
        successCriteria: ['tests green'],
        mustNotTouch: ['apps/site'],
      },
    });
    expect(detail).toContain('visual–');
    expect(detail).toContain('ok: tests green');
    expect(detail).toContain("don't touch: apps/site");
  });

  it('leads ACK detail with the effect summary', () => {
    const detail = formatGateAckDetail({
      effectPreview: { summary: 'general · this checkout · Conductor judged' },
      gateChecklist: {
        visual: 'na',
        review: 'na',
        tests: 'na',
        typecheck: 'na',
      },
    });
    expect(detail?.split('\n')[0]).toBe('general · this checkout · Conductor judged');
    expect(detail).toContain('visual–');
  });

  it('carries gateChecklist and briefPreview onto ConductorJobCard', () => {
    const job: JobSnapshot = {
      id: 'job_gate',
      title: 'Gate job',
      status: 'queued',
      kind: 'implement',
      priority: 1,
      briefPreview: { successCriteria: ['ship'] },
      gateChecklist: {
        visual: 'pending',
        review: 'pending',
        tests: 'pending',
        typecheck: 'pending',
      },
    };
    const cards = upsertConductorJobCard([], job, undefined, 1_000);
    expect(cards[0]?.briefPreview?.successCriteria).toEqual(['ship']);
    expect(cards[0]?.gateChecklist?.tests).toBe('pending');
    expect(formatBriefPreviewLines(cards[0]!.briefPreview!).length).toBeGreaterThan(0);
  });

  it('carries effectPreview onto ConductorJobCard', () => {
    const job: JobSnapshot = {
      id: 'job_effect',
      title: 'Effect job',
      status: 'queued',
      kind: 'task',
      priority: 0,
      effectPreview: {
        isolation: 'checkout',
        chip: 'checkout',
        summary: 'general · this checkout · Conductor judged',
        taskTrack: 'general',
        taskTrackSource: 'inferred',
      },
    };
    const cards = upsertConductorJobCard([], job, undefined, 1_000);
    expect(cards[0]?.effectPreview?.chip).toBe('checkout');
    expect(cards[0]?.effectPreview?.summary).toContain('Conductor judged');
  });
});
