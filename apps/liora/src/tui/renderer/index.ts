import type { RendererTerminalHost } from '@harness-kit/tui-renderer';

export * from '@harness-kit/tui-renderer';
export * from './lifecycle';
export * from './native-root-ui';
export * from './region-layout';

/** Legacy alias used by a few call sites before the renderer package rename. */
export type Terminal = RendererTerminalHost;
