/**
 * ProviderManagerComponent — pure-view CRUD UI for the `/provider` command.
 *
 * Single-column layout showing one row per "platform / source":
 *   - each Open Platform login (1 source = 1 provider)
 *   - each Custom Registry connection grouping by `{url, apiKey}`
 *     (1 source = N providers from the same api.json fetch)
 *   - any other configured provider (1 source = 1 provider)
 *   - a synthetic final `[ Add New Platform ]` action row
 * Kimi Managed OAuth (`DEFAULT_OAUTH_PROVIDER_NAME`) is intentionally hidden
 * — that account is managed through `/login` / `/logout`, not here.
 *
 * Keyboard:
 *   - ↑ / ↓             move highlight
 *   - ← / → · PgUp/PgDn page
 *   - Enter             on `[ Add New Platform ]` → `onAdd()`
 *   - A                 add an API key to the highlighted provider/source
 *   - R                 remove the newest API key from the highlighted provider/source
 *   - D                 delete with inline `[y/N]` confirmation
 *                         on a source row → `onDeleteSource(providerIds)`
 *                         on `[ Add New Platform ]` → ignored
 *   - Esc               `onClose()` (outside confirm)
 *
 * The `[y/N]` confirmation is a transient substate handled in-component:
 * while armed, only `y` / `Y` / `n` / `N` / `Esc` are honored and the
 * prompt replaces the footer hint.
 *
 * The component is pure-view: every CRUD side effect is dispatched back
 * through callbacks. The host (`LioraTui`) is responsible for performing
 * the harness / config mutations and then pushing a fresh snapshot via
 * `setOptions`.
 */

import type { ProviderConfig } from '@superliora/sdk';
import {
  getOpenPlatformById,
  isOpenPlatformId,
  type CustomRegistrySource,
} from '@superliora/oauth';
import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';

