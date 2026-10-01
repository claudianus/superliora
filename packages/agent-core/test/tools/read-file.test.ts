import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalKaos, type Kaos } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';

import { ReadTool } from '../../src/tools/builtin/file/read';
import { createFakeKaos, PERMISSIVE_WORKSPACE } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;
const REGULAR_FILE_STAT = {
  stMode: 0o100_644,
  stIno: 1,
  stDev: 1,
  stNlink: 1,
  stUid: 1000,
  stGid: 1000,
  stSize: 0,
  stAtime: 0,
  stMtime: 0,
  stCtime: 0,
} satisfies Awaited<ReturnType<Kaos['stat']>>;

function linesFromContent(content: string): string[] {
  if (content === '') return [];
  const rawLines = content.split('\n');
  return rawLines.flatMap((line, index) => {
    if (index < rawLines.length - 1) return [`${line}\n`];
    return line === '' ? [] : [line];
  });
}

function readLinesFromContent(content: string): Kaos['readLines'] {
  return async function* readLines(): AsyncGenerator<string> {
    for (const line of linesFromContent(content)) {
      yield line;
    }
  };
}

function toolWithContent(content: string): ReadTool {
  const bytes = Buffer.from(content, 'utf8');
  return new ReadTool(
    createFakeKaos({
      stat: vi.fn<Kaos['stat']>().mockResolvedValue(REGULAR_FILE_STAT),
      readBytes: vi.fn<Kaos['readBytes']>().mockImplementation(async (_path, n) => {
        return n === undefined ? bytes : bytes.subarray(0, n);
      }),
      readLines: vi.fn<Kaos['readLines']>().mockImplementation(readLinesFromContent(content)),
    }),
    PERMISSIVE_WORKSPACE,
  );
}

describe('ReadTool — total-lines message channel', () => {
  it('reports the file total in the status message even with a positive line_offset window', async () => {
    // Five-line file, request just line 3 with n_lines=1. The status
    // line must still surface the file's full length so the model can plan
    // a follow-up read of the rest of the file.
    const tool = toolWithContent('a\nb\nc\nd\ne');

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c1',
      args: { path: '/tmp/sample.txt', line_offset: 3, n_lines: 1 },
      signal,
    });

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('3\tc');
    expect(result.output).toContain('Total lines in file: 5.');
  });

  it('reads a UTF-16 file with a byte-order mark instead of calling it unreadable', async () => {
    // PowerShell 5.1 redirection, `wmic`, and `reg export` all write this
    // shape. Reading it as binary told the user to fall back to Bash.
    const dir = mkdtempSync(join(tmpdir(), 'liora-read-utf16-'));
    try {
      const file = join(dir, 'export.txt');
      writeFileSync(
        file,
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from('alpha\r\nbeta\r\n', 'utf16le'),
        ]),
      );
      const tool = new ReadTool((await LocalKaos.create()).withCwd('/'), PERMISSIVE_WORKSPACE);

      const result = await executeTool(tool, {
        turnId: 't1',
        toolCallId: 'c-utf16',
        args: { path: file },
        signal,
      });

      expect(result.isError).toBeFalsy();
      expect(result.output).toContain('alpha');
      expect(result.output).toContain('beta');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
