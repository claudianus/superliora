import { visibleWidth } from '#/tui/renderer';
import { describe, expect, it, vi } from 'vitest';

import {
  CustomEndpointImportDialogComponent,
  type CustomEndpointImportResult,
} from '#/tui/components/dialogs/custom-endpoint-import';

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
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN); // thinking field
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
