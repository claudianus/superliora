import { visibleWidth } from '#/tui/renderer';
import { describe, expect, it, vi } from 'vitest';

import {
  CustomEndpointImportDialogComponent,
  type CustomEndpointImportResult,
} from '#/tui/components/dialogs/provider/custom-endpoint-import';

const ANSI = /\u001B\[[0-9;]*m/g;
const strip = (s: string): string => s.replaceAll(ANSI, '');
const ESC = String.fromCodePoint(27);
const DOWN = `${ESC}[B`;
const RIGHT = `${ESC}[C`;
const LEFT = `${ESC}[D`;

function plain(component: CustomEndpointImportDialogComponent, width = 96): string {
  return component.render(width).map(strip).join('\n');
}

function makeDialog(): {
  dialog: CustomEndpointImportDialogComponent;
  onDone: ReturnType<typeof vi.fn>;
} {
  const onDone = vi.fn();
  const dialog = new CustomEndpointImportDialogComponent(
    onDone as unknown as (result: CustomEndpointImportResult) => void,
  );
  dialog.focused = true;
  return { dialog, onDone };
}

function typeText(dialog: CustomEndpointImportDialogComponent, text: string): void {
  for (const ch of text) dialog.handleInput(ch);
}

describe('CustomEndpointImportDialogComponent', () => {
  it('advances through fields and submits a keyless endpoint', () => {
    const { dialog, onDone } = makeDialog();

    typeText(dialog, 'ollama');
    dialog.handleInput('\r');
    typeText(dialog, 'http://localhost:11434/v1');
    dialog.handleInput('\r');
    dialog.handleInput('\r'); // keep default wire type (openai)
    typeText(dialog, 'qwen3-coder:30b');
    dialog.handleInput('\r');
    dialog.handleInput('\r'); // empty API key is allowed for local/keyless endpoints.
    dialog.handleInput('\r'); // keep default context tokens.
    dialog.handleInput('\r'); // leave max output empty.
    dialog.handleInput('\r'); // leave headers empty.
    dialog.handleInput('\r'); // keep default thinking (No) and submit.

    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: {
        providerId: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        providerType: 'openai',
        modelId: 'qwen3-coder:30b',
        apiKey: undefined,
        maxContextSize: 128000,
        thinking: false,
      },
    });
  });

  it('collects max output and headers', () => {
    const { dialog, onDone } = makeDialog();

    typeText(dialog, 'gw');
    dialog.handleInput('\r');
    typeText(dialog, 'https://gw.test/v1');
    dialog.handleInput('\r');
    dialog.handleInput('\r'); // keep default wire type (openai)
    typeText(dialog, 'm');
    dialog.handleInput('\r');
    typeText(dialog, 'sk-x');
    dialog.handleInput('\r');
    dialog.handleInput('\r'); // keep default context tokens.
    typeText(dialog, '4096');
    dialog.handleInput('\r'); // max output -> headers
    typeText(dialog, 'X-Tenant: acme');
    dialog.handleInput('\r'); // headers -> thinking
    dialog.handleInput('\r'); // keep default thinking (No) and submit.

    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: {
        providerId: 'gw',
        baseUrl: 'https://gw.test/v1',
        providerType: 'openai',
        modelId: 'm',
        apiKey: 'sk-x',
        maxContextSize: 128000,
        maxOutputSize: 4096,
        customHeaders: { 'X-Tenant': 'acme' },
        thinking: false,
      },
    });
  });

  it('rejects malformed max output and headers on submit', () => {
    const { dialog, onDone } = makeDialog();

    typeText(dialog, 'gw');
    dialog.handleInput('\r');
    typeText(dialog, 'https://gw.test/v1');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    typeText(dialog, 'm');
    dialog.handleInput('\r');
    dialog.handleInput('\r'); // key
    dialog.handleInput('\r'); // context
    typeText(dialog, 'lots');
    dialog.handleInput('\r'); // output -> headers
    dialog.handleInput('\r'); // headers -> thinking
    dialog.handleInput('\r'); // submit -> reject stays on output
    expect(onDone).not.toHaveBeenCalled();
    expect(plain(dialog)).toContain('Max output must be a positive integer');
  });

  it('prefills from preset initial values and starts at the model field', () => {
    const onDone = vi.fn();
    const dialog = new CustomEndpointImportDialogComponent(
      onDone as unknown as (result: CustomEndpointImportResult) => void,
      { providerId: 'ollama', baseUrl: 'http://localhost:11434/v1', providerType: 'openai' },
    );
    dialog.focused = true;
    const rendered = plain(dialog);
    expect(rendered).toContain('ollama');
    expect(rendered).toContain('http://localhost:11434/v1');
    // Model is the first empty field: typing lands there immediately.
    typeText(dialog, 'qwen3-coder:30b');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r'); // thinking -> submit
    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: expect.objectContaining({
        providerId: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        modelId: 'qwen3-coder:30b',
      }),
    });
  });

  it('cycles wire type with ←/→ and includes it in the submit value', () => {
    const { dialog, onDone } = makeDialog();

    typeText(dialog, 'ocx');
    dialog.handleInput('\r');
    typeText(dialog, 'http://127.0.0.1:10100/v1');
    dialog.handleInput('\r');
    dialog.handleInput(RIGHT); // openai → openai_responses
    expect(plain(dialog)).toContain('openai_responses');
    expect(plain(dialog)).toContain('POST /v1/responses');
    dialog.handleInput('\r');
    typeText(dialog, 'cursor/grok-4.5');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r'); // thinking field → submit

    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: {
        providerId: 'ocx',
        baseUrl: 'http://127.0.0.1:10100/v1',
        providerType: 'openai_responses',
        modelId: 'cursor/grok-4.5',
        apiKey: undefined,
        maxContextSize: 128000,
        thinking: false,
      },
    });
  });

  it('infers openai_responses from a /v1/responses URL and strips the route', () => {
    const { dialog, onDone } = makeDialog();

    typeText(dialog, 'ocx');
    dialog.handleInput('\r');
    typeText(dialog, 'http://127.0.0.1:10100/v1/responses');
    dialog.handleInput('\r'); // leave URL → infer type + rewrite base
    const afterUrl = plain(dialog);
    expect(afterUrl).toContain('http://127.0.0.1:10100/v1');
    expect(afterUrl).not.toContain('http://127.0.0.1:10100/v1/responses');
    expect(afterUrl).toContain('openai_responses');
    dialog.handleInput('\r'); // leave wire type
    typeText(dialog, 'cursor/grok-4.5');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\r'); // thinking field → submit

    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: {
        providerId: 'ocx',
        baseUrl: 'http://127.0.0.1:10100/v1',
        providerType: 'openai_responses',
        modelId: 'cursor/grok-4.5',
        apiKey: undefined,
        maxContextSize: 128000,
        thinking: false,
      },
    });
  });

  it('wraps wire type cycling at both ends', () => {
    const { dialog } = makeDialog();
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN); // Wire type

    dialog.handleInput(LEFT); // openai → vertexai
    expect(plain(dialog)).toContain('vertexai');
    dialog.handleInput(RIGHT); // vertexai → openai
    expect(plain(dialog)).toContain('openai');
  });

  it('masks API keys while rendering', () => {
    const { dialog } = makeDialog();
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    typeText(dialog, 'sk-secret');

    const output = plain(dialog);
    expect(output).not.toContain('sk-secret');
    expect(output).toContain('•••••••••');
  });

  it('validates required fields before submitting', () => {
    const { dialog, onDone } = makeDialog();

    // Navigate to the thinking field (last field) and try to submit.
    for (let i = 0; i < 8; i++) dialog.handleInput(DOWN);
    dialog.handleInput('\r'); // try to submit

    expect(onDone).not.toHaveBeenCalled();
    expect(plain(dialog)).toContain('Provider id is required');
  });

  it('keeps every line within narrow widths', () => {
    const { dialog } = makeDialog();

    for (const width of [42, 35, 24, 12]) {
      for (const line of dialog.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
