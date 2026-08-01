import { describe, expect, it } from 'vitest';

import { FooterComponent } from '#/tui/components/chrome/footer/footer';
import type { AppState } from '#/tui/types';

const ANSI_SGR = /\x1b\[[0-9;]*m/g;
function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    model: 'k2',
    workDir: '/tmp/proj',
    additionalDirs: [],
    sessionId: 'sess_1',
    permissionMode: 'manual',
    planMode: false,
    thinking: false,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 200_000,
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: 'test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    availableModels: {},
    ...overrides,
  } as AppState;
}

describe('FooterComponent — background task / agent badges', () => {
  it('omits both badges when counts are 0', () => {
    const footer = new FooterComponent(baseState());
    const [line1] = footer.render(120);
    expect(line1).toBeDefined();
    expect(strip(line1!)).not.toMatch(/shell job/);
    expect(strip(line1!)).not.toMatch(/\d+ agents?\b/);
  });

  it('renders the task badge alone when only bash tasks are running', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 0 });
    const out = strip(footer.render(120)[0]!);
    expect(out).toMatch(/1 shell job\b/);
    expect(out).not.toMatch(/\d+ agents?\b/);
  });

  it('renders the agent badge alone when only agent tasks are running', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 0, agentTasks: 1 });
    const out = strip(footer.render(120)[0]!);
    expect(out).toMatch(/1 agent\b/);
    expect(out).not.toMatch(/shell job/);
  });

  it('renders both badges side by side when both are non-zero', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 2, agentTasks: 3 });
    const out = strip(footer.render(120)[0]!);
    expect(out).toMatch(/2 shell jobs/);
    expect(out).toMatch(/3 agents/);
    expect(out.indexOf('2 shell jobs')).toBeLessThan(out.indexOf('3 agents'));
  });

  it('pluralizes correctly across both badges', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 1 });
    const out = strip(footer.render(120)[0]!);
    expect(out).toMatch(/1 shell job\b/);
    expect(out).toMatch(/1 agent\b/);
  });

  it('updates badges live via setBackgroundCounts', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 2, agentTasks: 1 });
    expect(strip(footer.render(120)[0]!)).toMatch(/2 shell jobs/);
    footer.setBackgroundCounts({ bashTasks: 0, agentTasks: 0 });
    const after = strip(footer.render(120)[0]!);
    expect(after).not.toMatch(/shell job/);
    expect(after).not.toMatch(/\d+ agents?\b/);
  });

  it('clamps negative counts to 0', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: -5, agentTasks: -2 });
    const out = strip(footer.render(120)[0]!);
    expect(out).not.toMatch(/shell job/);
    expect(out).not.toMatch(/\d+ agents?\b/);
  });

  it('drops the badges when terminal is too narrow to fit them', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 4, agentTasks: 3 });
    // Extremely narrow width: footer primary content fills the line, so leftLine wins.
    const [line1] = footer.render(20);
    expect(line1).toBeDefined();
    // May truncate mid-badge; must not show the full dual-badge pair.
    const out = strip(line1!);
    const hasFull =
      /4 shell jobs/.test(out) && /3 agents/.test(out);
    expect(hasFull).toBe(false);
  });
});