import { DEFAULT_OAUTH_PROVIDER_NAME } from '#/constant/app';
import { CURRENT_MARK, SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { pageView, type PageView } from '#/tui/utils/paging';

interface ConfirmState {
  readonly label: string;
  readonly providerIds: readonly string[];
}

export interface ProviderManagerOptions {
  /** All currently configured providers (`config.providers`). */
  readonly providers: Record<string, ProviderConfig>;
  /** Provider id of the currently active model. */
  readonly activeProviderId?: string;
  readonly onAdd: () => void;
  readonly onAddApiKey: (providerIds: readonly string[]) => void;
  readonly onRemoveApiKey: (providerIds: readonly string[]) => void;
  /** Delete all providers under a source (Open Platform / custom-registry
   *  fetch / standalone). Passed the full provider-id list so the host
   *  doesn't have to re-derive the source grouping. */
  readonly onDeleteSource: (providerIds: readonly string[]) => void;
  readonly onClose: () => void;
}

/** Real (non-synthetic) source row. */
interface SourceRow {
  readonly kind: 'source';
  readonly id: string;
  readonly label: string;
  readonly providerIds: readonly string[];
  /** True when one of `providerIds` is the active provider. */
  readonly hasActive: boolean;
  /** Optional base URL extracted from the provider config. */
  readonly baseUrl?: string;
  /** Number of configured API keys, without exposing secret values. */
  readonly apiKeyCount: number;
  /** Short credential summary, without exposing secret values or OAuth storage keys. */
  readonly credentialSummary: string;
}

/** Synthetic `[ Add New Platform ]` action row pinned to the bottom. */
interface AddRow {
  readonly kind: 'add';
  readonly id: '__add__';
  readonly label: string;
}

type Row = SourceRow | AddRow;

const ADD_ROW_LABEL = '[ Add New Platform ]';
const PAGE_SIZE = 8;
const HEADER_HINT = '↑↓ navigate · A add key · R remove key · D delete · Esc cancel';

// Narrows a `ProviderConfig` blob to a `CustomRegistrySource` payload.
// Mirrors `readCustomRegistrySource` in `liora-tui.ts`. We can't import
// that helper because it lives in the host and would create a cyclic
// dependency on the component's container; duplicating ~15 lines is cheap.
function readCustomRegistrySource(provider: unknown): CustomRegistrySource | undefined {
  if (typeof provider !== 'object' || provider === null) return undefined;
  const source = (provider as { readonly source?: unknown }).source;
  if (typeof source !== 'object' || source === null) return undefined;
  const candidate = source as {
    readonly kind?: unknown;
    readonly url?: unknown;
    readonly apiKey?: unknown;
  };
  if (candidate.kind !== 'apiJson') return undefined;
  if (typeof candidate.url !== 'string' || candidate.url.length === 0) return undefined;
  if (typeof candidate.apiKey !== 'string') return undefined;
  return { kind: 'apiJson', url: candidate.url, apiKey: candidate.apiKey };
}

/**
 * Pretty-print a URL for the source-row label. Strips the scheme and
 * truncates obvious api.json suffixes so the row stays narrow. Falls
 * back to the raw URL if parsing fails.
 */
function sourceUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

/**
 * Group providers into source rows + append the synthetic add-row.
 * The grouping rules:
 *   - `DEFAULT_OAUTH_PROVIDER_NAME` → skipped (managed via /logout).
 *   - Open Platform id (`isOpenPlatformId(id)`) → 1 source per provider,
 *     label = `OpenPlatformDefinition.name`.
 *   - `cfg.source.kind === 'apiJson'` → one source per `{url, apiKey}`
 *     pair, label = hostname + pathname.
 *   - Anything else → 1 source per provider, label = provider id.
 */
function buildRows(opts: ProviderManagerOptions): readonly Row[] {
  const sources: SourceRow[] = [];

  // Map from `${url}${apiKey}` → index into `sources`, so we can
  // append further providers into the same group.
  const customRegistryIndex = new Map<string, number>();

  for (const [id, cfg] of Object.entries(opts.providers)) {
    if (id === DEFAULT_OAUTH_PROVIDER_NAME) continue;

    const isActive = id === opts.activeProviderId;

    if (isOpenPlatformId(id)) {
      const platform = getOpenPlatformById(id);
      sources.push({
        kind: 'source',
        id: `open:${id}`,
        label: platform?.name ?? id,
        providerIds: [id],
        hasActive: isActive,
        apiKeyCount: providerApiKeyCount(cfg),
        credentialSummary: providerCredentialSummary(cfg),
      });
      continue;
    }

    const baseUrl =
      typeof cfg === 'object' && cfg !== null && 'baseUrl' in cfg && typeof cfg.baseUrl === 'string'
        ? cfg.baseUrl
        : undefined;

    const customSource = readCustomRegistrySource(cfg);
    if (customSource !== undefined) {
      const key = `${customSource.url}${customSource.apiKey}`;
      const existingIdx = customRegistryIndex.get(key);
      if (existingIdx !== undefined) {
        const existing = sources[existingIdx];
        if (existing !== undefined && existing.kind === 'source') {
          sources[existingIdx] = {
            kind: 'source',
            id: existing.id,
            label: existing.label,
            providerIds: [...existing.providerIds, id],
            hasActive: existing.hasActive || isActive,
            baseUrl: existing.baseUrl,
            apiKeyCount: Math.max(existing.apiKeyCount, providerApiKeyCount(cfg)),
            credentialSummary: groupedCredentialSummary(
              Math.max(existing.apiKeyCount, providerApiKeyCount(cfg)),
            ),
          };
        }
        continue;
      }
      customRegistryIndex.set(key, sources.length);
      sources.push({
        kind: 'source',
        id: `custom:${key}`,
        label: sourceUrlLabel(customSource.url),
        providerIds: [id],
        hasActive: isActive,
        baseUrl,
        apiKeyCount: providerApiKeyCount(cfg),
        credentialSummary: providerCredentialSummary(cfg),
      });
      continue;
    }

    sources.push({
      kind: 'source',
      id: `provider:${id}`,
      label: id,
      providerIds: [id],
      hasActive: isActive,
      baseUrl,
      apiKeyCount: providerApiKeyCount(cfg),
      credentialSummary: providerCredentialSummary(cfg),
    });
  }

  return [...sources, { kind: 'add', id: '__add__', label: ADD_ROW_LABEL }];
}

export class ProviderManagerComponent extends Container implements Focusable {
  focused = false;
  private opts: ProviderManagerOptions;
  private rows: readonly Row[];
  private selectedIndex: number;
  private confirm: ConfirmState | undefined;

  constructor(opts: ProviderManagerOptions) {
    super();
    this.opts = opts;
    this.rows = buildRows(opts);
    const activeIdx = opts.activeProviderId
      ? this.rows.findIndex(
          (row) => row.kind === 'source' && row.providerIds.includes(opts.activeProviderId ?? ''),
        )
      : -1;
    this.selectedIndex = Math.max(activeIdx, 0);
    this.confirm = undefined;
  }

  /**
   * Replace the props the component renders against. Existing selection
   * is preserved when possible (by id or first provider id) so deletions
   * don't visually jump. Any in-flight `[y/N]` substate is cleared because
   * the underlying target may have changed.
   */
  setOptions(next: ProviderManagerOptions): void {
    const previousSelected = this.rows[this.selectedIndex];
    const previousSelectedId = previousSelected?.id;
    const previousFirstProviderId =
      previousSelected?.kind === 'source' ? previousSelected.providerIds[0] : undefined;

    this.opts = next;
    this.rows = buildRows(next);
    this.confirm = undefined;

    let newIdx = -1;
    if (previousSelectedId !== undefined) {
      newIdx = this.rows.findIndex((row) => row.id === previousSelectedId);
    }
    if (newIdx < 0 && previousFirstProviderId !== undefined) {
      newIdx = this.rows.findIndex(
        (row) => row.kind === 'source' && row.providerIds.includes(previousFirstProviderId),
      );
    }
    if (newIdx < 0) {
      newIdx = Math.min(this.selectedIndex, Math.max(0, this.rows.length - 1));
    }
    this.selectedIndex = newIdx;
    this.invalidate();
  }

  /** Rows after applying the active fuzzy filter; the add-row is always kept. */
  private page(): PageView {
    return pageView(this.rows.length, this.selectedIndex, PAGE_SIZE);
  }

  handleInput(data: string): void {
    if (this.confirm !== undefined) {
      this.handleConfirmInput(data);
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.opts.onClose();
      return;
    }

    const rows = this.rows;

    if (matchesKey(data, Key.up)) {
      if (rows.length === 0) return;
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (rows.length === 0) return;
      this.selectedIndex = Math.min(rows.length - 1, this.selectedIndex + 1);
      this.invalidate();
      return;
    }

    if (matchesKey(data, Key.left) || matchesKey(data, Key.pageUp)) {
      if (rows.length === 0) return;
      this.selectedIndex = Math.max(0, this.selectedIndex - PAGE_SIZE);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.pageDown)) {
      if (rows.length === 0) return;
      this.selectedIndex = Math.min(rows.length - 1, this.selectedIndex + PAGE_SIZE);
      this.invalidate();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const selected = rows[this.selectedIndex];
      if (selected?.kind === 'add') {
        this.opts.onAdd();
      }
      return;
    }

    // Add an API key to the highlighted provider/source with the A key.
    const ch = printableChar(data);
    if (ch === 'a' || ch === 'A') {
      const selected = rows[this.selectedIndex];
      if (selected?.kind === 'source') {
        this.opts.onAddApiKey(selected.providerIds);
      }
      return;
    }

    if (ch === 'r' || ch === 'R') {
      const selected = rows[this.selectedIndex];
      if (selected?.kind === 'source') {
        this.opts.onRemoveApiKey(selected.providerIds);
      }
      return;
    }

    // Delete the highlighted provider with the D key.
    if (ch === 'd' || ch === 'D') {
      this.armDeleteConfirm();
    }
  }

  private armDeleteConfirm(): void {
    const selected = this.rows[this.selectedIndex];
    if (selected === undefined || selected.kind === 'add') return;
    const ids = selected.providerIds;
    const prompt =
      ids.length === 1
        ? `Delete platform "${selected.label}"?`
        : `Delete platform "${selected.label}" and all ${String(ids.length)} providers?`;
    this.confirm = {
      label: prompt,
      providerIds: ids,
    };
    this.invalidate();
  }

  private handleConfirmInput(data: string): void {
    const k = printableChar(data);
    if (matchesKey(data, Key.escape) || k === 'n' || k === 'N') {
      this.confirm = undefined;
      this.invalidate();
      return;
    }
    if (k === 'y' || k === 'Y') {
      const confirm = this.confirm;
      this.confirm = undefined;
      this.invalidate();
      if (confirm === undefined) return;
      this.opts.onDeleteSource(confirm.providerIds);
      return;
    }
    // Any other key while in the confirm substate is ignored.
  }

  override render(width: number): string[] {
    const body: string[] = [];

    const rows = this.rows;
    if (rows.length === 0) {
      body.push(currentTheme.fg('textMuted', '  No providers configured.'));
    } else {
      const view = this.page();
      for (let i = view.start; i < view.end; i++) {
        const row = rows[i];
        if (row === undefined) continue;
        for (const line of renderRow(row, { isSelected: i === this.selectedIndex, width })) {
          body.push(line);
        }
      }
    }

    body.push('');

    if (this.confirm !== undefined) {
      body.push(this.renderConfirmLine(width));
    } else {
      const view = this.page();
      if (view.pageCount > 1) {
        body.push(
          currentTheme.fg(
            'textMuted',
            ` Page ${String(view.page + 1)}/${String(view.pageCount)}`,
          ),
        );
      }
    }

    // Header shape mirrors the model dialog (see model-selector.ts): a single
    // top border, the title, the keymap hint, then a blank line. No inner
    // border under the title.
    return renderRendererPanelChromeRows({
      width,
      title: ' Providers',
      hint: ' ' + HEADER_HINT,
      body,
      footerTopGap: false,
      dividerStyle: (text) => currentTheme.fg('primary', text),
      titleStyle: (text) => currentTheme.boldFg('primary', text),
      hintStyle: (text) => currentTheme.fg('textMuted', text),
    });
  }

  private renderConfirmLine(width: number): string {
    const confirm = this.confirm;
    const prompt = confirm?.label ?? '';
    const styled = currentTheme.boldFg('warning', `  ${prompt} [y/N]`);
    return truncateToWidth(styled, width, '…');
  }
}

