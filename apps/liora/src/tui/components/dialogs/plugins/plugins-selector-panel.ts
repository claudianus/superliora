import {Container, Key, matchesKey, renderRendererPanelChromeRows, type Focusable} from '#/tui/renderer';
import type { PluginSummary } from '@superliora/sdk';
import chalk from 'chalk';

import {renderSelectPointer} from '#/tui/utils/ui/select-pointer';
import {currentTheme} from '#/tui/theme';
import {printableChar} from '#/tui/utils/printable-key';
import {renderTabStrip} from '#/tui/utils/ui/tab-strip';
import {computeUpdateStatus, type PluginMarketplaceEntry} from '#/utils/plugin-marketplace';

import {Input} from '../shared/input';
import {
  ELLIPSIS,
  mutedHintLine,
  renderUrlInputBox,
  statusStyle,
  wrapOverviewDescription,
} from './plugins-selector-shared';
import {
  marketplaceEntryDescription,
  marketplaceEntryStatus,
  marketplaceStatusStyle,
  overviewPluginDescription,
  pluginStatus,
} from './plugins-selector-marketplace';

export type PluginsPanelTabId = 'installed' | 'official' | 'third-party' | 'custom';

export type PluginsPanelSelection =
  | { readonly kind: 'toggle'; readonly id: string; readonly enabled: boolean }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'mcp'; readonly id: string }
  | { readonly kind: 'details'; readonly id: string }
  | { readonly kind: 'reload' }
  | { readonly kind: 'install'; readonly entry: PluginMarketplaceEntry }
  | { readonly kind: 'install-source'; readonly source: string };

export interface PluginsPanelOptions {
  readonly installed: readonly PluginSummary[];
  readonly installedIds: ReadonlySet<string>;
  readonly initialTab?: PluginsPanelTabId;
  readonly selectedId?: string;
  readonly pluginHint?: { readonly id: string; readonly text: string };
  readonly onSelect: (selection: PluginsPanelSelection) => void;
  readonly onCancel: () => void;
  /** Called the first time the Official or Third-party tab needs its catalog.
   * The host fetches the marketplace and calls setMarketplace / setMarketplaceError. */
  readonly onRequestMarketplace?: () => void;
}

type MarketState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'loaded'; readonly entries: readonly PluginMarketplaceEntry[]; readonly source: string };

const PLUGINS_PANEL_TABS: readonly { id: PluginsPanelTabId; label: string }[] = [
  { id: 'installed', label: 'Installed' },
  { id: 'official', label: 'Official' },
  { id: 'third-party', label: 'Third-party' },
  { id: 'custom', label: 'Custom' },
];

