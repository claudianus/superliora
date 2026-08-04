import { describe, expect, it } from 'vitest';

import { classifyCommandOutput } from '../../../src/tools/display/classify-command-output';

function classify(command: string, output: string, exitCode = 0) {
  return classifyCommandOutput({ command, output, exitCode, durationMs: 1234 });
}

describe('classifyCommandOutput — test runners', () => {
  it('reads vitest counts and failing files', () => {
    const out = [
      ' FAIL  |kimi-core| test/tools/plan-mode-hard-block.test.ts > rejects skip',
      '',
      ' Test Files  2 failed | 6 passed (8)',
      '      Tests  2 failed | 237 passed (239)',
      '   Duration  1.82s',
    ].join('\n');
    const display = classify('pnpm exec vitest run', out, 1);
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.tool).toBe('vitest');
    expect(display.passed).toBe(237);
    expect(display.failed).toBe(2);
    expect(display.exit_code).toBe(1);
    expect(display.duration_ms).toBe(1234);
    expect(display.findings?.[0]?.file).toBe('test/tools/plan-mode-hard-block.test.ts');
  });

  it('reads a fully green vitest run with no findings', () => {
    const display = classify('vitest run', '      Tests  239 passed (239)\n');
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.passed).toBe(239);
    expect(display.failed).toBeUndefined();
    expect(display.findings).toBeUndefined();
  });

  it('reads jest counts', () => {
    const display = classify('npx jest', 'Tests:       1 failed, 2 passed, 3 total\n', 1);
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.tool).toBe('jest');
    expect(display.failed).toBe(1);
    expect(display.passed).toBe(2);
  });

  it('reads pytest counts', () => {
    const display = classify(
      'pytest -q',
      '==================== 2 failed, 5 passed, 1 skipped in 1.23s ====================\n',
      1,
    );
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.tool).toBe('pytest');
    expect(display.failed).toBe(2);
    expect(display.passed).toBe(5);
    expect(display.skipped).toBe(1);
  });

  it('reads go test failures', () => {
    const out = ['--- FAIL: TestAlpha (0.00s)', '--- PASS: TestBeta (0.01s)', 'FAIL'].join('\n');
    const display = classify('go test ./...', out, 1);
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.tool).toBe('go test');
    expect(display.failed).toBe(1);
    expect(display.passed).toBe(1);
    expect(display.findings?.[0]?.file).toBe('TestAlpha');
  });

  it('reads cargo test counts', () => {
    const display = classify(
      'cargo test',
      'test result: FAILED. 3 passed; 1 failed; 2 ignored; 0 measured\n',
      101,
    );
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.tool).toBe('cargo test');
    expect(display.passed).toBe(3);
    expect(display.failed).toBe(1);
    expect(display.skipped).toBe(2);
  });
});

describe('classifyCommandOutput — typecheck and lint', () => {
  it('reads tsc diagnostics with file and line', () => {
    const out = [
      'src/a.ts(12,3): error TS2304: Cannot find name "foo".',
      'src/b.ts(4,9): error TS2322: Type mismatch.',
      '',
      'Found 2 errors in 2 files.',
    ].join('\n');
    const display = classify('tsc --noEmit', out, 2);
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.tool).toBe('tsc');
    expect(display.failed).toBe(2);
    expect(display.findings?.[0]).toEqual({
      file: 'src/a.ts',
      line: 12,
      message: 'TS2304: Cannot find name "foo".',
    });
  });

  it('reads eslint problem counts and error rows', () => {
    const out = [
      '/repo/src/a.ts',
      '  12:3  error  Unexpected any  @typescript-eslint/no-explicit-any',
      '  20:1  warning  Missing return type  @typescript-eslint/explicit-function-return-type',
      '',
      '✖ 2 problems (1 error, 1 warning)',
    ].join('\n');
    const display = classify('eslint .', out, 1);
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.tool).toBe('eslint');
    expect(display.failed).toBe(1);
    expect(display.warnings).toBe(1);
    expect(display.findings?.[0]).toEqual({
      file: '/repo/src/a.ts',
      line: 12,
      message: 'Unexpected any',
    });
  });

  it('reads ruff error counts', () => {
    const display = classify('ruff check .', 'Found 5 errors.\n', 1);
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.tool).toBe('ruff');
    expect(display.failed).toBe(5);
  });
});

describe('classifyCommandOutput — git and install', () => {
  it('summarizes a diffstat', () => {
    const display = classify(
      'git diff --stat',
      ' src/a.ts | 4 ++--\n 3 files changed, 42 insertions(+), 10 deletions(-)\n',
    );
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.tool).toBe('git');
    expect(display.summary).toBe('3 files · +42 · −10');
  });

  it('summarizes porcelain status paths', () => {
    const display = classify('git status --porcelain', ' M src/a.ts\n?? src/b.ts\n');
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.summary).toBe('2 changed paths');
    expect(display.findings?.[0]).toEqual({ file: 'src/a.ts', message: 'M' });
  });

  it('reports a clean tree', () => {
    const display = classify('git status', 'On branch main\nnothing to commit, working tree clean\n');
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.summary).toBe('Working tree clean');
  });

  it('summarizes a pnpm install', () => {
    const display = classify('pnpm install', 'Packages: +12\n++++++++++++\nDone in 3.1s\n');
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.tool).toBe('install');
    expect(display.summary).toBe('+12 packages');
  });
});

describe('classifyCommandOutput — fallback', () => {
  it('falls back to command_output with a bounded tail', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${String(i)}`).join('\n');
    const display = classify('echo hi', lines);
    expect(display.kind).toBe('command_output');
    if (display.kind !== 'command_output') return;
    expect(display.exit_code).toBe(0);
    expect(display.stdout?.split('\n')).toHaveLength(6);
    expect(display.stdout?.endsWith('line 39')).toBe(true);
  });

  it('records -1 when the process never reported an exit code', () => {
    const display = classifyCommandOutput({
      command: 'sleep 100',
      output: 'killed',
      exitCode: undefined,
    });
    expect(display.kind).toBe('command_output');
    if (display.kind !== 'command_output') return;
    expect(display.exit_code).toBe(-1);
  });

  it('strips ANSI before matching so colored runner output still classifies', () => {
    const display = classify(
      'vitest run',
      '      \u001B[32mTests\u001B[0m  \u001B[1m5 passed\u001B[0m (5)\n',
    );
    expect(display.kind).toBe('check_report');
    if (display.kind !== 'check_report') return;
    expect(display.passed).toBe(5);
  });
});
