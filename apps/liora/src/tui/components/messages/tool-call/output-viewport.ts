import { Container, type Component } from '#/tui/renderer';
import { ToolOutputViewportComponent } from '#/tui/components/messages/tool-output-viewport';
import {
  createToolOutputViewportState,
  type ToolOutputViewportState,
} from '#/tui/utils/tool/tool-output-viewport';

export class ToolCallOutputViewportMount {
  private viewport: ToolOutputViewportComponent | undefined;
  private viewportState = createToolOutputViewportState();
  private hovered = false;
  private dragging = false;

  constructor(
    private readonly host: {
      readonly toolCallId: string;
      readonly toolOutputViewports: Map<string, ToolOutputViewportState> | undefined;
      isExpanded: () => boolean;
      addChild: (child: Component) => void;
    },
  ) {}

  get active(): ToolOutputViewportComponent | undefined {
    return this.viewport;
  }

  reset(): void {
    this.viewport = undefined;
  }

  mount(components: readonly Component[], initialFollowEnd = false): void {
    if (components.length === 0) return;
    const child = new Container();
    for (const component of components) child.addChild(component);
    const viewport = new ToolOutputViewportComponent({
      child,
      getState: () => this.getState(),
      setState: (state) =>{  this.setState(state); },
      expanded: this.host.isExpanded(),
      initialFollowEnd,
    });
    viewport.setHovered(this.hovered);
    viewport.setDragging(this.dragging);
    this.viewport = viewport;
    this.host.addChild(viewport);
  }

  scroll(deltaRows: number): boolean {
    return this.viewport?.scroll(deltaRows) ?? false;
  }

  resize(requestedHeight: number, maxHeight: number): boolean {
    return this.viewport?.resize(requestedHeight, maxHeight) ?? false;
  }

  setHovered(hovered: boolean): void {
    this.hovered = hovered;
    this.viewport?.setHovered(hovered);
  }

  setDragging(dragging: boolean): void {
    this.dragging = dragging;
    this.viewport?.setDragging(dragging);
  }

  hitAt(
    localRow: number,
    localColumn: number,
    width: number,
    children: readonly Component[],
  ): { readonly onRail: boolean; readonly onGrip: boolean; readonly viewportRow: number } | undefined {
    const viewport = this.viewport;
    if (viewport === undefined || localRow < 0) return undefined;

    let startRow = 0;
    for (const child of children) {
      const rowCount = child.render(width).length;
      if (child === viewport) {
        const viewportRow = localRow - startRow;
        if (viewportRow < 0 || viewportRow >= rowCount) return undefined;
        const onRail = viewport.overflowing && localColumn === Math.max(0, width - 1);
        return {
          onRail,
          onGrip: onRail && viewport.isGripRow(viewportRow),
          viewportRow,
        };
      }
      startRow += rowCount;
    }
    return undefined;
  }

  private getState(): ToolOutputViewportState {
    const stored = this.host.toolOutputViewports?.get(this.host.toolCallId);
    if (stored !== undefined) {
      this.viewportState = stored;
      return stored;
    }
    this.host.toolOutputViewports?.set(this.host.toolCallId, this.viewportState);
    return this.viewportState;
  }

  private setState(state: ToolOutputViewportState): void {
    this.viewportState = state;
    this.host.toolOutputViewports?.set(this.host.toolCallId, state);
  }
}
