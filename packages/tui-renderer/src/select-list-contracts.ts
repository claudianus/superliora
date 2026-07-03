import { type Component, truncateToWidth, visibleWidth } from './text-component';
import { Key, matchesKey } from './input-keys';
import { RendererSelectableListViewport } from './viewport';

export interface SelectItem {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface SelectListTheme {
  readonly selectedPrefix: (text: string) => string;
  readonly selectedText: (text: string) => string;
  readonly description: (text: string) => string;
  readonly scrollInfo: (text: string) => string;
  readonly noMatch: (text: string) => string;
}

export interface SelectListTruncatePrimaryContext {
  readonly text: string;
  readonly maxWidth: number;
  readonly columnWidth: number;
  readonly item: SelectItem;
  readonly isSelected: boolean;
}

export interface SelectListLayoutOptions {
  readonly minPrimaryColumnWidth?: number;
  readonly maxPrimaryColumnWidth?: number;
  readonly truncatePrimary?: (context: SelectListTruncatePrimaryContext) => string;
}

export interface EditorTheme {
  readonly borderColor: (text: string) => string;
  readonly selectList: SelectListTheme;
}

const DEFAULT_PRIMARY_COLUMN_WIDTH = 32;
const PRIMARY_COLUMN_GAP = 2;
const MIN_DESCRIPTION_WIDTH = 10;

export class SelectList implements Component {
  private items: SelectItem[];
  private filteredItems: SelectItem[];
  private readonly viewport: RendererSelectableListViewport;
  private readonly maxVisible: number;
  private readonly theme: SelectListTheme;
  private readonly layout: SelectListLayoutOptions;

  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;
  onSelectionChange?: (item: SelectItem) => void;

  constructor(
    items: SelectItem[],
    maxVisible: number,
    theme: SelectListTheme,
    layout: SelectListLayoutOptions = {},
  ) {
    this.items = items;
    this.filteredItems = items;
    this.maxVisible = maxVisible;
    this.theme = theme;
    this.layout = layout;
    this.viewport = new RendererSelectableListViewport({
      itemCount: items.length,
      viewportRows: maxVisible,
    });
  }

  setFilter(filter: string): void {
    const lower = filter.toLowerCase();
    this.filteredItems = this.items.filter((item) => item.value.toLowerCase().startsWith(lower));
    this.viewport.update({
      itemCount: this.filteredItems.length,
      selectedIndex: 0,
      viewportRows: this.maxVisible,
    });
    this.notifySelectionChange();
  }

  setSelectedIndex(index: number): void {
    this.viewport.update({
      itemCount: this.filteredItems.length,
      selectedIndex: index,
      viewportRows: this.maxVisible,
    });
    this.notifySelectionChange();
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.filteredItems.length === 0) {
      return [this.theme.noMatch('  No matching commands')];
    }

    const primaryColumnWidth = this.getPrimaryColumnWidth();
    const window = this.viewport.project({
      items: this.filteredItems,
      viewportRows: this.maxVisible,
    });
    const lines: string[] = [];

    for (const row of window.items) {
      lines.push(this.renderItem(row.item, row.isSelected, width, primaryColumnWidth));
    }

    if (window.hasOverflow) {
      const scrollText = `  (${window.selectedIndex + 1}/${window.itemCount})`;
      lines.push(this.theme.scrollInfo(truncateToWidth(scrollText, width - 2, '')));
    }
    return lines;
  }

  handleInput(keyData: string): void {
    if (matchesKey(keyData, Key.up)) {
      this.viewport.moveSelection(-1, true);
      this.notifySelectionChange();
      return;
    }
    if (matchesKey(keyData, Key.down)) {
      this.viewport.moveSelection(1, true);
      this.notifySelectionChange();
      return;
    }
    if (matchesKey(keyData, Key.enter)) {
      const selectedItem = this.getSelectedItem();
      if (selectedItem !== null) this.onSelect?.(selectedItem);
      return;
    }
    if (matchesKey(keyData, Key.escape) || matchesKey(keyData, Key.ctrl('c'))) {
      this.onCancel?.();
    }
  }

  getSelectedItem(): SelectItem | null {
    return this.filteredItems[this.viewport.snapshot().selectedIndex] ?? null;
  }

  private renderItem(
    item: SelectItem,
    isSelected: boolean,
    width: number,
    primaryColumnWidth: number,
  ): string {
    const prefix = isSelected ? '→ ' : '  ';
    const prefixWidth = visibleWidth(prefix);
    const descriptionSingleLine = item.description?.replaceAll(/[\r\n]+/g, ' ').trim();

    if (descriptionSingleLine !== undefined && descriptionSingleLine.length > 0 && width > 40) {
      const effectivePrimaryColumnWidth = Math.max(1, Math.min(primaryColumnWidth, width - prefixWidth - 4));
      const maxPrimaryWidth = Math.max(1, effectivePrimaryColumnWidth - PRIMARY_COLUMN_GAP);
      const truncatedValue = this.truncatePrimary(item, isSelected, maxPrimaryWidth, effectivePrimaryColumnWidth);
      const truncatedValueWidth = visibleWidth(truncatedValue);
      const spacing = ' '.repeat(Math.max(1, effectivePrimaryColumnWidth - truncatedValueWidth));
      const descriptionStart = prefixWidth + truncatedValueWidth + spacing.length;
      const remainingWidth = width - descriptionStart - 2;
      if (remainingWidth > MIN_DESCRIPTION_WIDTH) {
        const truncatedDescription = truncateToWidth(descriptionSingleLine, remainingWidth, '');
        if (isSelected) return this.theme.selectedText(`${prefix}${truncatedValue}${spacing}${truncatedDescription}`);
        return prefix + truncatedValue + this.theme.description(spacing + truncatedDescription);
      }
    }

    const maxWidth = width - prefixWidth - 2;
    const truncatedValue = this.truncatePrimary(item, isSelected, maxWidth, maxWidth);
    return isSelected ? this.theme.selectedText(`${prefix}${truncatedValue}`) : prefix + truncatedValue;
  }

  private getPrimaryColumnWidth(): number {
    const { min, max } = this.getPrimaryColumnBounds();
    const widestPrimary = this.filteredItems.reduce(
      (widest, item) => Math.max(widest, visibleWidth(this.getDisplayValue(item)) + PRIMARY_COLUMN_GAP),
      0,
    );
    return clamp(widestPrimary, min, max);
  }

  private getPrimaryColumnBounds(): { readonly min: number; readonly max: number } {
    const rawMin =
      this.layout.minPrimaryColumnWidth ?? this.layout.maxPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
    const rawMax =
      this.layout.maxPrimaryColumnWidth ?? this.layout.minPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
    return {
      min: Math.max(1, Math.min(rawMin, rawMax)),
      max: Math.max(1, Math.max(rawMin, rawMax)),
    };
  }

  private truncatePrimary(
    item: SelectItem,
    isSelected: boolean,
    maxWidth: number,
    columnWidth: number,
  ): string {
    const displayValue = this.getDisplayValue(item);
    const truncatedValue = this.layout.truncatePrimary
      ? this.layout.truncatePrimary({ text: displayValue, maxWidth, columnWidth, item, isSelected })
      : truncateToWidth(displayValue, maxWidth, '');
    return truncateToWidth(truncatedValue, maxWidth, '');
  }

  private getDisplayValue(item: SelectItem): string {
    return item.label || item.value;
  }

  private notifySelectionChange(): void {
    const selectedItem = this.getSelectedItem();
    if (selectedItem !== null) this.onSelectionChange?.(selectedItem);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
