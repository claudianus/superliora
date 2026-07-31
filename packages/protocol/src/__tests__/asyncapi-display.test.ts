import { describe, expect, it } from 'vitest';

import { createAsyncApiDocument } from '../asyncapi';
import { ToolInputDisplaySchema, ToolResultDisplaySchema } from '../display';

describe('protocol/asyncapi — document builder', () => {
  it('createAsyncApiDocument returns the expected envelope', () => {
    const doc = createAsyncApiDocument();
    expect(doc.asyncapi).toBe('3.1.0');
    expect((doc).info).toBeDefined();
    expect((doc).channels).toBeDefined();
    expect((doc).operations).toBeDefined();
  });

  it('createAsyncApiDocument honors custom title and version', () => {
    const doc = createAsyncApiDocument({ title: 'T', version: '9.9.9' });
    const info = (doc as { info: { title: string; version: string } }).info;
    expect(info.title).toBe('T');
    expect(info.version).toBe('9.9.9');
  });

  it('createAsyncApiDocument honors wss server protocol', () => {
    const doc = createAsyncApiDocument({ serverProtocol: 'wss' });
    const servers = (doc as { servers: { local: { protocol: string } } })
      .servers;
    expect(servers.local.protocol).toBe('wss');
  });
});

describe('protocol/display — discriminated unions', () => {
  it('ToolInputDisplaySchema accepts a command input', () => {
    const v = ToolInputDisplaySchema.parse({
      kind: 'command',
      command: 'ls',
    });
    expect(v.kind).toBe('command');
  });

  it('ToolInputDisplaySchema accepts a generic input', () => {
    const v = ToolInputDisplaySchema.parse({
      kind: 'generic',
      summary: 'hello',
      detail: { x: 1 },
    });
    if (v.kind === 'generic') {
      expect(v.detail).toEqual({ x: 1 });
    }
  });

  it('ToolInputDisplaySchema rejects an unknown kind', () => {
    expect(() =>
      ToolInputDisplaySchema.parse({ kind: 'mystery', x: 1 }),
    ).toThrow();
  });

  it('ToolResultDisplaySchema accepts a command_output', () => {
    const v = ToolResultDisplaySchema.parse({
      kind: 'command_output',
      exit_code: 0,
      stdout: 'ok',
    });
    expect(v.kind).toBe('command_output');
  });

  it('ToolResultDisplaySchema accepts a text result', () => {
    const v = ToolResultDisplaySchema.parse({ kind: 'text', text: 'hi' });
    if (v.kind === 'text') {
      expect(v.text).toBe('hi');
    }
  });

  it('ToolResultDisplaySchema accepts a structured result', () => {
    const v = ToolResultDisplaySchema.parse({
      kind: 'structured',
      data: { a: 1, b: [1, 2] },
    });
    if (v.kind === 'structured') {
      expect(v.data).toEqual({ a: 1, b: [1, 2] });
    }
  });
});
