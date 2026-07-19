/**
 * CustomEndpointImportDialog — collects a direct HTTP endpoint, wire type,
 * model id, optional API key, and context window for `/login`.
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
  inferCustomEndpointFromUrl,
} from '#/utils/custom-provider';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { Input } from './input';

/** Wire types offered by `/login` custom endpoint (matches `liora provider custom add --type`). */
export const CUSTOM_ENDPOINT_WIRE_TYPES = [
  'openai',
  'openai_responses',
  'anthropic',
  'kimi',
  'google-genai',
  'vertexai',
] as const;

export type CustomEndpointWireType = (typeof CUSTOM_ENDPOINT_WIRE_TYPES)[number];

function isCustomEndpointWireType(value: string): value is CustomEndpointWireType {
  return (CUSTOM_ENDPOINT_WIRE_TYPES as readonly string[]).includes(value);
}

export interface CustomEndpointImportValue {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly providerType: CustomEndpointWireType;
  readonly modelId: string;
  readonly apiKey?: string;
  readonly maxContextSize: number;
  readonly thinking: boolean;
}

export type CustomEndpointImportResult =
  | { readonly kind: 'ok'; readonly value: CustomEndpointImportValue }
  | { readonly kind: 'cancel' };

const TITLE = 'Add custom endpoint';
const SUBTITLE_DEFAULT =
  'HTTP endpoint. Path suffixes like /v1/responses set wire type automatically. Leave API key empty only for local/keyless servers.';
const FOOTER_NOT_LAST = 'Tab / ↑↓ to switch  ·  Enter for next field  ·  Esc to cancel';
const FOOTER_TYPE = '←→ change type  ·  Tab / ↑↓ to switch  ·  Enter for next field  ·  Esc to cancel';
const FOOTER_THINKING = '←→ toggle thinking  ·  Tab / ↑↓ to switch  ·  Enter for next field  ·  Esc to cancel';
const FOOTER_LAST = 'Tab / ↑↓ to switch  ·  Enter to submit  ·  Esc to cancel';

const WIRE_TYPE_HINTS: Record<CustomEndpointWireType, string> = {
  openai: 'Chat Completions · POST /v1/chat/completions',
  openai_responses: 'Responses · POST /v1/responses',
  anthropic: 'Messages · POST /v1/messages',
  kimi: 'Kimi Chat Completions',
  'google-genai': 'Google GenAI',
  vertexai: 'Vertex AI',
};

type TextFieldId = 'provider' | 'url' | 'model' | 'key' | 'context';
type FieldId = TextFieldId | 'type' | 'thinking';

const FIELD_ORDER: readonly FieldId[] = ['provider', 'url', 'type', 'model', 'key', 'context', 'thinking'];

