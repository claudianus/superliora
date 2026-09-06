/**
 * `FileURLPart` (PDF/document) serialization across the four wires that can
 * carry documents natively:
 *  - Chat Completions  → `{type:'file', file:{filename, file_data}}`
 *  - Responses API     → `{type:'input_file', filename, file_data}`
 *  - Anthropic Messages → `{type:'document', source:{type:'base64'|'url'}}`
 *  - Google GenAI       → `inlineData` / `fileData`
 */
import { describe, expect, it } from 'vitest';

import { convertMessage as anthropicConvertMessage } from '#/providers/anthropic/anthropic-messages';
import { messagesToGoogleGenAIContents } from '#/providers/google/google-genai-messages';
import { convertContentPart } from '#/providers/openai/openai-common';
import { convertHistoryMessages as responsesConvertHistory } from '#/providers/openai/openai-responses-messages';
import { convertHistoryMessages as chatConvertHistory } from '#/providers/openai-legacy/messages';
import type { FileURLPart, Message } from '#/message';

const PDF_DATA_URL =
  'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCjAx' as const;

function filePart(overrides: Partial<FileURLPart['fileUrl']> = {}): FileURLPart {
  return {
    type: 'file_url',
    fileUrl: { url: PDF_DATA_URL, filename: 'spec.pdf', ...overrides },
  };
}

function userMessage(content: Message['content']): Message {
  return { role: 'user', content, toolCalls: [] };
}

function toolMessage(content: Message['content']): Message {
  return { role: 'tool', content, toolCalls: [], toolCallId: 'call_1' };
}

describe('file_url → Chat Completions `file` part', () => {
  it('maps data URLs to file parts with filename and file_data', () => {
    expect(convertContentPart(filePart())).toEqual({
      type: 'file',
      file: { filename: 'spec.pdf', file_data: PDF_DATA_URL },
    });
  });

  it('degrades remote http(s) references to a text note instead of throwing', () => {
    const converted = convertContentPart(
      filePart({ url: 'https://example.test/doc.pdf', filename: undefined }),
    );
    expect(converted?.type).toBe('text');
  });

  it('reattaches PDFs from tool results as a follow-up user message', () => {
    const messages = chatConvertHistory(
      [toolMessage([{ type: 'text', text: 'read it' }, filePart()])],
      undefined,
      null,
    );
    const last = messages.at(-1);
    expect(last?.role).toBe('user');
    expect(JSON.stringify(last)).toContain('"type":"file"');
    expect(JSON.stringify(last)).toContain('spec.pdf');
  });
});

describe('file_url → Responses `input_file` item', () => {
  it('maps data URLs to input_file with file_data', () => {
    const input = responsesConvertHistory(
      [userMessage([{ type: 'text', text: 'see attached' }, filePart()])],
      'gpt-5.6-sol',
      null,
    );
    const content = (
      input.find((item) => (item as { type?: string }).type === 'message') as {
        content: Array<{ type: string; file_data?: string; filename?: string }>;
      }
    ).content;
    const file = content.find((part) => part.type === 'input_file');
    expect(file).toMatchObject({ type: 'input_file', filename: 'spec.pdf' });
    expect(file?.file_data).toBe(PDF_DATA_URL);
  });

  it('maps remote URLs to input_file with file_url', () => {
    const input = responsesConvertHistory(
      [userMessage([filePart({ url: 'https://example.test/doc.pdf' })])],
      'gpt-5.6-sol',
      null,
    );
    const content = (
      input.find((item) => (item as { type?: string }).type === 'message') as {
        content: Array<{ type: string; file_url?: string }>;
      }
    ).content;
    expect(content.some((part) => part.type === 'input_file' && part.file_url !== undefined)).toBe(
      true,
    );
  });
});

describe('file_url → Anthropic `document` block', () => {
  it('maps data URLs to base64 document blocks with the PDF media type', () => {
    const block = anthropicConvertMessage(userMessage([filePart()]), 'claude-sonnet-5').content;
    expect(JSON.stringify(block)).toContain('"type":"document"');
    expect(JSON.stringify(block)).toContain('application/pdf');
    expect(JSON.stringify(block)).toContain('JVBERi');
  });

  it('keeps documents in tool results instead of dropping them', () => {
    const block = anthropicConvertMessage(toolMessage([filePart()]), 'claude-sonnet-5').content;
    expect(JSON.stringify(block)).toContain('"type":"document"');
  });
});

describe('file_url → Google GenAI inlineData', () => {
  it('maps PDF data URLs to inline document parts', () => {
    const contents = messagesToGoogleGenAIContents([
      userMessage([{ type: 'text', text: 'see attached' }, filePart()]),
    ]);
    expect(JSON.stringify(contents)).toContain('"inlineData"');
    expect(JSON.stringify(contents)).toContain('application/pdf');
  });
});
