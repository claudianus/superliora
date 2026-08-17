import { describe, expect, it } from 'vitest';

import {
  grepGlance,
  webSearchGlance,
} from '#/tui/components/messages/tool-renderers/summary-glances';
import { generateMediaGlance } from '#/tui/components/messages/tool-renderers/summary-glances-browser';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

function call(name: string, args: Record<string, unknown> = {}): ToolCallBlockData {
  return { id: 'tc', name, args };
}

function toolResult(output: string): ToolResultBlockData {
  return { tool_call_id: 'tc', output, is_error: false };
}

describe('summary glances', () => {
  it('grepGlance strips line:col suffixes from sample paths', () => {
    const line = grepGlance(
      call('Grep', { pattern: 'foo' }),
      toolResult('src/a.ts:12:3:const foo = 1\nsrc/b.ts:4:1:foo()'),
    );
    expect(line).toContain('src/a.ts');
    expect(line).not.toContain(':12:');
  });

  it('webSearchGlance reports no results for empty search output', () => {
    expect(
      webSearchGlance(call('WebSearch'), toolResult('No search results found.')),
    ).toBe('no results');
  });

  it('webSearchGlance prefers the Route line over titles', () => {
    const output = [
      'Route: package/npm · sources github, npm',
      'Title: zod',
      'URL: https://www.npmjs.com/package/zod',
      'Snippet: schema',
      '',
      'Channels: Local',
    ].join('\n');
    expect(webSearchGlance(call('WebSearch'), toolResult(output))).toBe(
      'package/npm · sources github, npm',
    );
  });

  it('webSearchGlance prefixes serving channels when the footer is present', () => {
    const output = [
      'Title: Alpha',
      'URL: https://example.com/a',
      'Snippet: first',
      '',
      '---',
      '',
      'Title: Beta',
      'URL: https://example.com/b',
      'Snippet: second',
      '',
      'Channels: Brave → Local',
      '',
    ].join('\n');
    expect(webSearchGlance(call('WebSearch'), toolResult(output))).toBe(
      'Brave → Local · Alpha · Beta',
    );
  });

  it('generateMediaGlance surfaces the routed provider with the path', () => {
    const output = [
      'Generated image with codex.',
      'Path: /tmp/out/image.png',
      'Bytes: 12345',
      'MIME: image/png',
    ].join('\n');
    expect(generateMediaGlance(call('GenerateImage'), toolResult(output))).toBe(
      'codex · /tmp/out/image.png',
    );
  });

  it('generateMediaGlance keeps path-only output working', () => {
    expect(
      generateMediaGlance(call('GenerateImage'), toolResult('Path: /tmp/out/image.png')),
    ).toBe('/tmp/out/image.png');
  });
});
