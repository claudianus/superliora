import { describe, expect, it } from 'vitest';

import {
  renderSessionLoadingBar,
  SessionLoadingOverlayComponent,
} from '#/tui/components/dialogs/session/session-loading-overlay';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('SessionLoadingOverlayComponent', () => {
  it('renders phase, progress bar, and input-lock copy', () => {
    const overlay = new SessionLoadingOverlayComponent({
      sessionId: 'ses-abcdefghijklmnop',
      phase: 'building',
      progress: 0.5,
      detail: 'Building transcript…',
    });
    const text = stripAnsi(overlay.render(80).join('\n'));
    expect(text).toMatch(/Opening session|세션 여는 중/);
    expect(text).toContain('50%');
    expect(text).toMatch(/Building transcript|대화 기록/);
    expect(text).toMatch(/Input locked|입력 잠금/);
    expect(text).toMatch(/Session|세션/);
  });

  it('swallows keyboard input so resume cannot restart mid-load', () => {
    const overlay = new SessionLoadingOverlayComponent({ phase: 'loading' });
    // Should not throw; escape and printable keys are intentionally no-ops.
    overlay.handleInput('\x1b');
    overlay.handleInput('a');
    overlay.handleInput('\r');
    expect(overlay.currentPhase).toBe('loading');
  });

  it('renderSessionLoadingBar fills proportionally', () => {
    const empty = stripAnsi(renderSessionLoadingBar(0, 10));
    const full = stripAnsi(renderSessionLoadingBar(1, 10));
    expect(empty).toContain('░'.repeat(10));
    expect(full).toContain('█'.repeat(10));
  });
});
