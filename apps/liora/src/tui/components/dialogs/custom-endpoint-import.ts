/**
 * CustomEndpointImportDialog — collects a direct OpenAI-compatible endpoint,
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

import { DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE } from '#/utils/custom-provider';
import { currentTheme } from '#/tui/theme';
import { Input } from './input';

export interface CustomEndpointImportValue {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey?: string;
  readonly maxContextSize: number;
}

export type CustomEndpointImportResult =
  | { readonly kind: 'ok'; readonly value: CustomEndpointImportValue }
  | { readonly kind: 'cancel' };

const TITLE = 'Add custom endpoint';
const SUBTITLE_DEFAULT =
  'OpenAI-compatible endpoint. Leave API key empty only for local/keyless servers.';
const FOOTER_NOT_LAST = 'Tab / ↑↓ to switch  ·  Enter for next field  ·  Esc to cancel';
const FOOTER_LAST = 'Tab / ↑↓ to switch  ·  Enter to submit  ·  Esc to cancel';

type FieldId = 'provider' | 'url' | 'model' | 'key' | 'context';

const FIELD_ORDER: readonly FieldId[] = ['provider', 'url', 'model', 'key', 'context'];

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

  private readonly providerInput = new Input();
  private readonly urlInput = new Input();
  private readonly modelInput = new Input();
  private readonly keyInput = new Input();
  private readonly contextInput = new Input();
  private readonly onDone: (result: CustomEndpointImportResult) => void;
  private activeField: FieldId = 'provider';
  private done = false;
  private hint: string = SUBTITLE_DEFAULT;

  constructor(onDone: (result: CustomEndpointImportResult) => void) {
    super();
    this.onDone = onDone;
    this.contextInput.setValue(String(DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE));
    for (const field of FIELD_ORDER) {
      this.inputFor(field).onSubmit = () => {
        if (field === 'context') {
          this.handleSubmit();
        } else {
          this.focusField(this.nextField(field));
        }
      };
    }
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

    this.hint = SUBTITLE_DEFAULT;
    this.inputFor(this.activeField).handleInput(data);
  }

  override invalidate(): void {
    super.invalidate();
    for (const field of FIELD_ORDER) this.inputFor(field).invalidate();
  }

  override render(width: number): string[] {
    const dialogActive = this.focused && !this.done;
    for (const field of FIELD_ORDER) {
      this.inputFor(field).focused = dialogActive && this.activeField === field;
    }

    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    const innerWidth = Math.max(1, safeWidth - 4);
    const border = (s: string): string => currentTheme.fg('primary', s);

    const contentLines: string[] = [
      truncateToWidth(currentTheme.boldFg('textStrong', TITLE), innerWidth, '…'),
      '',
      truncateToWidth(currentTheme.fg('textDim', this.hint), innerWidth, '…'),
      '',
      ...this.renderField('provider', 'Provider id', innerWidth, false),
      ...this.renderField('url', 'Base URL', innerWidth, false),
      ...this.renderField('model', 'Model id', innerWidth, false),
      ...this.renderField('key', 'API key', innerWidth, true),
      ...this.renderField('context', 'Context tokens', innerWidth, false),
      truncateToWidth(
        currentTheme.fg('textDim', this.activeField === 'context' ? FOOTER_LAST : FOOTER_NOT_LAST),
        innerWidth,
        '…',
      ),
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
    field: FieldId,
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

  private handleSubmit(): void {
    if (this.done) return;
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
        modelId,
        apiKey: apiKey.length === 0 ? undefined : apiKey,
        maxContextSize,
      },
    });
  }

  private reject(hint: string, field: FieldId): void {
    this.hint = hint;
    this.activeField = field;
  }

  private focusField(field: FieldId): void {
    this.hint = SUBTITLE_DEFAULT;
    this.activeField = field;
  }

  private cancel(): void {
    if (this.done) return;
    this.done = true;
    this.onDone({ kind: 'cancel' });
  }

  private inputFor(field: FieldId): Input {
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
