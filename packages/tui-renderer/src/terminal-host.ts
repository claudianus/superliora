import type { Component } from './text-component';

export type RendererInputListenerResult =
  | {
      readonly consume?: boolean;
      readonly data?: string;
    }
  | undefined;

export type RendererInputListener = (data: string) => RendererInputListenerResult;

export interface RendererTerminalHost {
  readonly columns: number;
  readonly rows: number;
  write(chunk: string): void;
  drainInput?(): Promise<void>;
  setTitle?(title: string): void;
  setProgress?(active: boolean): void;
}

export interface RendererRootUI<TComponent extends Component = Component> {
  readonly terminal: RendererTerminalHost;
  readonly children: TComponent[];
  start(): void;
  stop(): void;
  requestRender(force?: boolean): void;
  addChild(component: TComponent): void;
  clear(): void;
  setFocus(component: TComponent): void;
  addInputListener(listener: RendererInputListener): () => void;
}
