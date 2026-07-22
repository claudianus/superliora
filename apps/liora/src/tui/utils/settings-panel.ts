/**
 * SettingsPanel — form-based settings UI with toggles, sliders, selects.
 *
 * Provides a terminal settings interface:
 * - Toggle switches (on/off)
 * - Range sliders with min/max/step
 * - Select dropdowns (single choice)
 * - Multi-select checkboxes
 * - Text/number input fields
 * - Section grouping with headers
 * - Search/filter settings
 * - Modified indicator (unsaved changes)
 * - Reset to defaults
 * - Import/export settings
 * - Keyboard navigation (Tab/Shift+Tab/Arrows)
 * - Validation with error messages
 *
 * Visual style:
 * ┌─ Settings ──────────────────────────────── [●●○] ┐
 * │                                                   │
 * │ ▸ Appearance                                      │
 * │   Theme         [Dark          ▾]                 │
 * │   Font Size     ──────●─────── 14                 │
 * │   Ligatures     [✓] Enabled                       │
 * │                                                   │
 * │ ▸ Editor                                          │
 * │   Tab Size      [2             ▾]                 │
 * │   Auto Save     [✓] Enabled                       │
 * │   Word Wrap     [ ] Disabled                      │
 * │                                                   │
 * │ [Save] [Reset] [Export]      2 modified           │
 * └───────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingType = 'toggle' | 'slider' | 'select' | 'multiselect' | 'text' | 'number';

export interface SettingItem {
  readonly id: string;
  readonly label: string;
  readonly type: SettingType;
  readonly section: string;
  readonly value: unknown;
  readonly defaultValue: unknown;
  readonly description?: string;
  // Toggle
  readonly enabledLabel?: string;
  readonly disabledLabel?: string;
  // Slider
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  // Select
  readonly options?: { label: string; value: string }[];
  // Validation
  readonly validate?: (value: unknown) => string | null;
}

export interface SettingsSection {
  readonly id: string;
  readonly label: string;
  readonly collapsed?: boolean;
}

export interface SettingsRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showDescriptions?: boolean;
  readonly showModified?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

export class SettingsPanel {
  private sections: SettingsSection[] = [];
  private items: Map<string, SettingItem> = new Map();
  private focusedId: string | null = null;
  private searchQuery = '';
  private modifiedIds: Set<string> = new Set();

  // ─── Section Management ──────────────────────────────────────────

  /** Add a section. */
  addSection(id: string, label: string): void {
    this.sections.push({ id, label, collapsed: false });
  }

  /** Toggle section collapse. */
  toggleSection(id: string): void {
    const section = this.sections.find((s) => s.id === id);
    if (section) {
      const idx = this.sections.indexOf(section);
      this.sections[idx] = { ...section, collapsed: !section.collapsed };
    }
  }

  // ─── Item Management ─────────────────────────────────────────────

  /** Add a setting item. */
  addItem(item: SettingItem): void {
    this.items.set(item.id, item);
  }

  /** Get a setting value. */
  getValue<T>(id: string): T | undefined {
    return this.items.get(id)?.value as T | undefined;
  }

  /** Set a setting value. */
  setValue(id: string, value: unknown): string | null {
    const item = this.items.get(id);
    if (!item) return 'Setting not found';

    // Validate
    if (item.validate) {
      const error = item.validate(value);
      if (error) return error;
    }

    this.items.set(id, { ...item, value });

    // Track modification
    if (JSON.stringify(value) !== JSON.stringify(item.defaultValue)) {
      this.modifiedIds.add(id);
    } else {
      this.modifiedIds.delete(id);
    }

    return null;
  }

  /** Toggle a boolean setting. */
  toggle(id: string): void {
    const item = this.items.get(id);
    if (item && item.type === 'toggle') {
      this.setValue(id, !item.value);
    }
  }

  /** Adjust a slider value. */
  adjustSlider(id: string, direction: 1 | -1): void {
    const item = this.items.get(id);
    if (item && item.type === 'slider') {
      const step = item.step ?? 1;
      const min = item.min ?? 0;
      const max = item.max ?? 100;
      const current = (item.value as number) ?? min;
      const next = Math.max(min, Math.min(max, current + direction * step));
      this.setValue(id, next);
    }
  }

  /** Cycle select option. */
  cycleSelect(id: string, direction: 1 | -1 = 1): void {
    const item = this.items.get(id);
    if (item && item.type === 'select' && item.options) {
      const currentIdx = item.options.findIndex((o) => o.value === item.value);
      const nextIdx = (currentIdx + direction + item.options.length) % item.options.length;
      this.setValue(id, item.options[nextIdx]!.value);
    }
  }

  /** Reset a setting to default. */
  resetItem(id: string): void {
    const item = this.items.get(id);
    if (item) {
      this.items.set(id, { ...item, value: item.defaultValue });
      this.modifiedIds.delete(id);
    }
  }

  /** Reset all settings. */
  resetAll(): void {
    for (const [id, item] of this.items) {
      this.items.set(id, { ...item, value: item.defaultValue });
    }
    this.modifiedIds.clear();
  }

  /** Get modified count. */
  get modifiedCount(): number {
    return this.modifiedIds.size;
  }

  /** Check if any setting is modified. */
  get isModified(): boolean {
    return this.modifiedIds.size > 0;
  }

  // ─── Focus / Navigation ──────────────────────────────────────────

  /** Set focused item. */
  focus(id: string | null): void {
    this.focusedId = id;
  }

  /** Move focus to next item. */
  focusNext(): void {
    const visibleItems = this.getVisibleItems();
    if (visibleItems.length === 0) return;

    const currentIdx = visibleItems.findIndex((i) => i.id === this.focusedId);
    const nextIdx = (currentIdx + 1) % visibleItems.length;
    this.focusedId = visibleItems[nextIdx]!.id;
  }

  /** Move focus to previous item. */
  focusPrev(): void {
    const visibleItems = this.getVisibleItems();
    if (visibleItems.length === 0) return;

    const currentIdx = visibleItems.findIndex((i) => i.id === this.focusedId);
    const prevIdx = (currentIdx - 1 + visibleItems.length) % visibleItems.length;
    this.focusedId = visibleItems[prevIdx]!.id;
  }

  // ─── Search ──────────────────────────────────────────────────────

  /** Set search query. */
  setSearch(query: string): void {
    this.searchQuery = query.toLowerCase();
  }

  // ─── Export/Import ───────────────────────────────────────────────

  /** Export all settings as JSON. */
  export(): string {
    const result: Record<string, unknown> = {};
    for (const [id, item] of this.items) {
      result[id] = item.value;
    }
    return JSON.stringify(result, null, 2);
  }

  /** Import settings from JSON. */
  import(json: string): string[] {
    const errors: string[] = [];
    try {
      const data = JSON.parse(json) as Record<string, unknown>;
      for (const [id, value] of Object.entries(data)) {
        const error = this.setValue(id, value);
        if (error) errors.push(`${id}: ${error}`);
      }
    } catch {
      errors.push('Invalid JSON');
    }
    return errors;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  private getVisibleItems(): SettingItem[] {
    let items = [...this.items.values()];

    // Filter by search
    if (this.searchQuery) {
      items = items.filter((i) =>
        i.label.toLowerCase().includes(this.searchQuery) ||
        i.section.toLowerCase().includes(this.searchQuery) ||
        (i.description ?? '').toLowerCase().includes(this.searchQuery)
      );
    }

    return items;
  }

  /** Render the settings panel. */
  render(options: SettingsRenderOptions): string[] {
    const { width, height, showDescriptions = false, showModified = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    // Header
    const modifiedDots = showModified && this.modifiedIds.size > 0
      ? ` [${fg('warning', '●'.repeat(Math.min(this.modifiedIds.size, 3)))}${dimFg('textMuted', '○'.repeat(Math.max(0, 3 - this.modifiedIds.size)))}]`
      : '';
    const title = ` Settings${this.searchQuery ? ` — "${this.searchQuery}"` : ''}`;
    lines.push(fg('textMuted', `┌─${boldFg('text', title)}${'─'.repeat(Math.max(0, innerWidth - title.length - 6))}${modifiedDots} ┐`));

    // Group items by section
    const visibleItems = this.getVisibleItems();
    const sectionMap = new Map<string, SettingItem[]>();
    for (const item of visibleItems) {
      const list = sectionMap.get(item.section) ?? [];
      list.push(item);
      sectionMap.set(item.section, list);
    }

    let lineCount = 0;
    const maxContentLines = height - 4; // header + footer + borders

    for (const section of this.sections) {
      if (lineCount >= maxContentLines) break;

      const sectionItems = sectionMap.get(section.id);
      if (!sectionItems || sectionItems.length === 0) continue;

      // Section header
      const collapseIcon = section.collapsed ? '▸' : '▾';
      const sectionLine = ` ${boldFg('accent', `${collapseIcon} ${section.label}`)}`;
      lines.push(fg('textMuted', '│') + padRight(sectionLine, innerWidth) + fg('textMuted', '│'));
      lineCount++;

      if (section.collapsed) continue;

      // Items
      for (const item of sectionItems) {
        if (lineCount >= maxContentLines) break;

        const itemLine = this.renderItem(item, innerWidth, options);
        lines.push(fg('textMuted', '│') + itemLine + fg('textMuted', '│'));
        lineCount++;

        // Description
        if (showDescriptions && item.description) {
          const descLine = dimFg('textMuted', `     ${item.description.slice(0, innerWidth - 8)}`);
          lines.push(fg('textMuted', '│') + padRight(descLine, innerWidth) + fg('textMuted', '│'));
          lineCount++;
        }
      }

      // Blank line between sections
      if (lineCount < maxContentLines) {
        lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
        lineCount++;
      }
    }

    // Pad remaining
    while (lines.length < height - 1) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    // Footer
    const modifiedInfo = this.modifiedIds.size > 0 ? fg('warning', `${String(this.modifiedIds.size)} modified`) : dimFg('textMuted', 'no changes');
    const actions = `${fg('success', '[Save]')} ${fg('primary', '[Reset]')} ${fg('accent', '[Export]')}`;
    const footer = ` ${actions}      ${modifiedInfo}`;
    lines.push(fg('textMuted', `└${padRight(footer, innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private renderItem(item: SettingItem, width: number, options: SettingsRenderOptions): string {
    const { fg, boldFg, dimFg } = options;
    const isFocused = item.id === this.focusedId;
    const isModified = this.modifiedIds.has(item.id);
    const labelWidth = 14;

    const focusIndicator = isFocused ? fg('primary', '▸') : ' ';
    const modifiedMark = isModified ? fg('warning', '●') : ' ';
    const label = `${item.label}`.padEnd(labelWidth).slice(0, labelWidth);
    const labelStr = isFocused ? boldFg('text', label) : fg('text', label);

    let control = '';

    switch (item.type) {
      case 'toggle': {
        const enabled = item.value as boolean;
        const box = enabled ? fg('success', '[✓]') : dimFg('textMuted', '[ ]');
        const stateLabel = enabled
          ? fg('success', item.enabledLabel ?? 'Enabled')
          : dimFg('textMuted', item.disabledLabel ?? 'Disabled');
        control = `${box} ${stateLabel}`;
        break;
      }
      case 'slider': {
        const value = (item.value as number) ?? 0;
        const min = item.min ?? 0;
        const max = item.max ?? 100;
        const sliderWidth = 14;
        const filled = Math.round(((value - min) / (max - min)) * sliderWidth);
        const bar = fg('primary', '─'.repeat(filled) + '●' + '─'.repeat(sliderWidth - filled - 1));
        const unit = item.unit ?? '';
        control = `${bar} ${boldFg('text', String(value))}${dimFg('textMuted', unit)}`;
        break;
      }
      case 'select': {
        const opts = item.options ?? [];
        const selected = opts.find((o) => o.value === item.value);
        const displayValue = (selected?.label ?? String(item.value)).padEnd(12).slice(0, 12);
        control = fg('textMuted', '[') + fg('primary', displayValue) + fg('textMuted', ' ▾]');
        break;
      }
      case 'multiselect': {
        const values = (item.value as string[]) ?? [];
        const opts = item.options ?? [];
        const display = opts.slice(0, 3).map((o) =>
          values.includes(o.value) ? fg('success', `☑${o.label}`) : dimFg('textMuted', `☐${o.label}`)
        ).join(' ');
        control = display;
        break;
      }
      case 'text':
      case 'number': {
        const value = String(item.value ?? '');
        control = fg('textMuted', '[') + fg('text', value.padEnd(12).slice(0, 12)) + fg('textMuted', ']');
        break;
      }
    }

    const line = `  ${focusIndicator} ${modifiedMark} ${labelStr} ${control}`;
    return padRight(line, width);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRight(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo settings panel with common settings. */
export function createDemoSettings(): SettingsPanel {
  const panel = new SettingsPanel();

  panel.addSection('appearance', 'Appearance');
  panel.addSection('editor', 'Editor');
  panel.addSection('terminal', 'Terminal');

  panel.addItem({
    id: 'theme', label: 'Theme', type: 'select', section: 'appearance',
    value: 'dark', defaultValue: 'dark',
    options: [
      { label: 'Dark', value: 'dark' },
      { label: 'Light', value: 'light' },
      { label: 'Solarized', value: 'solarized' },
      { label: 'Dracula', value: 'dracula' },
    ],
  });

  panel.addItem({
    id: 'fontSize', label: 'Font Size', type: 'slider', section: 'appearance',
    value: 14, defaultValue: 14, min: 8, max: 32, step: 1, unit: 'px',
    description: 'Terminal font size in pixels',
  });

  panel.addItem({
    id: 'ligatures', label: 'Ligatures', type: 'toggle', section: 'appearance',
    value: true, defaultValue: true,
    enabledLabel: 'Enabled', disabledLabel: 'Disabled',
  });

  panel.addItem({
    id: 'tabSize', label: 'Tab Size', type: 'select', section: 'editor',
    value: '2', defaultValue: '2',
    options: [
      { label: '2 spaces', value: '2' },
      { label: '4 spaces', value: '4' },
      { label: 'Tab', value: 'tab' },
    ],
  });

  panel.addItem({
    id: 'autoSave', label: 'Auto Save', type: 'toggle', section: 'editor',
    value: true, defaultValue: true,
    enabledLabel: 'On focus loss', disabledLabel: 'Manual only',
  });

  panel.addItem({
    id: 'wordWrap', label: 'Word Wrap', type: 'toggle', section: 'editor',
    value: false, defaultValue: false,
    enabledLabel: 'Enabled', disabledLabel: 'Disabled',
  });

  panel.addItem({
    id: 'scrollback', label: 'Scrollback', type: 'slider', section: 'terminal',
    value: 1000, defaultValue: 1000, min: 100, max: 10000, step: 100, unit: ' lines',
    description: 'Number of lines to keep in scrollback buffer',
  });

  panel.addItem({
    id: 'bellStyle', label: 'Bell Style', type: 'select', section: 'terminal',
    value: 'visual', defaultValue: 'visual',
    options: [
      { label: 'Visual', value: 'visual' },
      { label: 'Audio', value: 'audio' },
      { label: 'None', value: 'none' },
    ],
  });

  return panel;
}
