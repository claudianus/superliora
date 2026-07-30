import type { CompactionPhase } from '@superliora/sdk';

import type { CompactionComponent } from '../../components/dialogs/session/compaction';
import type { TodoItem } from '../../components/chrome/todo/todo-panel';
import { requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import type { StreamingUIHost } from './host-types';
import { runStreamingCompactionAction } from './turn-finalize';

export interface StreamingCompactionHost {
  readonly host: StreamingUIHost;
  getBlock(): CompactionComponent | undefined;
  setBlock(block: CompactionComponent | undefined): void;
}

export function setStreamingTodoList(
  host: StreamingUIHost,
  todos: readonly TodoItem[],
): void {
  const { state } = host;
  state.todoPanel.setGoal(state.appState.goal);
  state.todoPanel.setTodos(todos);
  state.todoPanelContainer.clear();
  if (!state.todoPanel.isEmpty()) {
    state.todoPanelContainer.addChild(state.todoPanel);
  }
  requestTUILayoutRender(state);
}

export function applyStreamingCompactionAction(
  host: StreamingUIHost,
  activeCompactionBlock: CompactionComponent | undefined,
  action:
    | {
        readonly kind: 'begin';
        readonly instruction?: string;
        readonly options?: { readonly background?: boolean; readonly modelAlias?: string };
      }
    | {
        readonly kind: 'end';
        readonly tokensBefore?: number;
        readonly tokensAfter?: number;
        readonly detail?: string;
      }
    | { readonly kind: 'cancel' }
    | { readonly kind: 'promote' }
    | {
        readonly kind: 'progress';
        readonly phase: CompactionPhase;
        readonly delta?: string;
        readonly meta?: {
          readonly streamKind?: 'summary' | 'block' | 'merge' | 'repair';
          readonly blockIndex?: number;
          readonly blockCount?: number;
          readonly blocksCompleted?: number;
          readonly fraction?: number;
        };
      },
): CompactionComponent | undefined {
  return runStreamingCompactionAction(host, activeCompactionBlock, action);
}

function withCompactionBlock(
  ctx: StreamingCompactionHost,
  action: Parameters<typeof applyStreamingCompactionAction>[2],
): void {
  ctx.setBlock(applyStreamingCompactionAction(ctx.host, ctx.getBlock(), action));
}

export function streamingBeginCompaction(
  ctx: StreamingCompactionHost,
  instruction?: string,
  options?: { readonly background?: boolean; readonly modelAlias?: string },
): void {
  withCompactionBlock(ctx, { kind: 'begin', instruction, options });
}

export function streamingEndCompaction(
  ctx: StreamingCompactionHost,
  tokensBefore?: number,
  tokensAfter?: number,
  detail?: string,
): void {
  withCompactionBlock(ctx, { kind: 'end', tokensBefore, tokensAfter, detail });
}

export function streamingCancelCompaction(ctx: StreamingCompactionHost): void {
  withCompactionBlock(ctx, { kind: 'cancel' });
}

export function streamingPromoteCompaction(ctx: StreamingCompactionHost): void {
  withCompactionBlock(ctx, { kind: 'promote' });
}

export function streamingUpdateCompactionProgress(
  ctx: StreamingCompactionHost,
  phase: CompactionPhase,
  delta?: string,
  meta?: {
    readonly streamKind?: 'summary' | 'block' | 'merge' | 'repair';
    readonly blockIndex?: number;
    readonly blockCount?: number;
    readonly blocksCompleted?: number;
    readonly fraction?: number;
  },
): void {
  withCompactionBlock(ctx, { kind: 'progress', phase, delta, meta });
}
