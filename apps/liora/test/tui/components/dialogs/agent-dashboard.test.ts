/**
 * AgentDashboardComponent — multi-session operator surface.
 *
 * Covers group chrome (입력 필요 → 작업 중 → 대기), needs_input default
 * selection / Enter attach, secret-masked last_prompt, and narrow-width
 * body-first truncation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentDashboardComponent } from '#/tui/components/dialogs/agent-dashboard';
import type { DashboardSessionRow } from '#/tui/utils/agent-dashboard-rows';
import { maskSecretLikePrompt } from '#/tui/utils/agent-dashboard-rows';
import { visibleWidth } from '#/tui/renderer';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function renderPlain(component: AgentDashboardComponent, width = 100): string {
  return stripAnsi(component.render(width).join('\n'));
}

function row(input: {
  readonly id: string;
  readonly title?: string | null;
  readonly last_prompt?: string | null;
  readonly work_dir?: string;
  readonly updated_at?: number;
  readonly status: DashboardSessionRow['status'];
}): DashboardSessionRow {
  return {
    id: input.id,
    title: input.title ?? null,
    last_prompt: input.last_prompt ?? null,
    work_dir: input.work_dir ?? '/tmp/project',
    updated_at: input.updated_at ?? 2,
    status: input.status,
  };
}

describe('AgentDashboardComponent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Korean group headers and chrome summary counts', () => {
    const now = new Date('2026-07-25T12:00:00.000Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const component = new AgentDashboardComponent({
      sessions: [
        row({
          id: 'ses_need',
          title: '승인 대기',
          status: 'needs_input',
          updated_at: now - 60_000,
        }),
        row({
          id: 'ses_work',
          title: '빌드 중',
          status: 'working',
          updated_at: now - 120_000,
        }),
        row({
          id: 'ses_idle',
          title: '대기 세션',
          status: 'idle',
          updated_at: now - 180_000,
        }),
      ],
      loading: false,
      currentSessionId: 'ses_idle',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const output = renderPlain(component);
    expect(output).toContain('에이전트 대시보드');
    expect(output).toContain('입력 필요');
    expect(output).toContain('작업 중');
    expect(output).toContain('대기');
    expect(output).toContain('입력 1 · 작업 1 · 대기 1');
    expect(output).toContain('승인 대기');
    expect(output).toContain('빌드 중');
    expect(output).toContain('대기 세션');
    expect(output).toContain('[입력]');
    expect(output).toContain('[작업]');
    expect(output).toContain('[대기]');
  });

  it('prefers needs_input for initial selection and Enter attach', () => {
    const onSelect = vi.fn();
    const component = new AgentDashboardComponent({
      sessions: [
        row({ id: 'ses_idle', title: 'Idle', status: 'idle', updated_at: 1 }),
        row({ id: 'ses_work', title: 'Work', status: 'working', updated_at: 2 }),
        row({ id: 'ses_need', title: 'Need', status: 'needs_input', updated_at: 3 }),
      ],
      loading: false,
      currentSessionId: 'ses_idle',
      onSelect,
      onCancel: vi.fn(),
    });

    component.handleInput('\r');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0]![0]).toMatchObject({
      id: 'ses_need',
      status: 'needs_input',
    });
  });

  it('keeps masked last_prompt body and never paints raw secrets', () => {
    const keyVal = ['sk', 'example', 'SHOULD-NOT-LEAK'].join('-');
    const raw = `OPENAI_API_KEY=${keyVal} and continue`;
    const masked = maskSecretLikePrompt(raw);
    expect(masked).not.toContain(keyVal);

    const component = new AgentDashboardComponent({
      sessions: [
        row({
          id: 'ses_secret',
          title: 'Secret session',
          status: 'needs_input',
          last_prompt: masked,
        }),
      ],
      loading: false,
      currentSessionId: 'other',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const output = renderPlain(component, 100);
    expect(output).not.toContain(keyVal);
    expect(output).toContain('***');
    expect(output).toContain('OPENAI_API_KEY');
  });

  it('fits every rendered line within narrow terminal widths', () => {
    const longTitle =
      'very-long-session-title-that-should-truncate-gracefully-without-overflowing-the-terminal';
    const longPrompt =
      'operator prompt body that must remain readable under narrow widths while still being truncated';
    const component = new AgentDashboardComponent({
      sessions: [
        row({
          id: 'ses_narrow_aaaaaaaaaaaaaaaaaaaaaaaa',
          title: longTitle,
          status: 'working',
          last_prompt: longPrompt,
          work_dir: '/Users/modumaru/Desktop/code/superliora/apps/liora',
        }),
        row({
          id: 'ses_need_narrow',
          title: 'Need input now',
          status: 'needs_input',
          last_prompt: 'please approve the deploy',
        }),
      ],
      loading: false,
      currentSessionId: 'ses_narrow_aaaaaaaaaaaaaaaaaaaaaaaa',
      maxVisibleSessions: 8,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    for (const width of [40, 60, 80]) {
      const lines = component.render(width).map((line) => stripAnsi(line));
      for (const line of lines) {
        expect(visibleWidth(line), `line exceeds width ${String(width)}: ${line}`).toBeLessThanOrEqual(
          width,
        );
      }
      const plain = lines.join('\n');
      // Body-first: prompt marker and actionable body fragment survive narrow widths.
      expect(plain).toContain('›');
      expect(plain).toMatch(/please approve|deploy|operator prompt|readable/i);
    }
  });

  it('forwards Esc cancel and Ctrl-C / Ctrl-D host shortcuts', () => {
    const onCancel = vi.fn();
    const onCtrlC = vi.fn();
    const onCtrlD = vi.fn();
    const component = new AgentDashboardComponent({
      sessions: [row({ id: 'ses_a', status: 'idle' })],
      loading: false,
      currentSessionId: 'ses_a',
      onSelect: vi.fn(),
      onCancel,
      onCtrlC,
      onCtrlD,
    });

    component.handleInput(String.fromCodePoint(27));
    component.handleInput('\u0003');
    component.handleInput('\u0004');

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCtrlC).toHaveBeenCalledOnce();
    expect(onCtrlD).toHaveBeenCalledOnce();
  });

  it('shows empty-state copy when there are no sessions', () => {
    const component = new AgentDashboardComponent({
      sessions: [],
      loading: false,
      currentSessionId: '',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const output = renderPlain(component);
    expect(output).toContain('표시할 세션이 없습니다.');
    expect(output).toContain('입력 0 · 작업 0 · 대기 0');
  });
});
