import { describe, expect, it } from 'vitest';

import { UltraworkTheatreComponent } from '#/tui/components/messages/ultrawork-theatre';

const stageEvent = {
  type: 'ultrawork.stage.changed' as const,
  agentId: 'main',
  sessionId: 'sess_1',
  run: {
    id: 'uw_1',
    objective: 'Ship auth middleware',
    stage: 'swarm' as const,
    startedAt: '2026-07-01T00:00:00.000Z',
  },
  from: 'staff' as const,
  to: 'swarm' as const,
};

const collaborationMessage = {
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
};

describe('UltraworkTheatreComponent collaboration scrollback', () => {
  it('renders recent swarm bus messages in the overview panel', () => {
    const theatre = new UltraworkTheatreComponent(stageEvent);

    theatre.applyEvent({
      type: 'ultrawork.collaboration.message',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      message: collaborationMessage,
    });

    const output = theatre.render(100).join('\n');
    expect(output).toContain('╭');
    expect(output).toContain('Ultrawork Theatre');
    expect(output).toContain('chat 1 msg');
    expect(output).toContain('[overview]');
    expect(output).toContain('AppSec Engineer → @impl-engineer');
    expect(output).toContain('auth middleware missing tests');
  });

  it('renders the team-chat tab with mention highlights', () => {
    const theatre = new UltraworkTheatreComponent(stageEvent);

    theatre.applyEvent({
      type: 'ultrawork.collaboration.message',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      message: collaborationMessage,
    });
    theatre.applyEvent({
      type: 'ultrawork.collaboration.mention',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      message: collaborationMessage,
      mentionExpertIds: ['impl-engineer'],
    });
    theatre.cyclePanel();

    const output = theatre.render(120).join('\n');
    expect(output).toContain('[team-chat]');
    expect(output).toContain('team chat');
    expect(output).toContain('1 mention');
    expect(output).toContain('@ AppSec Engineer → @impl-engineer');
  });
});
