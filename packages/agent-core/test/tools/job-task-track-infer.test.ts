/**
 * Effect-judgment mapping + JSON parse. No prompt-keyword harness branch.
 */

import { describe, expect, it } from 'vitest';

import {
  JOB_TASK_TRACK_CONFIDENCE_FLOOR,
  parseJobTaskTrackEffectJudgment,
  trackFromEffectJudgment,
} from '../../src/tools/builtin/job/job-task-track-infer';

describe('trackFromEffectJudgment', () => {
  it('keeps coding when workspace mutation, isolation, or repo proof is present', () => {
    expect(
      trackFromEffectJudgment({
        mutatesWorkspace: true,
        needsGitIsolation: false,
        proofKind: 'host_observable',
        confidence: 0.95,
      }),
    ).toBe('coding');
    expect(
      trackFromEffectJudgment({
        mutatesWorkspace: false,
        needsGitIsolation: true,
        proofKind: 'host_observable',
        confidence: 0.95,
      }),
    ).toBe('coding');
    expect(
      trackFromEffectJudgment({
        mutatesWorkspace: false,
        needsGitIsolation: false,
        proofKind: 'repo_change',
        confidence: 0.95,
      }),
    ).toBe('coding');
  });

  it('uses general only for confident host-observable work with no repo effect', () => {
    expect(
      trackFromEffectJudgment({
        mutatesWorkspace: false,
        needsGitIsolation: false,
        proofKind: 'host_observable',
        confidence: 0.9,
      }),
    ).toBe('general');
  });

  it('fails closed to coding below the confidence floor', () => {
    expect(
      trackFromEffectJudgment({
        mutatesWorkspace: false,
        needsGitIsolation: false,
        proofKind: 'host_observable',
        confidence: JOB_TASK_TRACK_CONFIDENCE_FLOOR - 0.01,
      }),
    ).toBe('coding');
  });
});

describe('parseJobTaskTrackEffectJudgment', () => {
  it('maps a host-effect payload to general', () => {
    expect(
      parseJobTaskTrackEffectJudgment(
        '{"mutates_workspace":false,"needs_git_isolation":false,"proof_kind":"host_observable","confidence":0.88,"rationale":"launch a host app"}',
      ),
    ).toMatchObject({ track: 'general', proofKind: 'host_observable' });
  });

  it('maps mixed effects to coding', () => {
    expect(
      parseJobTaskTrackEffectJudgment(
        '{"mutates_workspace":true,"needs_git_isolation":true,"proof_kind":"repo_change","confidence":0.8,"rationale":"change in-repo deps then restart"}',
      )?.track,
    ).toBe('coding');
  });

  it('rejects incomplete JSON', () => {
    expect(parseJobTaskTrackEffectJudgment('{"mutates_workspace":true}')).toBeUndefined();
    expect(parseJobTaskTrackEffectJudgment('not json')).toBeUndefined();
  });
});
