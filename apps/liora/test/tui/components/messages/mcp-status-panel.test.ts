import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMcpStatusReportLines } from '#/tui/components/messages/mcp-status-panel';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  advanceAppearanceAnimationClock,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

function strip(text: string): string {
  return text.replaceAll(/\[[0-9;]*m/g, '');
}

describe('buildMcpStatusReportLines', () => {
  it('keeps MCP scoped to optional tool backends when no servers are configured', () => {
    const lines = buildMcpStatusReportLines({ servers: [] }).map(strip);

    const output = lines.join('\n');
    expect(output).toContain(
      'No MCP servers configured. Run /mcp-config to add optional tool backends.',
    );
    expect(output).toContain('Built-in web research uses WebSearch and FetchURL outside MCP.');
    expect(output).not.toContain('Scrapling');
    expect(output).not.toContain('scrapling mcp');
  });

  it('does not present MCP as the built-in web research path', () => {
    const lines = buildMcpStatusReportLines({
      servers: [
        {
          name: 'scrapling',
          transport: 'stdio',
          status: 'connected',
          toolCount: 10,
        },
      ],
    }).map(strip);

    expect(lines.join('\n')).toContain('scrapling');
    expect(lines.join('\n')).toContain('Configure optional tool backends with /mcp-config');
    expect(lines.join('\n')).not.toContain('Web research backend');
  });

  it('folds a multi-line server error onto one row so the panel box stays intact', () => {
    const lines = buildMcpStatusReportLines({
      servers: [
        {
          name: 'ghidra',
          transport: 'stdio',
          status: 'failed',
          toolCount: 0,
          error:
            'MCP error -32000: Connection closed\nstderr: usage: bridge_mcp_ghidra.py [-h] [--mcp-host MCP_HOST]',
        },
      ],
    }).map(strip);

    // The box renderer (UsagePanelComponent.render) treats each returned string
    // as exactly one row, so an embedded newline would punch through the border.
    for (const line of lines) {
      expect(line).not.toContain('\n');
    }

    const errorLine = lines.find((line) => line.includes('error:'));
    expect(errorLine).toContain(
      'MCP error -32000: Connection closed stderr: usage: bridge_mcp_ghidra.py [-h] [--mcp-host MCP_HOST]',
    );
  });

  it('trims and keeps a single-line error intact', () => {
    const lines = buildMcpStatusReportLines({
      servers: [
        {
          name: 'ida',
          transport: 'http',
          status: 'failed',
          toolCount: 0,
          error: '  fetch failed  ',
        },
      ],
    }).map(strip);

    const errorLine = lines.find((line) => line.includes('error:'));
    expect(errorLine).toContain('error: fetch failed');
  });

  describe('premium row motion', () => {
    const previous = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
      SSH_TTY: process.env['SSH_TTY'],
      SSH_CONNECTION: process.env['SSH_CONNECTION'],
      SSH_CLIENT: process.env['SSH_CLIENT'],
      chalkLevel: chalk.level,
    };

    beforeEach(() => {
      process.env['TERM'] = 'xterm-256color';
      delete process.env['CI'];
      delete process.env['NO_COLOR'];
      delete process.env['SSH_TTY'];
      delete process.env['SSH_CONNECTION'];
      delete process.env['SSH_CLIENT'];
      chalk.level = 3;
      setAppearanceRenderHealth('healthy');
      setAppearanceRenderQuality('full');
      setActiveAppearancePreferences({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
        particles: 'premium',
      });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
      advanceAppearanceAnimationClock(Date.now());
    });

    afterEach(() => {
      vi.useRealTimers();
      chalk.level = previous.chalkLevel;
      setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
      for (const [key, value] of Object.entries(previous)) {
        if (key === 'chalkLevel') continue;
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('breathes failed status styling across clock ticks', () => {
      expect(motionEffectsAllowed()).toBe(true);
      expect(shouldRenderAmbientEffects(getActiveAppearancePreferences())).toBe(true);

      const servers = [
        {
          name: 'broken',
          transport: 'stdio' as const,
          status: 'failed' as const,
          toolCount: 0,
          error: 'boom',
        },
      ];
      // Pin absolute clock values so error↔warning parity always flips (interval 220ms).
      advanceAppearanceAnimationClock(0);
      const a = buildMcpStatusReportLines({ servers }).find(
        (line) => strip(line).includes('broken') && strip(line).includes('failed'),
      );
      advanceAppearanceAnimationClock(220);
      const b = buildMcpStatusReportLines({ servers }).find(
        (line) => strip(line).includes('broken') && strip(line).includes('failed'),
      );
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(strip(a!)).toContain('failed');
      // Danger-breathe alternates error/warning tokens; off/static would keep ANSI identical.
      expect(a).not.toBe(b);
    });
  });
});
