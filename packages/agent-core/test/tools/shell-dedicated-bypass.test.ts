import { describe, expect, it } from 'vitest';

import {
  detectShellDedicatedBypass,
  formatShellDedicatedBypassError,
  SHELL_DEDICATED_BYPASS_FORCE_PREFIX,
} from '../../src/tools/policies/shell-dedicated-bypass';

describe('detectShellDedicatedBypass', () => {
  it('blocks simple cat/head/tail file reads', () => {
    expect(detectShellDedicatedBypass('cat src/index.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('head -n 20 foo.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('tail -50 bar.md')?.prefer).toBe('Read');
  });

  it('blocks sed -i and grep/rg/find', () => {
    expect(detectShellDedicatedBypass("sed -i 's/a/b/' file.ts")?.prefer).toBe('Edit');
    expect(detectShellDedicatedBypass('grep -n foo src')?.prefer).toBe('Grep');
    expect(detectShellDedicatedBypass('rg "error" packages')?.prefer).toBe('Grep');
    expect(detectShellDedicatedBypass("find . -name '*.ts'")?.prefer).toBe('Glob');
  });

  it('blocks simple echo/printf/cat redirects to files', () => {
    expect(detectShellDedicatedBypass('echo hello > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass("printf 'x' >> out.txt")?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('cat > out.txt')?.prefer).toBe('Write');
  });

  it('allows pipelines, && chains, and real process work', () => {
    expect(detectShellDedicatedBypass('cat file | head')).toBeUndefined();
    expect(detectShellDedicatedBypass('cd src && cat index.ts')).toBeUndefined();
    expect(detectShellDedicatedBypass('pnpm test')).toBeUndefined();
    expect(detectShellDedicatedBypass('git status')).toBeUndefined();
    expect(detectShellDedicatedBypass('ls -la')).toBeUndefined();
    expect(detectShellDedicatedBypass('node scripts/build.mjs')).toBeUndefined();
    expect(detectShellDedicatedBypass('pnpm test 2>/dev/null')).toBeUndefined();
    expect(detectShellDedicatedBypass('cmd >out 2>&1')).toBeUndefined();
  });

  it('allows LIORA_FORCE_BASH escape hatch', () => {
    expect(
      detectShellDedicatedBypass(`${SHELL_DEDICATED_BYPASS_FORCE_PREFIX} cat secret-path`),
    ).toBeUndefined();
  });

  it('formats a clear error pointing at the preferred tool', () => {
    const hit = detectShellDedicatedBypass('cat foo.ts');
    expect(hit).toBeDefined();
    const msg = formatShellDedicatedBypassError(hit!);
    expect(msg).toContain('Read');
    expect(msg).toContain(SHELL_DEDICATED_BYPASS_FORCE_PREFIX);
  });

  it('blocks simple cat/tee heredoc file writes', () => {
    expect(detectShellDedicatedBypass('cat > out.txt <<EOF\nhello\nEOF')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass("cat <<'EOF' > out.txt\nx\nEOF")?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('tee out.txt <<EOF\nbody\nEOF')?.prefer).toBe('Write');
  });

});
