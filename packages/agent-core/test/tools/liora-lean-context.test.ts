import type { Kaos } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';

import { LioraExpandTool } from '../../src/tools/builtin/context/liora-expand';
import { LioraReadTool } from '../../src/tools/builtin/context/liora-read';
import { compressShellOutput } from '../../src/tools/builtin/context/context-terse';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../src/tools/store';
import type { WorkspaceConfig } from '../../src/tools/support/workspace';
import { createFakeKaos, toolContentString } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;
const workspace: WorkspaceConfig = { workspaceDir: '/workspace', additionalDirs: [] };

function context<Input>(args: Input, toolCallId = 'call_1') {
  return { turnId: '0', toolCallId, args, signal };
}

function makeStore(): { store: ToolStore; data: Partial<ToolStoreData> } {
  const data: Partial<ToolStoreData> = {};
  return {
    data,
    store: {
      get<K extends ToolStoreKey>(key: K): ToolStoreData[K] | undefined {
        return data[key];
      },
      set<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
        data[key] = value;
      },
    },
  };
}

function makeKaos(files: Readonly<Record<string, string>>): Kaos {
  const paths = Object.keys(files);
  return createFakeKaos({
    iterdir: vi.fn<Kaos['iterdir']>().mockImplementation(async function* iterdir(dir) {
      for (const entry of immediateChildren(paths, dir)) yield entry;
    }),
    stat: vi.fn<Kaos['stat']>().mockImplementation(async (path) => ({
      stMode: directoryExists(paths, path) ? 0o040_755 : 0o100_644,
      stIno: 1,
      stDev: 1,
      stNlink: 1,
      stUid: 1000,
      stGid: 1000,
      stSize: Buffer.byteLength(files[path] ?? '', 'utf8'),
      stAtime: 0,
      stMtime: 0,
      stCtime: 0,
    })),
    readText: vi.fn<Kaos['readText']>().mockImplementation(async (path) => files[path] ?? ''),
  });
}

function immediateChildren(paths: readonly string[], dir: string): string[] {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  const children = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const [child] = path.slice(prefix.length).split('/');
    if (child !== undefined && child.length > 0) children.add(child);
  }
  return [...children].toSorted((a, b) => a.localeCompare(b));
}

function directoryExists(paths: readonly string[], dir: string): boolean {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return paths.some((path) => path.startsWith(prefix));
}

