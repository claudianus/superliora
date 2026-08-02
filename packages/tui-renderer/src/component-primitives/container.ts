import type { Component } from '../text/component';
import {
  isTranscriptMeasureMode,
  measurePlaceholderLines,
} from '../transcript/measure-mode';

export class Container implements Component {
  children: Component[] = [];

  addChild(component: Component): void {
    this.children.push(component);
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) this.children.splice(index, 1);
  }

  clear(): void {
    this.children = [];
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  /** Recurse leaf paint-cache drop only — never full invalidate side effects. */
  softDropPaintCaches(): void {
    for (const child of this.children) {
      child.softDropPaintCaches?.();
    }
  }

  /**
   * Row count without spreading child paint arrays. Critical under transcript
   * measure mode: multi-k leaves return length-only placeholders that are not
   * iterable — `push(...child.render())` would throw / re-freeze.
   */
  measureContentRows(width: number): number {
    let total = 0;
    for (const child of this.children) {
      total += measureChildRows(child, width);
    }
    return total;
  }

  render(width: number): string[] {
    // Geometry probes: never spread multi-k measure placeholders into a real array.
    if (isTranscriptMeasureMode()) {
      return measurePlaceholderLines(this.measureContentRows(width));
    }

    const lines: string[] = [];
    for (const child of this.children) {
      lines.push(...child.render(width));
    }
    return lines;
  }
}

function measureChildRows(child: Component, width: number): number {
  if (typeof child.measureContentRows === 'function') {
    return child.measureContentRows(width);
  }
  return child.render(width).length;
}
