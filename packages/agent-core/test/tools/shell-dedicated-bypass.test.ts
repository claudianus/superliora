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


  it('blocks python/node/ruby one-liner file reads', () => {
    expect(
      detectShellDedicatedBypass("python -c \"print(open('src/a.ts').read())\"")?.prefer,
    ).toBe('Read');
    expect(
      detectShellDedicatedBypass("python3 -c \"print(open(\'src/a.ts\').read())\"")?.prefer,
    ).toBe('Read');
    expect(
      detectShellDedicatedBypass(
        "node -e \"console.log(require('fs').readFileSync('src/a.ts','utf8'))\"",
      )?.prefer,
    ).toBe('Read');
    expect(
      detectShellDedicatedBypass("ruby -e \"puts File.read('src/a.ts')\"")?.prefer,
    ).toBe('Read');
    // language write one-liners prefer Write
    expect(
      detectShellDedicatedBypass("python -c \"open('out.txt','w').write('x')\"")?.prefer,
    ).toBe('Write');
  });


  it('blocks php/perl/lua file-read one-liners', () => {
    expect(
      detectShellDedicatedBypass("php -r \"echo file_get_contents('src/a.ts');\"")?.prefer,
    ).toBe('Read');
    expect(
      detectShellDedicatedBypass("perl -e \"print File::Slurp::read_file('src/a.ts')\"")?.prefer,
    ).toBe('Read');
    expect(detectShellDedicatedBypass("perl -ne 'print' src/a.ts")?.prefer).toBe('Read');
    expect(
      detectShellDedicatedBypass("lua -e \"print(io.open('src/a.ts'):read('*a'))\"")?.prefer,
    ).toBe('Read');
  });


  it('blocks bat/tac/sed -n/awk/base64 whole-file dumps', () => {
    expect(detectShellDedicatedBypass('bat src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('tac src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass("sed -n '1,20p' src/a.ts")?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('awk 1 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('base64 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('hexdump -C src/a.ts')?.prefer).toBe('Read');
    // pipelines still allowed
    expect(detectShellDedicatedBypass('cat src/a.ts | base64')).toBeUndefined();
  });

});

  it('blocks language one-liner file writes', () => {
    expect(
      detectShellDedicatedBypass("python -c \"open('a.ts','w').write('x')\"")?.prefer,
    ).toBe('Write');
    expect(
      detectShellDedicatedBypass("node -e \"require('fs').writeFileSync('a.ts','x')\"")?.prefer,
    ).toBe('Write');
    expect(detectShellDedicatedBypass("ruby -e \"File.write('a.ts','x')\"")?.prefer).toBe('Write');
    expect(
      detectShellDedicatedBypass("php -r \"file_put_contents('a.ts','x');\"")?.prefer,
    ).toBe('Write');
    expect(
      detectShellDedicatedBypass("perl -e \"open F,'>a.ts'; print F 'x'\"")?.prefer,
    ).toBe('Write');
    expect(
      detectShellDedicatedBypass("lua -e \"io.open('a.ts','w'):write('x')\"")?.prefer,
    ).toBe('Write');
    // pipelines still allowed
    expect(
      detectShellDedicatedBypass("python -c \"open('a.ts','w').write('x')\" | cat"),
    ).toBeUndefined();
  });

