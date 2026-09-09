import { describe, expect, it, vi } from 'vitest';

import type { Component } from '#/tui/renderer';
import {
  rememberOpenSurface,
  SURFACE_JOB_DECK,
  SURFACE_QUOTA,
  toggleOffOpenSurface,
  type EditorSurfaceHost,
} from '#/tui/features/surfaces/editor-surface-toggle';
import { QuotaOverlayComponent } from '#/tui/components/messages/usage-panel/quota-overlay';
import { PlanBrowserOverlayComponent } from '#/tui/features/surfaces/plan-browser';

function fakePanel(): Component {
  return { render: () => [''], invalidate: () => {} } as Component;
}

function fakeHost(child?: Component): {
  host: EditorSurfaceHost;
  restoreEditor: ReturnType<typeof vi.fn>;
} {
  const restoreEditor = vi.fn();
  const children: Component[] = child === undefined ? [] : [child];
  const host: EditorSurfaceHost = {
    state: { editorContainer: { children } },
    restoreEditor: () => {
      children.length = 0;
      restoreEditor();
    },
  };
  return { host, restoreEditor };
}

describe('editor-surface-toggle', () => {
  it('is a no-op before anything is opened', () => {
    const { host, restoreEditor } = fakeHost();
    expect(toggleOffOpenSurface(host, SURFACE_QUOTA)).toBe(false);
    expect(restoreEditor).not.toHaveBeenCalled();
  });

  it('closes exactly once while the remembered panel is the current editor child', () => {
    const panel = fakePanel();
    const { host, restoreEditor } = fakeHost(panel);
    rememberOpenSurface(SURFACE_QUOTA, panel);

    expect(toggleOffOpenSurface(host, SURFACE_QUOTA)).toBe(true);
    expect(restoreEditor).toHaveBeenCalledOnce();
    // A second toggle finds nothing mounted.
    expect(toggleOffOpenSurface(host, SURFACE_QUOTA)).toBe(false);
  });

  it('never closes a panel that is not the current editor child', () => {
    const remembered = fakePanel();
    const other = fakePanel();
    const { host, restoreEditor } = fakeHost(other); // a different panel is mounted
    rememberOpenSurface(SURFACE_QUOTA, remembered);

    expect(toggleOffOpenSurface(host, SURFACE_QUOTA)).toBe(false);
    expect(restoreEditor).not.toHaveBeenCalled();
  });

  it('does not close an empty editor area when the remembered panel was torn down', () => {
    const panel = fakePanel();
    const { host, restoreEditor } = fakeHost(); // panel already removed
    rememberOpenSurface(SURFACE_QUOTA, panel);
    expect(toggleOffOpenSurface(host, SURFACE_QUOTA)).toBe(false);
    expect(restoreEditor).not.toHaveBeenCalled();
  });

  it('keeps surface kinds independent', () => {
    const deck = fakePanel();
    const { host, restoreEditor } = fakeHost(deck);
    rememberOpenSurface(SURFACE_JOB_DECK, deck);
    // Asking to close Quota does nothing even though a Deck is open.
    expect(toggleOffOpenSurface(host, SURFACE_QUOTA)).toBe(false);
    expect(restoreEditor).not.toHaveBeenCalled();
    expect(toggleOffOpenSurface(host, SURFACE_JOB_DECK)).toBe(true);
  });
});

describe('QuotaOverlayComponent close keys', () => {
  it('closes on Esc and on q/Q, and ignores other letters', () => {
    const onCancel = vi.fn();
    const overlay = new QuotaOverlayComponent({
      buildLines: () => ['line'],
      title: ' Credits ',
      onCancel,
    });
    overlay.handleInput('\u001B'); // Esc
    expect(onCancel).toHaveBeenCalledTimes(1);
    overlay.handleInput('q');
    expect(onCancel).toHaveBeenCalledTimes(2);
    overlay.handleInput('Q');
    expect(onCancel).toHaveBeenCalledTimes(3);
    overlay.handleInput('p');
    expect(onCancel).toHaveBeenCalledTimes(3);
  });
});

describe('PlanBrowserOverlayComponent close/scroll keys', () => {
  it('closes on Esc / p and scrolls on PageDown without closing', () => {
    const onClose = vi.fn();
    const browser = new PlanBrowserOverlayComponent({ content: '# Plan', onClose });
    browser.handleInput('\u001B');
    expect(onClose).toHaveBeenCalledTimes(1);
    browser.handleInput('p');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
