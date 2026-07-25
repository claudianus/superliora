import { describe, expect, it } from 'vitest';
import { CredentialHealthStore } from '@superliora/oauth';

import { autoAssignRoleModelsWithHealth } from '../../src/utils/model-presets';

describe('autoAssignRoleModelsWithHealth', () => {
  it('excludes auth-rejected providers from role assignments', () => {
    const store = new CredentialHealthStore(new Map());
    store.markAuthRejected('xai-grok', { failureReason: 'rejected' });
    const assignments = autoAssignRoleModelsWithHealth(
      [
        { id: 'grok-4.5', alias: 'grok', provider: 'xai-grok', tier: 'high' },
        { id: 'gpt-4.1', alias: 'gpt', provider: 'openai', tier: 'balanced' },
        { id: 'flash-lite', alias: 'flash', provider: 'openai', tier: 'ultra-cheap' },
      ],
      {
        hasCredential: (id) => id === 'openai' || id === 'xai-grok',
        store,
      },
    );
    let assigned = 0;
    for (const assignment of Object.values(assignments)) {
      if (assignment === undefined) continue;
      assigned += 1;
      expect(assignment.modelAlias ?? assignment.modelId).not.toBe('grok');
      expect(assignment.modelId).not.toBe('grok-4.5');
    }
    expect(assigned).toBeGreaterThan(0);
  });
});
