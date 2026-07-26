/**
 * AgentDashboard accessibility regressions (Section 508 / WCAG keyboard + text cues).
 *
 * - Home/End jump list ends (2.1.1 Keyboard)
 * - Selection position announced as plain text N/M (1.4.1 not color alone, 2.4.3 focus order)
 * - Status badges remain textual tokens ([입력]/[작업]/[대기])
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentDashboardComponent } from '#/tui/components/dialogs/agent-dashboard';
import type { DashboardSessionRow } from '#/tui/utils/agent-dashboard-rows';

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

describe('AgentDashboardComponent accessibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('announces selection position as plain text and documents Home/End in hints', () => {
    const component = new AgentDashboardComponent({
      sessions: [
        row({ id: 'ses_need', title: '승인 대기', status: 'needs_input', updated_at: 3 }),
        row({ id: 'ses_work', title: '빌드 중', status: 'working', updated_at: 2 }),
        row({ id: 'ses_idle', title: '대기 세션', status: 'idle', updated_at: 1 }),
      ],
      loading: false,
      currentSessionId: 'ses_idle',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const output = renderPlain(component);
    expect(output).toContain('선택 1/3');
    expect(output).toContain('Home/End 끝');
    // Status is not color-only: badge tokens + footer group label.
    expect(output).toContain('[입력]');
    expect(output).toContain('선택 1/3 · 입력 필요');
  });

  it('supports Home/End jump for keyboard-only navigation', () => {
    const onSelect = vi.fn();
    const component = new AgentDashboardComponent({
      sessions: [
        row({ id: 'ses_need', title: 'Need', status: 'needs_input', updated_at: 3 }),
        row({ id: 'ses_work', title: 'Work', status: 'working', updated_at: 2 }),
        row({ id: 'ses_idle', title: 'Idle', status: 'idle', updated_at: 1 }),
      ],
      loading: false,
      currentSessionId: 'ses_work',
      onSelect,
      onCancel: vi.fn(),
    });

    // Initial: needs_input preferred → position 1/3
    expect(renderPlain(component)).toContain('선택 1/3');

    // End → last row (idle). Legacy CSI end sequence.
    component.handleInput('\u001B[F');
    expect(renderPlain(component)).toContain('선택 3/3');
    expect(renderPlain(component)).toContain('선택 3/3 · 대기');
    component.handleInput('\r');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ id: 'ses_idle', status: 'idle' });

    // Home → first row (needs_input). Legacy CSI home sequence.
    onSelect.mockClear();
    component.handleInput('\u001B[H');
    expect(renderPlain(component)).toContain('선택 1/3');
    expect(renderPlain(component)).toContain('선택 1/3 · 입력 필요');
    component.handleInput('\r');
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ id: 'ses_need', status: 'needs_input' });
  });

  it('keeps empty-state operable with Esc-only hint (no false position)', () => {
    const component = new AgentDashboardComponent({
      sessions: [],
      loading: false,
      currentSessionId: '',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const output = renderPlain(component);
    expect(output).toContain('표시할 세션이 없습니다.');
    expect(output).toContain('Esc 닫기');
    expect(output).not.toContain('선택 0/');
  });
});