function providerApiKeyCount(provider: ProviderConfig): number {
  return providerApiKeyPreviews(provider).length;
}

function providerCredentialSummary(provider: ProviderConfig): string {
  const apiKeys = providerApiKeyPreviews(provider);
  const oauths = providerOAuthPreviews(provider);
  const parts: string[] = [];
  if (apiKeys.length > 0) {
    parts.push(`${apiKeys.length === 1 ? '1 key' : `${String(apiKeys.length)} keys`}: ${previewList(apiKeys)}`);
  }
  if (oauths.length > 0) {
    parts.push(
      `${oauths.length === 1 ? '1 OAuth account' : `${String(oauths.length)} OAuth accounts`}: ${previewList(oauths)}`,
    );
  }
  return parts.length === 0 ? 'no credentials' : parts.join(' · ');
}

function groupedCredentialSummary(apiKeyCount: number): string {
  return apiKeyCount === 1 ? '1 key' : `${String(apiKeyCount)} keys`;
}

function providerApiKeyPreviews(provider: ProviderConfig): string[] {
  const previews: string[] = [];
  const seen = new Set<string>();
  const pushPreview = (apiKey: string | undefined, preview: string, baseUrl: string | undefined) => {
    const trimmed = apiKey?.trim();
    if (trimmed === undefined || trimmed.length === 0) return;
    const slotId = `${trimmed}\n${baseUrl ?? provider.baseUrl ?? ''}`;
    if (seen.has(slotId)) return;
    seen.add(slotId);
    previews.push(preview);
  };

  const apiKey = provider.apiKey?.trim();
  pushPreview(apiKey, '#1', undefined);
  for (let index = 0; index < (provider.apiKeys ?? []).length; index += 1) {
    const key = provider.apiKeys?.[index]?.trim();
    pushPreview(key, `#${String(previews.length + 1)}`, undefined);
  }
  for (let index = 0; index < (provider.credentials ?? []).length; index += 1) {
    const credential = provider.credentials?.[index];
    const key = credential?.apiKey.trim();
    if (key === undefined || key.length === 0) continue;
    const label = credential?.label?.trim();
    const name = label === undefined || label.length === 0 ? `#${String(previews.length + 1)}` : label;
    const limits = [
      credential?.rpm === undefined ? undefined : `rpm=${String(credential.rpm)}`,
      credential?.tpm === undefined ? undefined : `tpm=${String(credential.tpm)}`,
    ].filter((part): part is string => part !== undefined);
    pushPreview(key, limits.length === 0 ? name : `${name} ${limits.join('/')}`, credential?.baseUrl);
  }
  return previews;
}

