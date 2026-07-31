import { describe, expect, it } from 'vitest';

import { REDACTED_SECRET, redactSecretsInText } from '#/security/redaction';
import {
  DEFAULT_WORKSPACE_ACCESS_POLICY,
  PathSecurityError,
  resolvePathAccess,
} from '#/tools/policies/path-access';
import type { WorkspaceConfig } from '#/tools/support/workspace';

/** W6 레드팀 소프트 — 로그 마스킹·경로 샌드박스 스모크 */
describe('W6 redteam soft', () => {
  const workspace: WorkspaceConfig = { workspaceDir: '/workspace', additionalDirs: [] };

  it('redactSecretsInText: sk-/Bearer/AIza 마스킹', () => {
    const sample =
      'sk-abcdefghijklmnopqrstuvwxyz Authorization: Bearer eyJhbGciOiJIUzI1NiJ9 AIzaSyD-example-key-should-vanish';
    const { text, redactions } = redactSecretsInText(sample);
    expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/i);
    expect(text).not.toMatch(/AIza[A-Za-z0-9_-]{20,}/);
    expect(text).toContain(REDACTED_SECRET);
    expect(redactions).toBeGreaterThanOrEqual(3);
  });

  it('path-access: .env 쓰기 거부 (PATH_SENSITIVE)', () => {
    try {
      resolvePathAccess('.env', '/workspace/project', workspace, {
        operation: 'write',
        policy: DEFAULT_WORKSPACE_ACCESS_POLICY,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PathSecurityError);
      expect((error as PathSecurityError).code).toBe('PATH_SENSITIVE');
      return;
    }
    throw new Error('expected PATH_SENSITIVE for .env write');
  });
});