describe('Liora lean context tools', () => {
  it('LioraRead returns signatures instead of full file bodies for large files', async () => {
    const file = [
      'export function targetNeedle() { return 1; }',
      ...Array.from({ length: 200 }, (_, index) => `const filler${index} = ${index};`),
    ].join('\n');
    const { store } = makeStore();
    const tool = new LioraReadTool(
      makeKaos({ '/workspace/src/big.ts': file }),
      workspace,
      store,
    );

    const result = await executeTool(tool, context({ path: 'src/big.ts', mode: 'signatures' }));
    const output = toolContentString(result);

    expect(result.isError).toBeFalsy();
    expect(output).toContain('<liora_read mode="signatures"');
    expect(output).toContain('targetNeedle');
    expect(output).not.toContain('filler150');
  });

  it('compressShellOutput collapses repetitive passing test lines', () => {
    const stdout = [
      'PASS test/a',
      'PASS test/b',
      'PASS test/c',
      'PASS test/d',
      'FAIL test/e',
      'AssertionError: boom',
    ].join('\n');
    const compressed = compressShellOutput({
      stdout,
      stderr: '',
      command: 'pnpm test',
    });
    expect(compressed.text).toContain('passing tests omitted');
    expect(compressed.text).toContain('FAIL test/e');
    expect(compressed.savedPercent).toBeGreaterThan(0);
  });

  it('compressShellOutput collapses go test --- PASS lines', () => {
    const stdout = [
      ...Array.from({ length: 12 }, (_, i) => `--- PASS: TestFoo${String(i)} (0.00s)`),
      '--- FAIL: TestBoom (0.01s)',
      '    boom_test.go:12: expected true',
      'FAIL',
    ].join('\n');
    const compressed = compressShellOutput({
      stdout,
      stderr: '',
      command: 'go test ./...',
    });
    expect(compressed.text).toContain('passing tests omitted');
    expect(compressed.text).toContain('--- FAIL: TestBoom');
    expect(compressed.savedPercent).toBeGreaterThan(0);
  });

  it('compressShellOutput collapses cargo test ok lines', () => {
    const stdout = [
      ...Array.from({ length: 16 }, (_, i) => `test foo::bar${String(i)} ... ok`),
      'test foo::boom ... FAILED',
      'failures:',
      '    foo::boom',
    ].join('\n');
    const compressed = compressShellOutput({
      stdout,
      stderr: '',
      command: 'cargo test',
    });
    expect(compressed.text).toContain('passing tests omitted');
    expect(compressed.text).toContain('test foo::boom ... FAILED');
    expect(compressed.savedPercent).toBeGreaterThan(0);
  });

  it('compressShellOutput collapses long tsc error dumps', () => {
    const stdout = Array.from(
      { length: 100 },
      (_, i) => `src/a${String(i)}.ts(${String(i)},1): error TS2304: Cannot find name 'x${String(i)}'.`,
    ).join('\n');
    const compressed = compressShellOutput({
      stdout,
      stderr: '',
      command: 'tsc -p .',
    });
    expect(compressed.text).toContain('compiler/linter lines omitted');
    expect(compressed.savedPercent).toBeGreaterThan(0);
    expect(compressed.text.length).toBeLessThan(stdout.length);
  });

  it('compressShellOutput collapses long ruff/mypy dumps', () => {
    const stdout = Array.from(
      { length: 100 },
      (_, i) => `src/a${String(i)}.py:1:1: F401 [ ] \`os\` imported but unused`,
    ).join('\n');
    for (const command of ['ruff check .', 'mypy src']) {
      const compressed = compressShellOutput({
        stdout,
        stderr: '',
        command,
      });
      expect(compressed.text, command).toContain('compiler/linter lines omitted');
      expect(compressed.savedPercent, command).toBeGreaterThan(0);
      expect(compressed.text.length, command).toBeLessThan(stdout.length);
    }
  });

  it('compressShellOutput collapses long biome/clippy dumps', () => {
    // Keep lines short enough that pattern compress stays under the default
    // maxChars budget; otherwise a second char-cap pass rewrites the middle.
    const stdout = Array.from(
      { length: 100 },
      (_, i) => `src/a${String(i)}.ts:1:1 lint unused x${String(i)}`,
    ).join('\n');
    for (const command of ['biome check .', 'cargo clippy']) {
      const compressed = compressShellOutput({
        stdout,
        stderr: '',
        command,
      });
      expect(compressed.text, command).toContain('compiler/linter lines omitted');
      expect(compressed.savedPercent, command).toBeGreaterThan(0);
      expect(compressed.text.length, command).toBeLessThan(stdout.length);
    }
  });

  it('compressShellOutput collapses long prettier/black/rustfmt dumps', () => {
    const stdout = Array.from(
      { length: 100 },
      (_, i) => `[warn] src/a${String(i)}.ts Code style issues found`,
    ).join('\n');
    for (const command of [
      'prettier --check .',
      'black --check .',
      'cargo fmt --check',
      'gofmt -l .',
      'clang-format --dry-run src/a.c',
    ]) {
      const compressed = compressShellOutput({
        stdout,
        stderr: '',
        command,
      });
      expect(compressed.text, command).toContain('compiler/linter lines omitted');
      expect(compressed.savedPercent, command).toBeGreaterThan(0);
      expect(compressed.text.length, command).toBeLessThan(stdout.length);
    }
  });

  it('compressShellOutput collapses long git log dumps', () => {
    const stdout = Array.from(
      { length: 120 },
      (_, i) => `commit ${String(i).padStart(40, 'a')}\nAuthor: Dev\nDate: now\n\n    msg ${String(i)}\n`,
    ).join('');
    const compressed = compressShellOutput({
      stdout,
      stderr: '',
      command: 'git log --oneline -n 200',
    });
    expect(compressed.text).toContain('git lines omitted');
    expect(compressed.savedPercent).toBeGreaterThan(0);
    expect(compressed.text.length).toBeLessThan(stdout.length);
  });

  it('compressShellOutput keeps git diff headers and omits long body runs', () => {
    const body = Array.from({ length: 40 }, (_, i) => `+const x${String(i)} = ${String(i)};`).join(
      '\n',
    );
    const stdout = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,5 +1,45 @@',
      body,
      'diff --git a/src/b.ts b/src/b.ts',
      'index 333..444 100644',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
    ].join('\n');
    const compressed = compressShellOutput({
      stdout,
      stderr: '',
      command: 'git diff HEAD~1',
    });
    expect(compressed.text).toContain('diff --git a/src/a.ts');
    expect(compressed.text).toContain('diff --git a/src/b.ts');
    expect(compressed.text).toContain('diff body lines omitted');
    expect(compressed.text.length).toBeLessThan(stdout.length);
    expect(compressed.savedPercent).toBeGreaterThan(0);
  });

  it('compressShellOutput collapses long dependency trees', () => {
    const stdout = Array.from(
      { length: 100 },
      (_, i) => `├── pkg-${String(i)}@1.0.${String(i)}`,
    ).join('\n');
    for (const command of [
      'pnpm list',
      'npm ls',
      'yarn why lodash',
      'cargo tree',
      'pip freeze',
      'pnpm audit',
      'npm audit',
      'go mod graph',
      'cargo audit',
    ]) {
      const compressed = compressShellOutput({
        stdout,
        stderr: '',
        command,
      });
      expect(compressed.text, command).toContain('dependency tree lines omitted');
      expect(compressed.savedPercent, command).toBeGreaterThan(0);
      expect(compressed.text.length, command).toBeLessThan(stdout.length);
    }
  });

  it('compressShellOutput collapses long next/vite/webpack build dumps', () => {
    const stdout = Array.from(
      { length: 100 },
      (_, i) => `chunk ${String(i)} 1.2 kB  [rendered]`,
    ).join('\n');
    for (const command of ['next build', 'vite build', 'webpack --mode production', 'turbo run build']) {
      const compressed = compressShellOutput({
        stdout,
        stderr: '',
        command,
      });
      // Build dumps reuse the test/build collapse path (passing-line + head/tail via maxChars).
      expect(compressed.text.length, command).toBeLessThan(stdout.length);
      expect(compressed.savedPercent, command).toBeGreaterThan(0);
    }
  });
});
