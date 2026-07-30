import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { UltraworkTheatreComponent } from '#/tui/components/messages/ultrawork/ultrawork-theatre';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { currentTheme } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
  setActiveAppearancePreferences,
  SETTLE_FLASH_MS,
} from '#/tui/features/appearance/appearance-effects';

const researchStageEvent = {
  type: 'ultrawork.stage.changed' as const,
  agentId: 'main',
  sessionId: 'sess_1',
  run: {
    id: 'uw_1',
    objective: 'Ship auth middleware',
    stage: 'research' as const,
    startedAt: '2026-07-01T00:00:00.000Z',
  },
  from: 'plan' as const,
  to: 'research' as const,
};

const swarmStageEvent = {
  ...researchStageEvent,
  run: {
    ...researchStageEvent.run,
    stage: 'swarm' as const,
  },
  from: 'staff' as const,
  to: 'swarm' as const,
};

describe('UltraworkTheatreComponent', () => {
  it('renders a compact status panel outside swarm', () => {
    const theatre = new UltraworkTheatreComponent(researchStageEvent as never);

    theatre.applyEvent({
      type: 'ultrawork.research.started',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      topic: 'Ship auth middleware',
      backends: [
        {
          id: 'local',
          kind: 'local_research_stack',
          role: 'assist',
          status: 'selected',
          label: 'LocalResearchStack',
        },
      ],
    });

    const output = theatre.render(100).join('\n');
    expect(output).toContain('Ultrawork');
    expect(output).toContain('Ship auth middleware');
    expect(output).toContain('LocalResearchStack');
    expect(output).not.toContain('Ultrawork Theatre');
    expect(output).not.toContain('intake>plan');
    expect(output).toContain('█'); // Progress bar should be present
  });

  it('hides the theatre panel during swarm so UltraSwarm owns the dashboard', () => {
    const theatre = new UltraworkTheatreComponent(swarmStageEvent as never);

    theatre.applyEvent({
      type: 'ultrawork.collaboration.message',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      message: {
        id: 'swarm-msg-1',
        runId: 'uw_1',
        parentToolCallId: 'call_uw',
        at: '2026-07-01T00:00:01.000Z',
        from: {
          expertId: 'security-appsec-engineer',
          agentId: 'agent_sec',
          name: 'AppSec Engineer',
        },
        to: { expertId: 'impl-engineer' },
        channel: 'blocker' as const,
        kind: 'mention' as const,
        body: 'auth middleware missing tests',
      },
    });

    expect(theatre.render(100)).toEqual([]);
  });

  it('renders stage progress with progress bar', () => {
    const theatre = new UltraworkTheatreComponent(researchStageEvent as never);
    const output = theatre.render(100).join('\n');
    
    // Should contain progress bar characters
    expect(output).toMatch(/█+/);
    // Should contain stage information
    expect(output).toContain('research');
    // Should contain progress ratio
    expect(output).toMatch(/\d+\/\d+/);
  });
});

describe('UltraworkTheatreComponent stage motion', () => {
  const previousEnv = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };

  function stripAnsi(text: string): string {
    return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
  }

  /** The stage progress line is the only row carrying the progress bar. */
  function stageLineOf(output: string[]): string {
    const line = output.find((row) => stripAnsi(row).includes('█'));
    expect(line).toBeDefined();
    return line!;
  }

  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('flashes the stage line on entrance, then settles to static bytes', () => {
    const t0 = 1_000_000;
    advanceAppearanceAnimationClock(t0);
    const theatre = new UltraworkTheatreComponent(researchStageEvent as never);

    const active = stageLineOf(theatre.render(100));

    advanceAppearanceAnimationClock(t0 + SETTLE_FLASH_MS + 200);
    const settledA = stageLineOf(theatre.render(100));
    advanceAppearanceAnimationClock(t0 + SETTLE_FLASH_MS + 9000);
    const settledB = stageLineOf(theatre.render(100));

    // Active cue at t0 differs from the resting line; once settled the line
    // is clock-independent static bytes forever after.
    expect(active).not.toBe(settledA);
    expect(settledA).toBe(settledB);
    expect(stripAnsi(settledA)).toContain('research');
  });

  it('re-arms on a real phase change but not on duplicate stage events', () => {
    const t0 = 2_000_000;
    advanceAppearanceAnimationClock(t0);
    const theatre = new UltraworkTheatreComponent(researchStageEvent as never);

    advanceAppearanceAnimationClock(t0 + SETTLE_FLASH_MS + 300);
    const settled = stageLineOf(theatre.render(100));

    // Same-stage event at a later clock must not restart the cue.
    advanceAppearanceAnimationClock(t0 + SETTLE_FLASH_MS + 400);
    theatre.applyEvent({ ...researchStageEvent } as never);
    expect(stageLineOf(theatre.render(100))).toBe(settled);

    // A genuine phase transition re-arms the settle flash.
    advanceAppearanceAnimationClock(t0 + SETTLE_FLASH_MS + 500);
    theatre.applyEvent({
      ...researchStageEvent,
      run: { ...researchStageEvent.run, stage: 'plan' as const },
      from: 'research' as const,
      to: 'plan' as const,
    } as never);
    const reactivated = stageLineOf(theatre.render(100));
    expect(reactivated).not.toBe(settled);
    expect(stripAnsi(reactivated)).toContain('plan');
  });

  it('off profile renders byte-identical static output at any clock', () => {
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off' as const,
      particles: 'off' as const,
    });
    const t0 = 3_000_000;
    advanceAppearanceAnimationClock(t0);
    const theatre = new UltraworkTheatreComponent(researchStageEvent as never);

    const a = theatre.render(100);
    advanceAppearanceAnimationClock(t0 + 12_345);
    const b = theatre.render(100);

    expect(a).toEqual(b);
    // The stage line is plain single-tone text — no animation codes.
    const stageLine = stageLineOf(a);
    expect(stageLine).toBe(currentTheme.fg('textDim', stripAnsi(stageLine)));
  });
});
