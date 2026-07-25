import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildClaudeImportPlan,
  formatClaudeImportSummary,
  resolveClaudeImportRoots,
  validateClaudeImportPath,
} from '#/tui/utils/claude-import';

const WORK = '/tmp/superliora-project';

describe('resolveClaudeImportRoots', () => {
  it('allowlists only project .claude and ~/.claude', () => {
    const roots = resolveClaudeImportRoots(WORK);
    expect(roots).toHaveLength(2);
    expect(roots[0]!.kind).toBe('project');
    expect(roots[0]!.path).toBe(join(WORK, '.claude'));
    expect(roots[1]!.kind).toBe('global');
    expect(roots[1]!.path).toBe(join(homedir(), '.claude'));
  });
});

describe('validateClaudeImportPath', () => {
  it('accepts project .claude settings path', () => {
    const result = validateClaudeImportPath(`${WORK}/.claude/settings.json`, WORK);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.root).toBe('project');
      expect(result.absolutePath).toContain('.claude');
    }
  });

  it('accepts global ~/.claude path', () => {
    const result = validateClaudeImportPath('~/.claude/settings.json', WORK);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.root).toBe('global');
  });

  it('rejects path escape outside allowlist', () => {
    const result = validateClaudeImportPath(`${WORK}/.claude/../secrets.env`, WORK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('허용된 Claude 경로');
      // Must not echo secret file contents — reason is path policy only.
      expect(result.reason).not.toMatch(/sk-|API_KEY=/i);
    }
  });

  it('rejects arbitrary absolute paths', () => {
    const result = validateClaudeImportPath('/etc/passwd', WORK);
    expect(result.ok).toBe(false);
  });
});

describe('buildClaudeImportPlan + summary', () => {
  it('keeps allowlisted entries and rejects outsiders', () => {
    const plan = buildClaudeImportPlan(WORK, [
      {
        absolutePath: `${WORK}/.claude/skills/foo/SKILL.md`,
        relativePath: 'skills/foo/SKILL.md',
        rootKind: 'project',
      },
      {
        absolutePath: '/tmp/evil/hooks.json',
        relativePath: 'hooks.json',
        rootKind: 'project',
      },
    ]);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]!.kind).toBe('skills');
    expect(plan.rejected).toHaveLength(1);

    const summary = formatClaudeImportSummary(plan);
    expect(summary).toContain('1개 항목');
    expect(summary).toContain('권한 deny');
    expect(summary).not.toMatch(/sk-|token=/i);
  });
});
