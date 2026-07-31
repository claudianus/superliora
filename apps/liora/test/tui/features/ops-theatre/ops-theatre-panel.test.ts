import { describe, expect, it, vi } from 'vitest';

import { OpsTheatrePanelComponent } from '#/tui/features/ops-theatre/ops-theatre-panel';

describe('OpsTheatrePanelComponent', () => {
  it('Enter focuses approval when one is pending', () => {
    const onFocusApproval = vi.fn();
    const onDismiss = vi.fn();
    const panel = new OpsTheatrePanelComponent({
      buildLines: () => ['line'],
      hasPendingApproval: () => true,
      onFocusApproval,
      onDismiss,
    });

    panel.handleInput('\r');

    expect(onFocusApproval).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Enter is ignored when no approval is pending', () => {
    const onFocusApproval = vi.fn();
    const panel = new OpsTheatrePanelComponent({
      buildLines: () => ['line'],
      hasPendingApproval: () => false,
      onFocusApproval,
      onDismiss: vi.fn(),
    });

    panel.handleInput('\r');

    expect(onFocusApproval).not.toHaveBeenCalled();
  });

  it('Escape closes the Ops panel', () => {
    const onDismiss = vi.fn();
    const panel = new OpsTheatrePanelComponent({
      buildLines: () => ['line'],
      hasPendingApproval: () => false,
      onFocusApproval: vi.fn(),
      onDismiss,
    });

    panel.handleInput('\x1b');

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
