import { describe, expect, it } from 'vitest';

import {
  REDTEAM_SOFT_SUITE_REL_PATH,
  REDTEAM_SOFT_SUITE_TIP,
  formatRedteamSoftSuitePresentLine,
  isRedteamSoftSuitePresent,
  redactSecretsStatusLine,
} from '#/security/status';

describe('security status glance', () => {
  it('links W6 redteam-soft suite', () => {
    expect(REDTEAM_SOFT_SUITE_TIP).toContain('redteam-soft');
    expect(REDTEAM_SOFT_SUITE_TIP).toContain('PATH_SENSITIVE');
    expect(REDTEAM_SOFT_SUITE_TIP).toContain(REDTEAM_SOFT_SUITE_REL_PATH);
  });

  it('detects W6 redteam-soft suite on disk', () => {
    expect(isRedteamSoftSuitePresent()).toBe(true);
    expect(formatRedteamSoftSuitePresentLine()).toContain('W6 redteam suite: present');
    expect(formatRedteamSoftSuitePresentLine()).toContain(REDTEAM_SOFT_SUITE_REL_PATH);
  });

  it('reports redactSecrets posture', () => {
    expect(redactSecretsStatusLine()).toContain('redactSecretsInText');
    expect(redactSecretsStatusLine()).toContain('sk-*');
  });
});
