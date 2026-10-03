import type { ToolResultDisplay } from '@superliora/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { renderTruncated } from '#/tui/components/messages/tool-renderers/truncated';
import {
  setActiveNeatMode,
} from '#/tui/features/transcript/transcript-density';
import { darkColors } from '#/tui/theme/colors';
import type { Component } from '#/tui/renderer';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

function strip(text: string): string {
  return text.replaceAll(/\u001B?\[[0-9;]*m/g, '');
}

function render(components: Component[], width = 100): string {
  return strip(components.flatMap((c) => c.render(width)).join('\n'));
}

const call: ToolCallBlockData = { id: 'tc', name: 'Bash', args: { command: 'pnpm test' } };

function result(output: string, display?: ToolResultDisplay): ToolResultBlockData {
  return { tool_call_id: 'tc', output, ...(display === undefined ? {} : { display }) };
}

const ctx = { expanded: false, colors: darkColors };
const expandedCtx = { expanded: true, colors: darkColors };

const RAW = 'line one\nline two\nline three';

const COMMAND_OUTPUT: ToolResultDisplay = {
  kind: 'command_output',
  exit_code: 1,
  stdout: 'native-command-tail',
};

afterEach(() => {
  setActiveNeatMode(true);
});

describe('neat mode dispatch', () => {

  it('replaces the raw body with a native command card', () => {
    const out = render(renderTruncated(call, result(RAW, COMMAND_OUTPUT), ctx));
    expect(out).toContain('exit 1');
    expect(out).toContain('native-command-tail');
    expect(out).not.toContain('line two');
  });

  it('keeps the raw body under the card when expanded', () => {
    const out = render(renderTruncated(call, result(RAW, COMMAND_OUTPUT), expandedCtx));
    expect(out).toContain('exit 1');
    expect(out).toContain('line two');
  });

  it('falls back to the raw body when neat is off', () => {
    setActiveNeatMode(false);
    const out = render(renderTruncated(call, result(RAW, COMMAND_OUTPUT), ctx));
    expect(out).toContain('line two');
    expect(out).not.toContain('native-command-tail');
  });

  it('falls back to the raw body when no display was attached', () => {
    const out = render(renderTruncated(call, result(RAW), ctx));
    expect(out).toContain('line two');
  });

});

describe('neat card kinds', () => {
  it('renders a command_output tail with the exit code', () => {
    const display: ToolResultDisplay = {
      kind: 'command_output',
      exit_code: 2,
      stdout: 'a\nb\nc\nd',
    };
    const out = render(renderTruncated(call, result(RAW, display), ctx));
    expect(out).toContain('exit 2');
    expect(out).toContain('d');
    expect(out).not.toContain('line two');
  });

  it('renders a structured object as key/value rows with shape hints', () => {
    const display: ToolResultDisplay = {
      kind: 'structured',
      data: { status: 'ok', count: 12, items: [1, 2, 3], nested: { a: 1, b: 2 } },
    };
    const out = render(renderTruncated(call, result(RAW, display), ctx));
    expect(out).toContain('{4 fields}');
    expect(out).toContain('status');
    expect(out).toContain('ok');
    expect(out).toContain('[3]');
    expect(out).toContain('{2}');
  });

  it('keeps the raw body for display kinds without a card form', () => {
    const display: ToolResultDisplay = { kind: 'error', message: 'nope' };
    const out = render(renderTruncated(call, result(RAW, display), ctx));
    expect(out).toContain('line two');
  });
});
