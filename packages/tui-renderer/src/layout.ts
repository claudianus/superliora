import type { RendererRect } from './compositor';

export type RendererLayoutDirection = 'horizontal' | 'vertical';

export type RendererLayoutConstraint =
  | { readonly type: 'length'; readonly value: number }
  | { readonly type: 'min'; readonly value: number }
  | { readonly type: 'max'; readonly value: number }
  | { readonly type: 'percent'; readonly value: number }
  | { readonly type: 'ratio'; readonly numerator: number; readonly denominator: number }
  | { readonly type: 'flex'; readonly value?: number };

export interface RendererLayoutMargin {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

export interface RendererSplitLayoutOptions {
  readonly rect: RendererRect;
  readonly direction: RendererLayoutDirection;
  readonly constraints: readonly RendererLayoutConstraint[];
  readonly gap?: number;
  readonly margin?: number | RendererLayoutMargin;
}

export interface RendererLayoutNode {
  readonly id?: string;
  readonly direction?: RendererLayoutDirection;
  readonly constraint?: RendererLayoutConstraint;
  readonly gap?: number;
  readonly margin?: number | RendererLayoutMargin;
  readonly children?: readonly RendererLayoutNode[];
}

export interface RendererResolvedLayoutNode {
  readonly id?: string;
  readonly rect: RendererRect;
  readonly children: readonly RendererResolvedLayoutNode[];
}

export const layoutLength = (value: number): RendererLayoutConstraint => ({
  type: 'length',
  value,
});

export const layoutMin = (value: number): RendererLayoutConstraint => ({
  type: 'min',
  value,
});

export const layoutMax = (value: number): RendererLayoutConstraint => ({
  type: 'max',
  value,
});

export const layoutPercent = (value: number): RendererLayoutConstraint => ({
  type: 'percent',
  value,
});

export const layoutRatio = (
  numerator: number,
  denominator: number,
): RendererLayoutConstraint => ({
  type: 'ratio',
  numerator,
  denominator,
});

export const layoutFlex = (value = 1): RendererLayoutConstraint => ({
  type: 'flex',
  value,
});

export function splitRendererRect(options: RendererSplitLayoutOptions): readonly RendererRect[] {
  const rect = insetRendererRect(normalizeRect(options.rect), options.margin);
  const constraints = options.constraints;
  if (constraints.length === 0) return [];

  const gap = normalizeNonNegative(options.gap);
  const axisSize = axisLength(rect, options.direction);
  const totalGap = Math.min(axisSize, gap * Math.max(0, constraints.length - 1));
  const contentSize = Math.max(0, axisSize - totalGap);
  const sizes = resolveConstraintSizes(contentSize, constraints);
  const out: RendererRect[] = [];
  let cursor = options.direction === 'horizontal' ? rect.x : rect.y;

  for (const size of sizes) {
    if (options.direction === 'horizontal') {
      out.push({ x: cursor, y: rect.y, width: size, height: rect.height });
      cursor += size + gap;
    } else {
      out.push({ x: rect.x, y: cursor, width: rect.width, height: size });
      cursor += size + gap;
    }
  }

  return out;
}

export function insetRendererRect(
  rect: RendererRect,
  margin: number | RendererLayoutMargin | undefined,
): RendererRect {
  const normalized = normalizeRect(rect);
  const resolved = resolveMargin(margin);
  const x = normalized.x + resolved.left;
  const y = normalized.y + resolved.top;
  const width = Math.max(0, normalized.width - resolved.left - resolved.right);
  const height = Math.max(0, normalized.height - resolved.top - resolved.bottom);
  return { x, y, width, height };
}

export function resolveRendererLayoutTree(
  root: RendererLayoutNode,
  rect: RendererRect,
): RendererResolvedLayoutNode {
  const currentRect = insetRendererRect(rect, root.margin);
  const children = root.children ?? [];
  if (children.length === 0) return { id: root.id, rect: currentRect, children: [] };

  const direction = root.direction ?? 'vertical';
  const childRects = splitRendererRect({
    rect: currentRect,
    direction,
    gap: root.gap,
    constraints: children.map((child) => child.constraint ?? layoutFlex()),
  });

  return {
    id: root.id,
    rect: currentRect,
    children: children.map((child, index) =>
      resolveRendererLayoutTree(child, childRects[index] ?? emptyRectAt(currentRect)),
    ),
  };
}

export function flattenResolvedLayout(
  node: RendererResolvedLayoutNode,
): readonly RendererResolvedLayoutNode[] {
  return [node, ...node.children.flatMap((child) => flattenResolvedLayout(child))];
}

function resolveConstraintSizes(
  available: number,
  constraints: readonly RendererLayoutConstraint[],
): readonly number[] {
  const sizes = constraints.map((constraint) => preferredSize(available, constraint));
  const minSizes = constraints.map((constraint) => minSize(constraint));
  const maxSizes = constraints.map((constraint) => maxSize(available, constraint));
  let used = sizes.reduce((sum, size) => sum + size, 0);

  if (used > available) {
    let overflow = used - available;
    for (let i = sizes.length - 1; i >= 0 && overflow > 0; i--) {
      const removable = Math.max(0, sizes[i]! - minSizes[i]!);
      const removed = Math.min(removable, overflow);
      sizes[i] = sizes[i]! - removed;
      overflow -= removed;
    }
  }

  used = sizes.reduce((sum, size) => sum + size, 0);
  if (used < available) {
    let remaining = available - used;
    const flexWeights = constraints.map((constraint) =>
      constraint.type === 'flex' ? Math.max(1, Math.floor(constraint.value ?? 1)) : 0,
    );
    const totalWeight = flexWeights.reduce((sum, weight) => sum + weight, 0);

    if (totalWeight > 0) {
      remaining = distributeByWeight(sizes, maxSizes, flexWeights, remaining);
    }

    remaining = distributeInOrder(sizes, maxSizes, growMask(constraints, 'max'), remaining);
    remaining = distributeInOrder(sizes, maxSizes, growMask(constraints, 'min'), remaining);
  }

  return sizes.map((size) => Math.max(0, Math.floor(size)));
}

function distributeByWeight(
  sizes: number[],
  maxSizes: readonly number[],
  weights: readonly number[],
  amount: number,
): number {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0 || amount <= 0) return amount;

