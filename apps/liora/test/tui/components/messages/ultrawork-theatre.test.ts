import { describe, expect, it } from 'vitest';

import { UltraworkTheatreComponent } from '#/tui/components/messages/ultrawork-theatre';

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
    const theatre = new UltraworkTheatreComponent(researchStageEvent);

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
    const theatre = new UltraworkTheatreComponent(swarmStageEvent);

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
    const theatre = new UltraworkTheatreComponent(researchStageEvent);
    const output = theatre.render(100).join('\n');
    
    // Should contain progress bar characters
    expect(output).toMatch(/█+/);
    // Should contain stage information
    expect(output).toContain('research');
    // Should contain progress ratio
    expect(output).toMatch(/\d+\/\d+/);
  });
});