function maskInputLine(raw: string): string {
  const prefix = '> ';
  if (!raw.startsWith(prefix)) return raw;
  let end = raw.length;
  while (end > prefix.length && raw[end - 1] === ' ') end--;
  const padding = raw.slice(end);
  const content = raw.slice(prefix.length, end);
  const parts = content.split(/(\u001B(?:\[[0-9;]*m|_pi:c\u0007))/);
  const maskedContent = parts
    .map((part, index) => (index % 2 === 1 ? part : part.replaceAll(/[^ ]/g, '•')))
    .join('');
  return prefix + maskedContent + padding;
}

export class CustomEndpointImportDialogComponent extends Container implements Focusable {
  focused = false;

  /**
   * Called when the user leaves the model-id field (or the URL field with a
   * model already entered). The host can use this to trigger an async
   * capability lookup (models.dev catalog / /models probe) and then call
   * {@link setThinkingDefault} with the result.
   */
  onModelHintRequest?: (info: { providerId: string; baseUrl: string; modelId: string }) => void;

  private readonly providerInput = new Input();
  private readonly urlInput = new Input();
  private readonly modelInput = new Input();
  private readonly keyInput = new Input();
  private readonly contextInput = new Input();
  private readonly onDone: (result: CustomEndpointImportResult) => void;
  private activeField: FieldId = 'provider';
  private providerType: CustomEndpointWireType = 'openai';
  private thinkingEnabled = false;
  private thinkingAutoDetected = false;
  private done = false;
  private hint: string = SUBTITLE_DEFAULT;

  constructor(onDone: (result: CustomEndpointImportResult) => void) {
    super();
    this.onDone = onDone;
    this.contextInput.setValue(String(DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE));
    for (const field of FIELD_ORDER) {
      if (field === 'type' || field === 'thinking') continue;
      this.inputFor(field).onSubmit = () => {
        if (field === 'context') {
          this.focusField(this.nextField(field));
        } else {
          this.focusField(this.nextField(field));
        }
      };
    }
  }

  /** Sets the initial thinking state (e.g. from a models.dev catalog lookup). */
  setThinkingDefault(enabled: boolean): void {
    this.thinkingEnabled = enabled;
    this.thinkingAutoDetected = enabled;
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

    if (this.activeField === 'type') {
      if (matchesKey(data, Key.left)) {
        this.cycleWireType(-1);
        return;
      }
      if (matchesKey(data, Key.right) || printableChar(data) === ' ') {
        this.cycleWireType(1);
        return;
      }
      if (matchesKey(data, Key.enter)) {
        this.focusField(this.nextField('type'));
        return;
      }
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
  }

  override invalidate(): void {
    super.invalidate();
    for (const field of FIELD_ORDER) {
      if (field === 'type' || field === 'thinking') continue;
      this.inputFor(field).invalidate();
    }
  }

  override render(width: number): string[] {
    const dialogActive = this.focused && !this.done;
    for (const field of FIELD_ORDER) {
      if (field === 'type' || field === 'thinking') continue;
      this.inputFor(field).focused = dialogActive && this.activeField === field;
    }

    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    const innerWidth = Math.max(1, safeWidth - 4);
    const border = (s: string): string => currentTheme.fg('primary', s);
    const hint =
      this.activeField === 'type' ? WIRE_TYPE_HINTS[this.providerType] : this.hint;
    const footer =
      this.activeField === 'type'
        ? FOOTER_TYPE
        : this.activeField === 'thinking'
          ? FOOTER_THINKING
          : this.activeField === 'context'
            ? FOOTER_LAST
            : FOOTER_NOT_LAST;

    const contentLines: string[] = [
      truncateToWidth(currentTheme.boldFg('textStrong', TITLE), innerWidth, '…'),
      '',
      truncateToWidth(currentTheme.fg('textDim', hint), innerWidth, '…'),
      '',
      ...this.renderField('provider', 'Provider id', innerWidth, false),
      ...this.renderField('url', 'Base URL', innerWidth, false),
      ...this.renderTypeField(innerWidth),
      ...this.renderField('model', 'Model id', innerWidth, false),
      ...this.renderField('key', 'API key', innerWidth, true),
      ...this.renderField('context', 'Context tokens', innerWidth, false),
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

  private renderField(
    field: TextFieldId,
    label: string,
    width: number,
    masked: boolean,
  ): string[] {
    const labelLine =
      this.activeField === field
        ? currentTheme.boldFg('accent', label)
        : currentTheme.fg('textDim', label);
    const inputLine = this.inputFor(field).render(width)[0] ?? '> ';
    return [
      truncateToWidth(labelLine, width, '…'),
      masked ? maskInputLine(inputLine) : inputLine,
      '',
    ];
  }

  private renderTypeField(width: number): string[] {
    const active = this.activeField === 'type';
    const labelLine = active
      ? currentTheme.boldFg('accent', 'Wire type')
      : currentTheme.fg('textDim', 'Wire type');
    const value = active
      ? currentTheme.boldFg('primary', `> ${this.providerType}  (←→)`)
      : currentTheme.fg('text', `> ${this.providerType}`);
    return [truncateToWidth(labelLine, width, '…'), truncateToWidth(value, width, '…'), ''];
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
    const value = active
      ? `${yes} ${no}  (←→)`
      : `${yes} ${no}`;
    return [truncateToWidth(labelLine, width, '…'), truncateToWidth(value, width, '…'), ''];
  }

  private handleSubmit(): void {
    if (this.done) return;
    this.applyUrlInference();
    const providerId = this.providerInput.getValue().trim();
    const baseUrl = this.urlInput.getValue().trim();
    const modelId = this.modelInput.getValue().trim();
    const apiKey = this.keyInput.getValue().trim();
    const contextRaw = this.contextInput.getValue().trim();

    if (providerId.length === 0) {
      this.reject('Provider id is required.', 'provider');
      return;
    }
    if (/\s/.test(providerId)) {
      this.reject('Provider id cannot contain whitespace.', 'provider');
      return;
    }
    if (baseUrl.length === 0) {
      this.reject('Base URL is required.', 'url');
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
        baseUrl,
        providerType: this.providerType,
        modelId,
        apiKey: apiKey.length === 0 ? undefined : apiKey,
        maxContextSize,
        thinking: this.thinkingEnabled,
      },
    });
  }

  private applyUrlInference(): void {
    const raw = this.urlInput.getValue().trim();
    if (raw.length === 0) return;
    const inferred = inferCustomEndpointFromUrl(raw);
    if (inferred.baseUrl !== this.urlInput.getValue()) {
      this.urlInput.setValue(inferred.baseUrl);
    }
    if (
      inferred.providerType !== undefined &&
      isCustomEndpointWireType(inferred.providerType)
    ) {
      this.providerType = inferred.providerType;
    }
  }

  private cycleWireType(delta: number): void {
    const index = CUSTOM_ENDPOINT_WIRE_TYPES.indexOf(this.providerType);
    const next =
      (index + delta + CUSTOM_ENDPOINT_WIRE_TYPES.length) % CUSTOM_ENDPOINT_WIRE_TYPES.length;
    this.providerType = CUSTOM_ENDPOINT_WIRE_TYPES[next] ?? 'openai';
    this.hint = SUBTITLE_DEFAULT;
  }

  private reject(hint: string, field: FieldId): void {
    this.hint = hint;
    this.activeField = field;
  }

  private focusField(field: FieldId): void {
    const leaving = this.activeField;
    if (this.activeField === 'url' && field !== 'url') {
      this.applyUrlInference();
    }
    this.hint = SUBTITLE_DEFAULT;
    this.activeField = field;
    // Fire the hint request when leaving the model field (or URL field with a
    // model already entered) so the host can auto-detect thinking support.
    if (
      (leaving === 'model' || leaving === 'url') &&
      field !== leaving &&
      this.onModelHintRequest !== undefined
    ) {
      const modelId = this.modelInput.getValue().trim();
      if (modelId.length > 0) {
        this.onModelHintRequest({
          providerId: this.providerInput.getValue().trim(),
          baseUrl: this.urlInput.getValue().trim(),
          modelId,
        });
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
      case 'url':
        return this.urlInput;
      case 'model':
        return this.modelInput;
      case 'key':
        return this.keyInput;
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