  let remaining = amount;
  for (let i = 0; i < sizes.length && remaining > 0; i++) {
    const weight = weights[i]!;
    if (weight === 0) continue;
    const share = Math.floor((amount * weight) / totalWeight);
    const room = Math.max(0, maxSizes[i]! - sizes[i]!);
    const added = Math.min(room, share);
    sizes[i] = sizes[i]! + added;
    remaining -= added;
  }

  return distributeInOrder(sizes, maxSizes, weights.map((weight) => weight > 0), remaining);
}

function distributeInOrder(
  sizes: number[],
  maxSizes: readonly number[],
  mask: readonly boolean[],
  amount: number,
): number {
  let remaining = amount;
  for (let i = 0; i < sizes.length && remaining > 0; i++) {
    if (mask[i] !== true) continue;
    const room = Math.max(0, maxSizes[i]! - sizes[i]!);
    const added = Math.min(room, remaining);
    sizes[i] = sizes[i]! + added;
    remaining -= added;
  }
  return remaining;
}

function growMask(
  constraints: readonly RendererLayoutConstraint[],
  type: 'min' | 'max',
): readonly boolean[] {
  return constraints.map((constraint) => constraint.type === type);
}

function preferredSize(available: number, constraint: RendererLayoutConstraint): number {
  switch (constraint.type) {
    case 'length':
      return clampSize(constraint.value, 0, available);
    case 'min':
      return clampSize(constraint.value, 0, available);
    case 'max':
      return 0;
    case 'percent':
      return clampSize(Math.floor((available * constraint.value) / 100), 0, available);
    case 'ratio':
      return constraint.denominator <= 0
        ? 0
        : clampSize(Math.floor((available * constraint.numerator) / constraint.denominator), 0, available);
    case 'flex':
      return 0;
  }
}

function minSize(constraint: RendererLayoutConstraint): number {
  if (constraint.type === 'length') return normalizeNonNegative(constraint.value);
  if (constraint.type === 'min') return normalizeNonNegative(constraint.value);
  return 0;
}

function maxSize(available: number, constraint: RendererLayoutConstraint): number {
  if (constraint.type === 'length') return normalizeNonNegative(constraint.value);
  if (constraint.type === 'max') return clampSize(constraint.value, 0, available);
  return available;
}

function normalizeRect(rect: RendererRect): RendererRect {
  return {
    x: normalizeCoordinate(rect.x),
    y: normalizeCoordinate(rect.y),
    width: normalizeNonNegative(rect.width),
    height: normalizeNonNegative(rect.height),
  };
}

function normalizeCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value);
}

function normalizeNonNegative(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function clampSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function axisLength(rect: RendererRect, direction: RendererLayoutDirection): number {
  return direction === 'horizontal' ? rect.width : rect.height;
}

function resolveMargin(margin: number | RendererLayoutMargin | undefined): Required<RendererLayoutMargin> {
  if (typeof margin === 'number') {
    const size = normalizeNonNegative(margin);
    return { top: size, right: size, bottom: size, left: size };
  }
  return {
    top: normalizeNonNegative(margin?.top),
    right: normalizeNonNegative(margin?.right),
    bottom: normalizeNonNegative(margin?.bottom),
    left: normalizeNonNegative(margin?.left),
  };
}

function emptyRectAt(rect: RendererRect): RendererRect {
  return { x: rect.x, y: rect.y, width: 0, height: 0 };
}
