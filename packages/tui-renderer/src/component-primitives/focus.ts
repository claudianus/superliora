import type { Component } from '../text/component';

export interface Focusable {
  focused: boolean;
}

export const CURSOR_MARKER = '\u001B_pi:c\u0007';

export function isFocusable(component: Component | null): component is Component & Focusable {
  return component !== null && 'focused' in component;
}