export class PluginsPanelComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: PluginsPanelOptions;
  private readonly customInput = new Input();
  private activeTabIndex: number;
  private selectedIndex = 0;
  private market: MarketState = { status: 'idle' };
  private installing: string | undefined;

  constructor(opts: PluginsPanelOptions) {
    super();
    this.opts = opts;
    this.activeTabIndex = Math.max(
      0,
      PLUGINS_PANEL_TABS.findIndex((tab) => tab.id === (opts.initialTab ?? 'installed')),
    );
    if (opts.selectedId !== undefined && this.activeTab.id === 'installed') {
      const idx = opts.installed.findIndex((p) => p.id === opts.selectedId);
      if (idx >= 0) this.selectedIndex = idx;
    }
    this.customInput.onSubmit = (value) => {
      const source = value.trim();
      if (source.length > 0) this.opts.onSelect({ kind: 'install-source', source });
    };
  }

  marketplaceStatus(): MarketState['status'] {
    return this.market.status;
  }

  setMarketplaceLoading(): void {
    this.market = { status: 'loading' };
  }

  setMarketplace(entries: readonly PluginMarketplaceEntry[], source: string): void {
    this.market = { status: 'loaded', entries, source };
  }

  setMarketplaceError(message: string): void {
    this.market = { status: 'error', message };
  }

  setInstalling(label: string): void {
    this.installing = label;
    this.invalidate();
  }

  clearInstalling(): void {
    this.installing = undefined;
    this.invalidate();
  }

  private get activeTab(): (typeof PLUGINS_PANEL_TABS)[number] {
    return PLUGINS_PANEL_TABS[this.activeTabIndex]!;
  }

  private get marketplaceEntries(): readonly PluginMarketplaceEntry[] {
    if (this.market.status !== 'loaded') return [];
    const { installedIds } = this.opts;
    return this.market.entries.toSorted(
      (a, b) => Number(installedIds.has(b.id)) - Number(installedIds.has(a.id)),
    );
  }

  private get installedVersions(): ReadonlyMap<string, string | undefined> {
    return new Map(this.opts.installed.map((plugin) => [plugin.id, plugin.version]));
  }

  private get officialEntries(): readonly PluginMarketplaceEntry[] {
    return this.marketplaceEntries.filter((entry) => entry.tier === 'official');
  }

  private get thirdPartyEntries(): readonly PluginMarketplaceEntry[] {
    // Anything not explicitly marked official lands here: `curated` entries plus
    // entries that omit `tier` (custom marketplaces often do). Without this,
    // untiered entries would be invisible in both marketplace tabs.
    return this.marketplaceEntries.filter((entry) => entry.tier !== 'official');
  }

  private requestMarketplaceIfNeeded(): void {
    // The Installed tab also needs the catalog to render update badges; only the
    // Custom tab (manual URL entry) can skip the fetch entirely.
    if (this.market.status === 'idle' && this.activeTab.id !== 'custom') {
      this.market = { status: 'loading' };
      this.opts.onRequestMarketplace?.();
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.activeTabIndex = (this.activeTabIndex + 1) % PLUGINS_PANEL_TABS.length;
      this.selectedIndex = 0;
      this.requestMarketplaceIfNeeded();
      return;
    }
    if (matchesKey(data, Key.shift('tab'))) {
      this.activeTabIndex =
        (this.activeTabIndex - 1 + PLUGINS_PANEL_TABS.length) % PLUGINS_PANEL_TABS.length;
      this.selectedIndex = 0;
      this.requestMarketplaceIfNeeded();
      return;
    }
    switch (this.activeTab.id) {
      case 'installed':
        this.handleInstalledInput(data);
        return;
      case 'official':
      case 'third-party':
        this.handleMarketplaceInput(data);
        return;
      case 'custom':
        this.customInput.handleInput(data);
        return;
    }
  }

  private handleInstalledInput(data: string): void {
    const plugins = this.opts.installed;
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(plugins.length - 1, this.selectedIndex + 1);
      return;
    }
    const plugin = plugins[this.selectedIndex];
    const ch = printableChar(data);
    // Decode Space for terminals that send printable keys via Kitty/CSI-u
    // sequences (e.g. VS Code's integrated terminal); `matchesKey(Key.space)`
    // alone misses those and the toggle silently stops working.
    if (matchesKey(data, Key.space) || ch === ' ') {
      if (plugin !== undefined) {
        this.opts.onSelect({ kind: 'toggle', id: plugin.id, enabled: !plugin.enabled });
      }
      return;
    }
    if (ch === 'd' || ch === 'D') {
      if (plugin !== undefined) this.opts.onSelect({ kind: 'remove', id: plugin.id });
      return;
    }
    if (ch === 'm' || ch === 'M') {
      if (plugin !== undefined) this.opts.onSelect({ kind: 'mcp', id: plugin.id });
      return;
    }
    if (ch === 'r' || ch === 'R') {
      this.opts.onSelect({ kind: 'reload' });
      return;
    }
    if (matchesKey(data, Key.enter)) {
      if (plugin === undefined) return;
      const update = this.installedUpdateStatus(plugin);
      if (update !== undefined) {
        this.opts.onSelect({ kind: 'install', entry: update.entry });
      } else {
        this.opts.onSelect({ kind: 'details', id: plugin.id });
      }
      return;
    }
    if (ch === 'i' || ch === 'I') {
      if (plugin !== undefined) this.opts.onSelect({ kind: 'details', id: plugin.id });
    }
  }

  private handleMarketplaceInput(data: string): void {
    const entries = this.activeTab.id === 'official' ? this.officialEntries : this.thirdPartyEntries;
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      // Clamp to 0 while the catalog is still loading (entries empty); otherwise
      // `entries.length - 1` is -1 and a later Enter reads `entries[-1]`.
      this.selectedIndex = entries.length === 0 ? 0 : Math.min(entries.length - 1, this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const entry = entries[this.selectedIndex];
      if (entry === undefined) return;
      this.opts.onSelect({ kind: 'install', entry });
    }
  }

  override invalidate(): void {
    super.invalidate();
    this.customInput.invalidate();
  }

  override render(width: number): string[] {
    if (this.installing !== undefined) {
      return this.renderInstalling(width);
    }
    const colors = currentTheme.palette;
    const tab = this.activeTab.id;
    const hint =
      tab === 'installed'
        ? this.installedHint()
        : tab === 'custom'
          ? ' Tab switch · Enter install · Esc cancel'
          : ' Tab switch · ↑↓ navigate · Enter open/install · Esc cancel';
    const body = [
      renderTabStrip({
        labels: PLUGINS_PANEL_TABS.map((t) => t.label),
        activeIndex: this.activeTabIndex,
        width,
        colors,
      }),
      '',
    ];

    if (tab === 'installed') this.renderInstalled(body, width);
    else if (tab === 'official') this.renderOfficial(body, width);
    else if (tab === 'third-party') this.renderThirdParty(body, width);
    else this.renderCustom(body, width);

    return renderRendererPanelChromeRows({
      width,
      title: ' Plugins',
      hint,
      body,
      footerTopGap: false,
      dividerStyle: (text) => chalk.hex(colors.primary)(text),
      titleStyle: (text) => chalk.hex(colors.primary).bold(text),
      hintStyle: (text) => mutedHintLine(text, colors),
      ellipsis: ELLIPSIS,
    });
  }

  private renderInstalled(lines: string[], width: number): void {
    const { installed } = this.opts;
    const colors = currentTheme.palette;
    if (installed.length === 0) {
      lines.push(chalk.hex(colors.textMuted)('  No plugins installed.'));
    } else {
      for (let i = 0; i < installed.length; i++) {
        lines.push(...this.renderInstalledRow(installed[i]!, i, width));
      }
    }
    lines.push('');
    lines.push(mutedHintLine(` ${installed.length} installed`, colors));
  }

  private installedHint(): string {
    const plugin = this.opts.installed[this.selectedIndex];
    const hasUpdate = plugin !== undefined && this.installedUpdateStatus(plugin) !== undefined;
    const enter = hasUpdate ? 'Enter update' : 'Enter details';
    return ` Tab switch · Space toggle · D remove · M MCP · ${enter} · I details · R reload · Esc cancel`;
  }

  private installedUpdateStatus(
    plugin: PluginSummary,
  ): { entry: PluginMarketplaceEntry; local: string; latest: string } | undefined {
    if (this.market.status !== 'loaded') return undefined;
    const entry = this.market.entries.find((e) => e.id === plugin.id);
    if (entry === undefined) return undefined;
    const status = computeUpdateStatus(entry.version, plugin.version, true);
    return status.kind === 'update' ? { entry, local: status.local, latest: status.latest } : undefined;
  }

  private renderInstalledRow(plugin: PluginSummary, index: number, width: number): string[] {
    const colors = currentTheme.palette;
    const selected = index === this.selectedIndex;
    const pointer = selected ? renderSelectPointer('plugins:pointer') : ' ';
    const labelStyle = selected ? chalk.hex(colors.primary).bold : chalk.hex(colors.text);
    // Pointer is already ambient-styled; do not wrap it in chalk again.
    const tone = selected ? colors.primary : colors.textDim;
    const prefix = chalk.hex(tone)('  ') + pointer + chalk.hex(tone)(' ');
    const status = pluginStatus(plugin);
    const update = this.installedUpdateStatus(plugin);
    let line = prefix + labelStyle(plugin.displayName);
    if (status !== undefined) {
      line += '  ' + statusStyle({ kind: 'plugin', value: '', label: '', description: '', status }, colors)(status);
    }
    if (update !== undefined) {
      const badge = `update ${update.local} → ${update.latest}`;
      line += '  ' + marketplaceStatusStyle(badge, colors)(badge);
    }
    if (this.opts.pluginHint?.id === plugin.id) {
      line += '  ' + chalk.hex(colors.warning)(this.opts.pluginHint.text);
    }
    const descWidth = Math.max(1, width - 4);
    const out = [line];
    for (const descLine of wrapOverviewDescription(overviewPluginDescription(plugin), descWidth)) {
      out.push(mutedHintLine(`    ${descLine}`, colors));
    }
    return out;
  }

  private renderMarketplaceTab(
    lines: string[],
    width: number,
    entries: readonly PluginMarketplaceEntry[],
  ): void {
    const colors = currentTheme.palette;
    if (this.market.status === 'loading' || this.market.status === 'idle') {
      lines.push(chalk.hex(colors.textMuted)('  Loading marketplace…'));
      return;
    }
    if (this.market.status === 'error') {
      lines.push(chalk.hex(colors.warning)(`  Marketplace unavailable: ${this.market.message}`));
      lines.push(mutedHintLine('  Use the Custom tab to install from a URL.', colors));
      return;
    }
    if (entries.length === 0) {
      lines.push(chalk.hex(colors.textMuted)('  No plugins found.'));
    } else {
      for (let i = 0; i < entries.length; i++) {
        lines.push(...this.renderMarketplaceRow(entries[i]!, i, width));
      }
    }
    const installedCount = entries.filter((e) => this.opts.installedIds.has(e.id)).length;
    lines.push('');
    lines.push(
      mutedHintLine(` ${installedCount} installed · ${entries.length - installedCount} available`, colors),
    );
    lines.push(mutedHintLine(` Source: ${this.market.source}`, colors));
  }

  private renderOfficial(lines: string[], width: number): void {
    this.renderMarketplaceTab(lines, width, this.officialEntries);
  }

  private renderThirdParty(lines: string[], width: number): void {
    this.renderMarketplaceTab(lines, width, this.thirdPartyEntries);
  }

  private renderMarketplaceRow(entry: PluginMarketplaceEntry, index: number, width: number): string[] {
    const colors = currentTheme.palette;
    const selected = index === this.selectedIndex;
    const pointer = selected ? renderSelectPointer('plugins:pointer') : ' ';
    const labelStyle = selected ? chalk.hex(colors.primary).bold : chalk.hex(colors.text);
    // Pointer is already ambient-styled; do not wrap it in chalk again.
    const tone = selected ? colors.primary : colors.textDim;
    const prefix = chalk.hex(tone)('  ') + pointer + chalk.hex(tone)(' ');
    const status = marketplaceEntryStatus(entry, this.installedVersions);
    const line =
      prefix + labelStyle(entry.displayName) + '  ' + marketplaceStatusStyle(status, colors)(status);
    const descWidth = Math.max(1, width - 4);
    const out = [line];
    for (const descLine of wrapOverviewDescription(marketplaceEntryDescription(entry), descWidth)) {
      out.push(mutedHintLine(`    ${descLine}`, colors));
    }
    return out;
  }

  private renderCustom(lines: string[], width: number): void {
    const colors = currentTheme.palette;
    lines.push(mutedHintLine(' Install from a GitHub URL (or zip URL / local path):', colors));
    lines.push('');
    lines.push(...renderUrlInputBox(this.customInput, this.focused, width, colors));
  }

  private renderInstalling(width: number): string[] {
    const colors = currentTheme.palette;
    return renderRendererPanelChromeRows({
      width,
      title: ' Plugins',
      body: [chalk.hex(colors.textMuted)(`  Installing ${this.installing} from marketplace…`)],
      dividerStyle: (text) => chalk.hex(colors.primary)(text),
      titleStyle: (text) => chalk.hex(colors.primary).bold(text),
      ellipsis: ELLIPSIS,
    });
  }
}