function providerOAuthPreviews(provider: ProviderConfig): string[] {
  const refs = [
    ...(provider.oauth === undefined ? [] : [provider.oauth]),
    ...(provider.oauths ?? []),
  ];
  const previews: string[] = [];
  for (let index = 0; index < refs.length; index += 1) {
    const label = refs[index]?.label?.trim();
    previews.push(label === undefined || label.length === 0 ? `#${String(index + 1)}` : label);
  }
  return previews;
}

function previewList(values: readonly string[]): string {
  if (values.length <= 3) return values.join(', ');
  return `${values.slice(0, 3).join(', ')} +${String(values.length - 3)}`;
}

function renderRow(
  row: Row,
  ctx: { isSelected: boolean; width: number },
): string[] {
  const { isSelected, width } = ctx;
  const pointer = isSelected ? SELECT_POINTER : ' ';
  const pointerStyle = (text: string) =>
    isSelected ? currentTheme.fg('primary', text) : currentTheme.fg('textDim', text);
  // The synthetic "Add New Platform" row is an action/CTA: keep it in the brand
  // color so it never reads as disabled, and bold it when selected (matching
  // the other rows' selected treatment).
  const labelStyle = (text: string) =>
    isSelected
      ? currentTheme.boldFg('primary', text)
      : row.kind === 'add'
        ? currentTheme.fg('primary', text)
        : currentTheme.fg('text', text);

  // The active provider is flagged with a trailing "← current" (success),
  // matching the model selector's current-item marker — see src/tui/PREMIUM.md § Selection language.
  const isActive = row.kind === 'source' && row.hasActive;
  const marker = isActive ? ` ${CURRENT_MARK}` : '';

  // Reserve 2 leading spaces + 2 for the pointer + room for the marker.
  const labelWidth = Math.max(0, width - 4 - visibleWidth(marker));
  const labelText = truncateToWidth(row.label, labelWidth, '…');
  let line = `  ${pointerStyle(`${pointer} `)}${labelStyle(labelText)}`;
  if (isActive) line += currentTheme.fg('success', marker);

  const lines: string[] = [line];

  if (row.kind === 'source' && row.baseUrl !== undefined && row.baseUrl.length > 0) {
    const urlText = truncateToWidth(row.baseUrl, Math.max(0, width - 6), '…');
    lines.push(currentTheme.fg('textMuted', `      ${urlText}`));
  }
  if (row.kind === 'source') {
    lines.push(currentTheme.fg('textMuted', `      ${row.credentialSummary}`));
  }

  return lines;
}
