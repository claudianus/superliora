/**
 * CustomModelInputDialog — lets user add an arbitrary model id to any provider.
 *
 * Covers the "hidden / just-released" case: models.dev / provider /models
 * endpoints may be stale for days after a frontier release. Users can still
 * type the exact wire id and use it immediately. The entry is persisted to
 * `~/.superliora/config.toml` as `models["<provider>/<model>"]` so refresh
 * diffs treat it as a user alias (preserved unless the refresh learns it).
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererFrameRows,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';

import {
  DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE,
  lookupModelCapability,
  probeModelsEndpoint,
} from '#/utils/custom-provider';
import type { Catalog } from '@superliora/sdk';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { Input } from '../shared/input';

export interface CustomModelInputValue {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName?: string;
  readonly maxContextSize: number;
  readonly thinking: boolean;
  readonly supportEfforts?: readonly string[];
}

export type CustomModelInputResult =
  | { readonly kind: 'ok'; readonly value: CustomModelInputValue }
  | { readonly kind: 'cancel' };

const TITLE = 'Add custom model';
const SUBTITLE_DEFAULT =
  'Add any model ID for an existing provider — use when models.dev / /models has not synced a new release yet.';
const FOOTER_NOT_LAST = 'Tab / ↑↓ to switch  ·  Enter next field  ·  Esc cancel';
const FOOTER_TOGGLE = '←→ / Space toggle  ·  Tab / ↑↓ switch  ·  Enter next  ·  Esc cancel';
const FOOTER_LAST = 'Tab / ↑↓ to switch  ·  Enter to add model  ·  Esc cancel';

type TextFieldId = 'provider' | 'model' | 'displayName' | 'context';
type FieldId = TextFieldId | 'thinking';

const FIELD_ORDER: readonly FieldId[] = ['provider', 'model', 'displayName', 'context', 'thinking'];

export class CustomModelInputDialogComponent extends Container implements Focusable {
  focused = false;

  onModelHintRequest?: (info: { providerId: string; modelId: string; baseUrl?: string }) => void;

  private readonly providerInput = new Input();
  private readonly modelInput = new Input();
  private readonly displayNameInput = new Input();
  private readonly contextInput = new Input();
  private readonly onDone: (result: CustomModelInputResult) => void;

  private activeField: FieldId = 'provider';
  private thinkingEnabled = false;
  private thinkingAutoDetected = false;
  private supportEfforts: readonly string[] | undefined;
  private done = false;
  private hint: string = SUBTITLE_DEFAULT;
  private catalogPromise: Promise<Catalog | undefined> | undefined;

  constructor(
    onDone: (result: CustomModelInputResult) => void,
    options?: {
      readonly initialProviderId?: string;
      readonly initialModelId?: string;
      readonly catalogPromise?: Promise<Catalog | undefined>;
      readonly availableProviders?: readonly string[];
    },
  ) {
    super();
    this.onDone = onDone;
    this.catalogPromise = options?.catalogPromise;
    if (options?.initialProviderId !== undefined && options.initialProviderId.length > 0) {
      this.providerInput.setValue(options.initialProviderId);
      this.activeField = 'model';
    }
    if (options?.initialModelId !== undefined && options.initialModelId.length > 0) {
      this.modelInput.setValue(options.initialModelId);
    }
    this.contextInput.setValue(String(DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE));
    for (const field of FIELD_ORDER) {
      if (field === 'thinking') continue;
      this.inputFor(field).onSubmit = () => {
        this.focusField(this.nextField(field));
      };
    }
    if (options?.availableProviders !== undefined && options.availableProviders.length > 0) {
      const list = options.availableProviders.join(', ');
      this.hint = `${SUBTITLE_DEFAULT}  Providers: ${list}`;
    }
  }

  setThinkingDefault(enabled: boolean, supportEfforts?: readonly string[]): void {
    this.thinkingEnabled = enabled;
    this.thinkingAutoDetected = enabled;
    this.supportEfforts =
      supportEfforts !== undefined && supportEfforts.length > 0 ? [...supportEfforts] : undefined;
    this.invalidate();
  }

  handleInput(data: string): void {
    if (this.done) return;
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl('c')) ||
      matchesKey(data, Key.ctrl('d'))
    ) {
      this.cancel();
      return;
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift('tab'))) {
      this.focusField(this.nextField(this.activeField));
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.focusField(this.nextField(this.activeField));
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.focusField(this.previousField(this.activeField));
      return;
    }

    if (this.activeField === 'thinking') {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || printableChar(data) === ' ') {
        this.thinkingEnabled = !this.thinkingEnabled;
        return;
      }
      if (matchesKey(data, Key.enter)) {
        this.handleSubmit();
        return;
      }
      return;
    }

    this.hint = SUBTITLE_DEFAULT;
    this.inputFor(this.activeField).handleInput(data);

    const leavingModel = this.activeField === 'model';
    if (leavingModel && matchesKey(data, Key.enter)) {
      // Trigger catalog hint async but don't block focus move (onSubmit already moved)
    }
  }

  override invalidate(): void {
    super.invalidate();
    for (const field of FIELD_ORDER) {
      if (field === 'thinking') continue;
      this.inputFor(field).invalidate();
    }
  }

  override render(width: number): string[] {
    const dialogActive = this.focused && !this.done;
    for (const field of FIELD_ORDER) {
      if (field === 'thinking') continue;
      this.inputFor(field).focused = dialogActive && this.activeField === field;
    }

    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    const innerWidth = Math.max(1, safeWidth - 4);
    const border = (s: string): string => currentTheme.fg('primary', s);
    const footer =
      this.activeField === 'thinking'
        ? FOOTER_TOGGLE
        : this.activeField === 'context'
          ? FOOTER_LAST
          : FOOTER_NOT_LAST;

    const contentLines: string[] = [
      truncateToWidth(currentTheme.boldFg('textStrong', TITLE), innerWidth, '…'),
      '',
      truncateToWidth(currentTheme.fg('textDim', this.hint), innerWidth, '…'),
      '',
      ...this.renderField('provider', 'Provider id  (e.g. anthropic, openai, xai-grok)', innerWidth),
      ...this.renderField('model', 'Model id  (wire id, e.g. claude-opus-4-7, gpt-5.4)', innerWidth),
      ...this.renderField('displayName', 'Display name  (optional)', innerWidth),
      ...this.renderField('context', 'Context tokens', innerWidth),
      ...this.renderThinkingField(innerWidth),
      truncateToWidth(currentTheme.fg('textDim', footer), innerWidth, '…'),
    ];

    if (safeWidth < 4) {
      return ['', ...contentLines.map((line) => truncateToWidth(line, safeWidth, '…'))];
    }

    return [
      '',
      ...renderRendererFrameRows({
        content: ['', ...contentLines, ''],
        width: safeWidth,
        height: contentLines.length + 4,
        borderKind: 'rounded',
        paddingLeft: 2,
        paddingRight: 0,
        borderStyle: border,
        ellipsis: '…',
      }),
      '',
    ];
  }

  private renderField(field: TextFieldId, label: string, width: number): string[] {
    const labelLine =
      this.activeField === field
        ? currentTheme.boldFg('accent', label)
        : currentTheme.fg('textDim', label);
    const inputLine = this.inputFor(field).render(width)[0] ?? '> ';
    return [
      truncateToWidth(labelLine, width, '…'),
      inputLine,
      '',
    ];
  }

  private renderThinkingField(width: number): string[] {
    const active = this.activeField === 'thinking';
    const autoTag = this.thinkingAutoDetected ? ' (auto)' : '';
    const labelLine = active
      ? currentTheme.boldFg('accent', `Thinking (reasoning)${autoTag}`)
      : currentTheme.fg('textDim', `Thinking (reasoning)${autoTag}`);
    const yes = this.thinkingEnabled
      ? currentTheme.boldFg('primary', '[ Yes ]')
      : currentTheme.fg('text', '  Yes  ');
    const no = this.thinkingEnabled
      ? currentTheme.fg('text', '  No  ')
      : currentTheme.boldFg('primary', '[ No ]');
    const value = active ? `${yes} ${no}  (←→)` : `${yes} ${no}`;
    return [truncateToWidth(labelLine, width, '…'), truncateToWidth(value, width, '…'), ''];
  }

  private handleSubmit(): void {
    if (this.done) return;
    const providerId = this.providerInput.getValue().trim();
    const modelId = this.modelInput.getValue().trim();
    const displayNameRaw = this.displayNameInput.getValue().trim();
    const contextRaw = this.contextInput.getValue().trim();

    if (providerId.length === 0) {
      this.reject('Provider id is required.', 'provider');
      return;
    }
    if (/\s/.test(providerId)) {
      this.reject('Provider id cannot contain whitespace.', 'provider');
      return;
    }
    if (modelId.length === 0) {
      this.reject('Model id is required.', 'model');
      return;
    }
    const maxContextSize = Number(contextRaw);
    if (!Number.isInteger(maxContextSize) || maxContextSize <= 0) {
      this.reject('Context tokens must be a positive integer.', 'context');
      return;
    }

    this.done = true;
    this.onDone({
      kind: 'ok',
      value: {
        providerId,
        modelId,
        displayName: displayNameRaw.length > 0 ? displayNameRaw : undefined,
        maxContextSize,
        thinking: this.thinkingEnabled,
        ...(this.supportEfforts !== undefined ? { supportEfforts: this.supportEfforts } : {}),
      },
    });
  }

  private reject(hint: string, field: FieldId): void {
    this.hint = hint;
    this.activeField = field;
  }

  private focusField(field: FieldId): void {
    const leaving = this.activeField;
    this.hint = SUBTITLE_DEFAULT;
    this.activeField = field;
    if (
      (leaving === 'model' || leaving === 'provider') &&
      field !== leaving &&
      this.onModelHintRequest !== undefined
    ) {
      const modelId = this.modelInput.getValue().trim();
      const providerId = this.providerInput.getValue().trim();
      if (modelId.length > 0 && providerId.length > 0) {
        // Fire async catalog / probe lookup
        void this.requestHint(providerId, modelId);
      }
    }
  }

  private async requestHint(providerId: string, modelId: string): Promise<void> {
    if (this.catalogPromise !== undefined) {
      try {
        const catalog = await this.catalogPromise;
        if (catalog !== undefined) {
          const hint = lookupModelCapability(catalog, providerId, modelId);
          if (hint !== undefined) {
            this.setThinkingDefault(hint.thinking, hint.supportEfforts);
            return;
          }
        }
      } catch {
        // ignore
      }
    }
    if (this.onModelHintRequest !== undefined) {
      this.onModelHintRequest({ providerId, modelId });
    } else {
      // Fallback probe when no host handler wired
      try {
        const probed = await probeModelsEndpoint('', undefined, modelId);
        if (probed !== undefined) this.setThinkingDefault(probed.thinking, probed.supportEfforts);
      } catch {
        // ignore
      }
    }
  }

  private cancel(): void {
    if (this.done) return;
    this.done = true;
    this.onDone({ kind: 'cancel' });
  }

  private inputFor(field: TextFieldId): Input {
    switch (field) {
      case 'provider':
        return this.providerInput;
      case 'model':
        return this.modelInput;
      case 'displayName':
        return this.displayNameInput;
      case 'context':
        return this.contextInput;
    }
  }

  private nextField(field: FieldId): FieldId {
    const index = FIELD_ORDER.indexOf(field);
    return FIELD_ORDER[(index + 1) % FIELD_ORDER.length] ?? 'provider';
  }

  private previousField(field: FieldId): FieldId {
    const index = FIELD_ORDER.indexOf(field);
    return FIELD_ORDER[(index - 1 + FIELD_ORDER.length) % FIELD_ORDER.length] ?? 'context';
  }
}
