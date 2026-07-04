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
    typeText(dialog, 'qwen3-coder:30b');
    dialog.handleInput('\r');
    dialog.handleInput('\r'); // empty API key is allowed for local/keyless endpoints.
    dialog.handleInput('\r'); // submit default context tokens.

    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: {
        providerId: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        modelId: 'qwen3-coder:30b',
        apiKey: undefined,
        maxContextSize: 128000,
      },
    });
  });

  it('masks API keys while rendering', () => {
    const { dialog } = makeDialog();
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

    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    dialog.handleInput(DOWN);
    dialog.handleInput('\r');

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
