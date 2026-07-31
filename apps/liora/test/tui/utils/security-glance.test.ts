import { describe, expect, it } from 'vitest';

import {
  buildSecuritySettingsLines,
  formatMcpAllowlistLines,
  formatNetworkEgressLines,
  formatPermissionModeLine,
  formatSandboxProfileLine,
  formatWorkspaceSandboxLines,
  securityNavigationLines,
  securitySecretRedactionLines,
  securitySensorLines,
} from '#/tui/utils/security/security-glance';
import { loadNetworkGlance } from '#/tui/utils/network/network-glance';

describe('security-glance', () => {
  it('formats permission mode with session mismatch', () => {
    expect(formatPermissionModeLine('auto', 'manual')).toContain('TUI');
    expect(formatPermissionModeLine('auto', 'manual')).toContain('session reports manual');
  });

  it('formats permission mode with live session confirmation', () => {
    expect(formatPermissionModeLine('auto', 'auto')).toContain('live session confirms');
    expect(formatPermissionModeLine('yolo')).toContain('/permission');
  });

  it('appends Never-Halt queue line when interventions are pending', () => {
    const line = formatPermissionModeLine('manual', 'manual', {
      pendingInterventions: 2,
      oldestInterventionAgeMs: 45_000,
    });
    expect(line).toContain('Never-Halt queue');
    expect(line).toContain('2 pending');
  });

  it('lists workspace root, sandbox profile, and extra dirs', () => {
    const lines = formatWorkspaceSandboxLines('/tmp/project', ['/tmp/extra'], 'read-only');
    expect(lines[0]).toContain('/tmp/project');
    expect(lines.some((l) => l.includes('Extra roots'))).toBe(true);
    expect(lines.some((l) => l.includes('Sandbox profile: read-only'))).toBe(true);
    expect(formatSandboxProfileLine('workspace')).toContain('stay inside workspace roots');
  });

  it('summarizes network egress from process env', () => {
    const direct = formatNetworkEgressLines(loadNetworkGlance({}));
    expect(direct[0]).toContain('direct');
    const proxied = formatNetworkEgressLines(
      loadNetworkGlance({ HTTPS_PROXY: 'http://proxy.example.test:8080' }),
    );
    expect(proxied[0]).toContain('proxy ACTIVE');
    expect(proxied.some((l) => l.includes('HTTPS_PROXY='))).toBe(true);
  });

  it('summarizes live MCP servers and config allowlists', () => {
    const lines = formatMcpAllowlistLines(
      [
        { status: 'connected' },
        { status: 'connected' },
        { status: 'disabled' },
      ],
      { configured: 2, withEnabledTools: 1, withDisabledTools: 1 },
    );
    expect(lines[0]).toContain('3 server(s)');
    expect(lines[0]).toContain('2 connected');
    expect(lines[0]).toContain('1 disabled');
    expect(lines.some((l) => l.includes('enabledTools allowlist'))).toBe(true);
  });

  it('lists verification sensor tips including PostToolUse RunProjectChecks', () => {
    expect(securitySensorLines().join('\n')).toContain('RunProjectChecks');
    expect(securitySensorLines().join('\n')).toContain('PostToolUse');
    expect(securitySensorLines().join('\n')).toContain('W6 soft sensor');
    expect(securitySensorLines().join('\n')).toContain('non-blocking');
  });

  it('builds full security panel lines with live permission, sandbox, and network', () => {
    const lines = buildSecuritySettingsLines({
      permissionMode: 'auto',
      permissionFromSession: 'auto',
      permissionInterventions: { pendingInterventions: 1, oldestInterventionAgeMs: 12_000 },
      sandboxProfile: 'workspace',
      workDir: '/workspace/demo',
      additionalDirs: [],
      network: loadNetworkGlance({}),
      mcpLive: [{ status: 'connected' }],
      mcpConfig: { configured: 1, withEnabledTools: 0, withDisabledTools: 0 },
    });
    const text = lines.join('\n');
    expect(text).toContain('§9.2');
    expect(text).toContain('live session confirms');
    expect(text).toContain('Never-Halt queue');
    expect(text).toContain('Sandbox profile: workspace');
    expect(text).toContain('Network egress');
    expect(text).toContain('Verification sensors');
    expect(text).toContain('RunProjectChecks');
    expect(text).toContain('/workspace/demo');
    expect(text).toContain('Settings → MCP');
    expect(text).toContain('Settings → Network / Proxy');
    expect(text).toContain('redactSecretsInText');
    expect(text).toContain('redteam-soft');
    for (const tip of securitySecretRedactionLines()) {
      expect(lines).toContain(tip);
    }
    for (const hint of securityNavigationLines()) {
      expect(lines).toContain(hint);
    }
  });
});
