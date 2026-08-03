import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const scriptPath = join(repoRoot, 'scripts', 'check-retire-guardrails.mjs');
const REGISTRY_REL = 'docs/specs/2026-08-03-retirement-registry.yaml';

/**
 * Runs the guardrail script against `cwd`. The script derives its repo root
 * from its own location (`<root>/scripts/check-retire-guardrails.mjs`), so
 * fixture trees copy the script into `<fixture>/scripts/` first.
 */
async function runGuardrails(cwd: string): Promise<{ exitCode: number; output: string }> {
  const script = join(cwd, 'scripts', 'check-retire-guardrails.mjs');
  try {
    const result = await promisify(execFile)(process.execPath, [script], { cwd });
    return { exitCode: 0, output: `${result.stdout}\n${result.stderr}` };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      output: `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`,
    };
  }
}

const fixtures: string[] = [];

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'retire-guardrails-'));
  fixtures.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(scriptPath, join(root, 'scripts', 'check-retire-guardrails.mjs'));
  return root;
}

function writeRegistry(root: string, text: string): void {
  const registryPath = join(root, REGISTRY_REL);
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, text, 'utf8');
}

function writeSource(root: string, relPath: string, text: string): void {
  const filePath = join(root, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${text}\n`, 'utf8');
}

afterAll(() => {
  for (const fixture of fixtures) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe('retire-guardrails gate (V6-7)', () => {
  it('passes on the real repo tree and reports the enforced waves', async () => {
    const { exitCode, output } = await runGuardrails(repoRoot);
    expect(exitCode).toBe(0);
    expect(output).toContain('[R2-collaboration-shim]');
    expect(output).toContain('[R3-orchestrator-mode-stack]');
    expect(output).toContain('retire-guardrails: PASS');
  }, 60_000);

  it('passes a compliant done item (proof test present, grep_zero clean)', async () => {
    const root = makeFixture();
    writeRegistry(
      root,
      [
        'version: 1',
        'items:',
        '  - id: RX-fixture',
        '    status: done',
        '    commit: abc1234',
        "    replacement_proof_tests: [packages/fixture/test/proof.test.ts]",
        "    grep_zero: ['FORBIDDEN_RETIRE_SYMBOL']",
      ].join('\n'),
    );
    writeSource(root, 'packages/fixture/test/proof.test.ts', 'export const proof = true;');
    writeSource(root, 'packages/fixture/src/clean.ts', 'export const clean = true;');

    const { exitCode, output } = await runGuardrails(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('proof tests: 1/1 present');
    expect(output).toContain('grep_zero: 1 pattern(s), 0 hit(s) in src');
    expect(output).toContain('retire-guardrails: PASS');
  });

  it('fails when a done item violates grep_zero or loses its replacement proof', async () => {
    const root = makeFixture();
    writeRegistry(
      root,
      [
        'version: 1',
        'items:',
        '  - id: RX-fixture',
        '    status: done',
        '    commit: abc1234',
        "    replacement_proof_tests: [packages/fixture/test/proof.test.ts]",
        "    grep_zero: ['FORBIDDEN_RETIRE_SYMBOL']",
      ].join('\n'),
    );
    // Proof test intentionally missing; src file reintroduces the retired symbol.
    writeSource(root, 'packages/fixture/src/leak.ts', 'export const FORBIDDEN_RETIRE_SYMBOL = true;');

    const { exitCode, output } = await runGuardrails(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('replacement proof test missing: packages/fixture/test/proof.test.ts');
    expect(output).toContain('grep_zero "FORBIDDEN_RETIRE_SYMBOL" has 1 hit(s) in src');
    expect(output).toContain('packages/fixture/src/leak.ts:1');
    expect(output).toContain('retire-guardrails: FAIL');
  });

  it('fails on registry validation errors (duplicate ids, unknown status)', async () => {
    const root = makeFixture();
    writeRegistry(
      root,
      [
        'version: 1',
        'items:',
        '  - id: RX-dup',
        '    status: done',
        '  - id: RX-dup',
        '    status: done',
        '  - id: RX-weird',
        '    status: shipped',
      ].join('\n'),
    );

    const { exitCode, output } = await runGuardrails(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('registry error: duplicate item id: RX-dup');
    expect(output).toContain('registry error: RX-weird: unknown status "shipped"');
    expect(output).toContain('retire-guardrails: FAIL');
  });

  it('rejects an unsupported registry version', async () => {
    const root = makeFixture();
    writeRegistry(root, ['version: 2', 'items:'].join('\n'));

    const { exitCode, output } = await runGuardrails(root);
    expect(exitCode).toBe(2);
    expect(output).toContain('unsupported registry version: 2');
  });
});
