import type {
  NativeInputMouseAction,
  NativeInputMouseButton,
  NativeInputMouseEvent,
} from './types';

export function matchSgrMouse(
  input: string,
  index: number,
): { readonly raw: string; readonly event: NativeInputMouseEvent } | undefined {
  const match = /^\u001B\[<(\d+);(\d+);(\d+)([mM])/.exec(input.slice(index));
  if (match === null) return undefined;
  const raw = match[0];
  const encodedButton = Number(match[1]);
  const terminalX = Number(match[2]);
  const terminalY = Number(match[3]);
  const final = match[4];
  if (
    !Number.isInteger(encodedButton) ||
    !Number.isInteger(terminalX) ||
    !Number.isInteger(terminalY) ||
    final === undefined
  ) {
    return undefined;
  }
  const button = decodeSgrMouseButton(encodedButton);
  return {
    raw,
    event: {
      type: 'mouse',
      raw,
      button,
      action: decodeSgrMouseAction(encodedButton, final, button),
      x: Math.max(0, terminalX - 1),
      y: Math.max(0, terminalY - 1),
      ...decodeSgrMouseModifiers(encodedButton),
    },
  };
}

/**
 * X10 / classic mouse reporting (`CSI M Cb Cx Cy`, 3 bytes after `ESC [ M`).
 * Enabled alongside SGR (`1006`) via `1000`/`1002`; some terminals or mid-stream
 * mode flips still emit X10. Incomplete prefixes return `'incomplete'` so the
 * decoder buffers instead of treating `ESC` as Escape.
 */
export function matchX10Mouse(
  input: string,
  index: number,
):
  | { readonly raw: string; readonly event: NativeInputMouseEvent }
  | 'incomplete'
  | undefined {
  if (!input.startsWith('\u001B[M', index)) return undefined;
  const payloadStart = index + 3;
  if (input.length < payloadStart + 3) return 'incomplete';
  const cb = input.charCodeAt(payloadStart);
  const cx = input.charCodeAt(payloadStart + 1);
  const cy = input.charCodeAt(payloadStart + 2);
  if (!Number.isFinite(cb) || !Number.isFinite(cx) || !Number.isFinite(cy)) {
    return 'incomplete';
  }
  // X10 encodes button/modifiers in Cb - 32; coordinates are 1-based (Cx/Cy - 32).
  const encodedButton = cb - 32;
  const terminalX = cx - 32;
  const terminalY = cy - 32;
  const raw = input.slice(index, payloadStart + 3);
  const button = decodeSgrMouseButton(encodedButton);
  // X10 has no separate release final byte; button=3 ('none') is release.
  // Motion bit (32) marks drag; wheel uses bit 64 same as SGR.
  let action: NativeInputMouseAction;
  if (button.startsWith('wheel-')) {
    action = 'wheel';
  } else if (button === 'none') {
    action = 'release';
  } else if ((encodedButton & 32) !== 0) {
    action = 'drag';
  } else {
    action = 'press';
  }
  return {
    raw,
    event: {
      type: 'mouse',
      raw,
      button,
      action,
      x: Math.max(0, terminalX - 1),
      y: Math.max(0, terminalY - 1),
      ...decodeSgrMouseModifiers(encodedButton),
    },
  };
}

function decodeSgrMouseButton(encodedButton: number): NativeInputMouseButton {
  const button = encodedButton & 3;
  if ((encodedButton & 64) !== 0) {
    switch (button) {
      case 0:
        return 'wheel-up';
      case 1:
        return 'wheel-down';
      case 2:
        return 'wheel-right';
      case 3:
        return 'wheel-left';
    }
  }
  switch (button) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    case 3:
      return 'none';
    default:
      return 'unknown';
  }
}

function decodeSgrMouseAction(
  encodedButton: number,
  final: string,
  button: NativeInputMouseButton,
): NativeInputMouseAction {
  if (button.startsWith('wheel-')) return 'wheel';
  if (final === 'm') return 'release';
  if ((encodedButton & 32) !== 0) return button === 'none' ? 'move' : 'drag';
  return 'press';
}

function decodeSgrMouseModifiers(encodedButton: number): {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
} {
  return {
    shift: (encodedButton & 4) !== 0,
    alt: (encodedButton & 8) !== 0,
    ctrl: (encodedButton & 16) !== 0,
  };
}
