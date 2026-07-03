import { describe, expect, it } from 'vitest';

import { NativeInputRouter, type NativeInputEvent } from '../src';

const KEY_A: NativeInputEvent = {
  type: 'key',
  key: 'character',
  raw: 'a',
  text: 'a',
  ctrl: false,
  alt: false,
  shift: false,
};

const ESCAPE: NativeInputEvent = {
  type: 'key',
  key: 'escape',
  raw: '\u001B',
  ctrl: false,
  alt: false,
  shift: false,
};

describe('NativeInputRouter', () => {
  it('routes focused input before global fallback', () => {
    const router = new NativeInputRouter();
    const calls: string[] = [];
    router.registerTarget({
      id: 'editor',
      onInput: (event, context) => {
        calls.push(`${context.route}:${context.targetId}:${event.type}`);
        return true;
      },
    });
    router.registerGlobalHandler({
      id: 'global',
      onInput: () => {
        calls.push('global');
        return true;
      },
    });

    expect(router.focus('editor')).toBe(true);

    expect(router.dispatch(KEY_A)).toEqual({
      event: KEY_A,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });
    expect(calls).toEqual(['focused:editor:key']);
  });

  it('falls through to global handlers when a focused target does not handle input', () => {
    const router = new NativeInputRouter();
    const calls: string[] = [];
    router.registerTarget({
      id: 'editor',
      onInput: () => {
        calls.push('editor');
        return false;
      },
    });
    router.registerGlobalHandler({
      id: 'escape',
      onInput: (event) => {
        calls.push('global');
        return event.type === 'key' && event.key === 'escape';
      },
    });
    router.focus('editor');

    expect(router.dispatch(ESCAPE)).toEqual({
      event: ESCAPE,
      route: 'global',
      handled: true,
      targetId: 'escape',
    });
    expect(calls).toEqual(['editor', 'global']);
  });

  it('lets the top modal target capture input before focused targets', () => {
    const router = new NativeInputRouter();
    const calls: string[] = [];
    router.registerTarget({
      id: 'editor',
      onInput: () => {
        calls.push('editor');
        return true;
      },
    });
    router.registerTarget({
      id: 'palette',
      onInput: (_event, context) => {
        calls.push(context.route);
        return true;
      },
    });
    router.focus('editor');
    const closeModal = router.pushModal('palette');

    expect(router.dispatch(KEY_A)).toEqual({
      event: KEY_A,
      route: 'modal',
      handled: true,
      targetId: 'palette',
    });
    closeModal();
    expect(router.dispatch(KEY_A).targetId).toBe('editor');
    expect(calls).toEqual(['modal', 'editor']);
  });

  it('supports focus stack restoration and ordered focus navigation', () => {
    const router = new NativeInputRouter();
    router.registerTarget({ id: 'editor', onInput: () => true });
    router.registerTarget({ id: 'readonly', focusable: false, onInput: () => true });
    router.registerTarget({ id: 'queue', onInput: () => true });
    router.registerTarget({ id: 'disabled', enabled: false, onInput: () => true });

    expect(router.focusNext()).toBe('editor');
    expect(router.focusNext()).toBe('queue');
    expect(router.focusPrevious()).toBe('editor');

    const restore = router.pushFocus('queue');
    expect(router.focusedTargetId).toBe('queue');
    restore();
    expect(router.focusedTargetId).toBe('editor');
  });

  it('removes focus and modal references when targets unregister', () => {
    const router = new NativeInputRouter();
    router.registerTarget({ id: 'editor', onInput: () => true });
    router.registerTarget({ id: 'modal', onInput: () => true });
    router.focus('editor');
    router.pushModal('modal');

    router.unregisterTarget('editor');
    router.unregisterTarget('modal');

    expect(router.focusedTargetId).toBeUndefined();
    expect(router.modalTargetId).toBeUndefined();
    expect(router.dispatch(KEY_A)).toEqual({ event: KEY_A, route: 'unhandled', handled: false });
  });
});
