import { describe, expect, it } from 'vitest';

import { adaptApprovalRequest, adaptPanelResponse } from '#/tui/reverse-rpc/approval/adapter';

describe('approval adapter', () => {
  it('renders Bash execution with its working directory and permission choices', () => {
    const panel = adaptApprovalRequest({
      toolCallId: 'bash-1',
      toolName: 'Bash',
      action: 'execute',
      display: { kind: 'command', command: 'pwd', cwd: '/workspace', language: 'bash', description: 'Show directory' },
    });
    expect(panel.display).toEqual([{ type: 'shell', command: 'pwd', cwd: '/workspace', language: 'bash', description: 'Show directory', danger: undefined }]);
    expect(panel.choices.map((choice) => choice.response)).toEqual(['approved', 'approved_for_session', 'rejected', 'rejected']);
  });

  it('keeps generic command arguments formatted as shell rather than a raw JSON dump', () => {
    const panel = adaptApprovalRequest({
      toolCallId: 'bash-2', toolName: 'Bash', action: 'execute',
      display: { kind: 'generic', summary: 'Command', detail: { command: 'rm -rf build', cwd: '/workspace' } },
    });
    expect(panel.display[0]).toMatchObject({ type: 'shell', command: 'rm -rf build', cwd: '/workspace' });
    expect(panel.display[0]?.type === 'shell' && panel.display[0].danger).toBeTruthy();
  });

  it('preserves explicit operator decisions and feedback', () => {
    expect(adaptPanelResponse({ response: 'approved_for_session' })).toMatchObject({ decision: 'approved', scope: 'session' });
    expect(adaptPanelResponse({ response: 'rejected', feedback: 'Do not touch production', selected_label: 'Reject' })).toEqual({ decision: 'rejected', feedback: 'Do not touch production' });
    expect(adaptPanelResponse({ response: 'cancelled' }).decision).toBe('cancelled');
  });
});
