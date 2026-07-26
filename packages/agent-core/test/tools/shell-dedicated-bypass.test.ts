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
    expect(detectShellDedicatedBypass('less src/index.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('more README.md')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('most docs/guide.md')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('nl src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('w3m index.html')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('lynx notes.html')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('elinks page.html')?.prefer).toBe('Read');
    // Real URLs stay allowed for text-browser browsing.
    expect(detectShellDedicatedBypass('w3m https://example.com')).toBeUndefined();
    expect(detectShellDedicatedBypass('lynx http://example.com/docs')).toBeUndefined();
  });

  it('blocks sed -i and grep/rg/find', () => {
    expect(detectShellDedicatedBypass("sed -i 's/a/b/' file.ts")?.prefer).toBe('Edit');
    expect(detectShellDedicatedBypass("gsed -i 's/a/b/' file.ts")?.prefer).toBe('Edit');
    expect(detectShellDedicatedBypass("perl -pi -e 's/a/b/' file.ts")?.prefer).toBe('Edit');
    expect(detectShellDedicatedBypass("perl -i -pe 's/a/b/' file.ts")?.prefer).toBe('Edit');
    expect(
      detectShellDedicatedBypass("ruby -i -pe 'sub(/a/,\"b\")' file.ts")?.prefer,
    ).toBe('Edit');
    expect(
      detectShellDedicatedBypass("ruby -i.bak -pe 'sub(/a/,\"b\")' file.ts")?.prefer,
    ).toBe('Edit');
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
    expect(detectShellDedicatedBypass('rev src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('paste src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass("sed -n '1,20p' src/a.ts")?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('awk 1 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('base64 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('hexdump -C src/a.ts')?.prefer).toBe('Read');
    // multi-file paste and pipelines stay allowed
    expect(detectShellDedicatedBypass('paste src/a.ts src/b.ts')).toBeUndefined();
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
      detectShellDedicatedBypass("ruby -e \"File.open('a.ts','w'){|f|f.write('x')}\"")?.prefer,
    ).toBe('Write');
    expect(
      detectShellDedicatedBypass("php -r \"file_put_contents('a.ts','x');\"")?.prefer,
    ).toBe('Write');
    expect(
      detectShellDedicatedBypass("perl -e \"open F,'>a.ts'; print F 'x'\"")?.prefer,
    ).toBe('Write');
    expect(
      detectShellDedicatedBypass("lua -e \"io.open('a.ts','w'):write('x')\"")?.prefer,
    ).toBe('Write');
    expect(
      detectShellDedicatedBypass(
        "python -c \"from pathlib import Path; Path('a.ts').write_text('x')\"",
      )?.prefer,
    ).toBe('Write');
    expect(
      detectShellDedicatedBypass(
        "node -e \"require('fs').promises.writeFile('a.ts','x')\"",
      )?.prefer,
    ).toBe('Write');
    // pipelines still allowed
    expect(
      detectShellDedicatedBypass("python -c \"open('a.ts','w').write('x')\" | cat"),
    ).toBeUndefined();
  });

  it('blocks dd/install workspace file copies', () => {
    expect(detectShellDedicatedBypass('dd if=src/a.ts of=dest/a.ts')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('dd if=src/a.ts of=dest/a.ts bs=4k')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('install -m 644 src/a.ts dest/a.ts')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('install src/a.ts dest/a.ts')?.prefer).toBe('Write');
    // device / dir forms stay allowed
    expect(detectShellDedicatedBypass('dd if=/dev/zero of=out.bin bs=1 count=1')).toBeUndefined();
    expect(detectShellDedicatedBypass('install -d dest/')).toBeUndefined();
  });

  it('blocks truncate -s 0 empty-file writes', () => {
    expect(detectShellDedicatedBypass('truncate -s 0 out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('truncate --size=0 out.txt')?.prefer).toBe('Write');
    // non-zero sizes stay allowed (sparse allocate / intentional sizing)
    expect(detectShellDedicatedBypass('truncate -s 1M out.bin')).toBeUndefined();
  });

  it('blocks bare sponge and busybox cat/sed -i file I/O', () => {
    expect(detectShellDedicatedBypass('sponge out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('busybox cat src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass("busybox sed -i 's/a/b/' src/a.ts")?.prefer).toBe('Edit');
    expect(detectShellDedicatedBypass('busybox head -n 5 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('busybox tail -5 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('gcat src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('ghead -n 5 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('gtail -5 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('batcat src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('pygmentize src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('glow README.md')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('mdcat docs/guide.md')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('rich src/a.py')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('python -m rich.syntax src/a.py')?.prefer).toBe('Read');
    // pipelines stay allowed
    expect(detectShellDedicatedBypass('cat src/a.ts | sponge out.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('glow README.md | head')).toBeUndefined();
  });

  it('routes lua file-read one-liners to Read not Write', () => {
    expect(
      detectShellDedicatedBypass("lua -e \"print(io.open('a.ts'):read('*a'))\"")?.prefer,
    ).toBe('Read');
    expect(
      detectShellDedicatedBypass("lua -e \"io.open('a.ts','w'):write('x')\"")?.prefer,
    ).toBe('Write');
  });

  it('blocks Windows type/Get-Content single-file dumps', () => {
    expect(detectShellDedicatedBypass('type src\\a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('gc src/a.ts')?.prefer).toBe('Read');
    // pipelines stay allowed
    expect(detectShellDedicatedBypass('Get-Content src/a.ts | Select-Object -First 5')).toBeUndefined();
  });

  it('blocks git/svn/hg single-path content dumps but allows commit summaries', () => {
    expect(detectShellDedicatedBypass('git show HEAD:src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('git show abcdef1:packages/foo/bar.ts')?.prefer).toBe(
      'Read',
    );
    expect(detectShellDedicatedBypass('git cat-file -p HEAD:src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('svn cat file.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('hg cat file.ts')?.prefer).toBe('Read');
    // commit-level / metadata stays allowed
    expect(detectShellDedicatedBypass('git show HEAD')).toBeUndefined();
    expect(detectShellDedicatedBypass('git show --stat HEAD')).toBeUndefined();
    expect(detectShellDedicatedBypass('git cat-file -t HEAD')).toBeUndefined();
    expect(detectShellDedicatedBypass('git blame src/a.ts')).toBeUndefined();
  });

  it('blocks simple cp workspace copies but allows mv and recursive cp', () => {
    expect(detectShellDedicatedBypass('cp src/a.ts dest/a.ts')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('cp -p src/a.ts dest/a.ts')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('mv src/a.ts dest/a.ts')).toBeUndefined();
    expect(detectShellDedicatedBypass('cp -r src dest')).toBeUndefined();
    expect(detectShellDedicatedBypass('cp src/a.ts src/b.ts dest/')).toBeUndefined();
  });

  it('blocks simple local rsync two-path copies but allows archive/remote', () => {
    expect(detectShellDedicatedBypass('rsync src/a.ts dest/a.ts')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('rsync -a src/ dest/')).toBeUndefined();
    expect(detectShellDedicatedBypass('rsync -r src dest')).toBeUndefined();
    expect(detectShellDedicatedBypass('rsync src/a.ts host:dest/a.ts')).toBeUndefined();
  });

  it('strips leading process wrappers before dedicated-tool detection', () => {
    expect(detectShellDedicatedBypass('command cat src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('timeout 5 cat src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('stdbuf -oL cat src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('nice cat src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('nohup cat src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('\\cat src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('env cat src/a.ts')?.prefer).toBe('Read');
    // real shell work / meta commands stay allowed
    expect(detectShellDedicatedBypass('command -v cat')).toBeUndefined();
    expect(detectShellDedicatedBypass('env -i PATH=/usr/bin cat src/a.ts')).toBeUndefined();
    expect(detectShellDedicatedBypass('timeout 5 pnpm test')).toBeUndefined();
  });

  it('blocks jq/yq/json.tool whole-file dumps', () => {
    expect(detectShellDedicatedBypass('jq . package.json')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('yq . config.yaml')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('python3 -m json.tool package.json')?.prefer).toBe('Read');
    // pipelines / filters stay allowed
    expect(detectShellDedicatedBypass('cat package.json | jq .')).toBeUndefined();
    expect(detectShellDedicatedBypass("jq -r '.name' package.json")?.prefer).toBe('Read');
  });

  it('blocks empty redirect file creators', () => {
    expect(detectShellDedicatedBypass(': > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('true > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass(':>out.txt')?.prefer).toBe('Write');
    // real process work stays allowed
    expect(detectShellDedicatedBypass('true > out.txt && echo hi')).toBeUndefined();
  });

  it('blocks text formatter whole-file dumps', () => {
    expect(detectShellDedicatedBypass('fmt src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('pr -n src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('fold -w 80 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('expand src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('column -t src/a.ts')?.prefer).toBe('Read');
    // metrics / metadata stay allowed
    expect(detectShellDedicatedBypass('wc -l src/a.ts')).toBeUndefined();
    expect(detectShellDedicatedBypass('sha256sum src/a.ts')).toBeUndefined();
  });

