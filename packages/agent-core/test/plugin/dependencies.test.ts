import { describe, expect, it } from 'vitest';

import { resolvePluginDependencies } from '../../src/plugin/dependencies';
import type { PluginRecord } from '../../src/plugin/types';

function record(id: string, version?: string): PluginRecord {
  return {
    id,
    root: `/tmp/${id}`,
    scope: 'user',
    enabled: true,
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'local-path',
    originalSource: id,
    state: 'ok',
    skillCount: 0,
    agentCount: 0,
    diagnostics: [],
    manifest:
      version === undefined
        ? undefined
        : {
            name: id,
            version,
            displayName: id,
            skills: [],
            commands: [],
            agents: [],
            hooks: [],
            monitors: [],
          },
  };
}

describe('resolvePluginDependencies', () => {
  it('reports missing and exact mismatches', () => {
    const installed = [record('base', '1.0.0')];
    const result = resolvePluginDependencies({
      dependencies: {
        base: '2.0.0',
        other: '*',
      },
      installed,
    });
    expect(result.resolutions.find((r) => r.id === 'base')?.status).toBe('mismatch');
    expect(result.resolutions.find((r) => r.id === 'other')?.status).toBe('missing');
    expect(result.missingIds).toEqual(['other']);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('treats wildcard ranges as presence-only', () => {
    const result = resolvePluginDependencies({
      dependencies: { base: '*' },
      installed: [record('base', '9.9.9')],
    });
    expect(result.resolutions[0]?.status).toBe('satisfied');
    expect(result.diagnostics).toHaveLength(0);
  });
});
