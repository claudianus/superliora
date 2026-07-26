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
    expect(detectShellDedicatedBypass('head -c 100 foo.bin')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('tail -c +10 bar.bin')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('less src/index.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('more README.md')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('most docs/guide.md')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('nl src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('nl -ba src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('nl -n ln src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('nl -w 3 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('/usr/bin/nl -n ln src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('less -N src/a.ts')?.prefer).toBe('Read');
    // bare pagers / flag-only forms stay allowed (interactive)
    expect(detectShellDedicatedBypass('nl -n ln')).toBeUndefined();
    expect(detectShellDedicatedBypass('less -N')).toBeUndefined();
    expect(detectShellDedicatedBypass('w3m index.html')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('w3m -dump index.html')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('lynx notes.html')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('lynx -dump notes.html')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('elinks page.html')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('elinks -dump page.html')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('zcat archive.gz')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('gzcat log.gz')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('bzcat data.bz2')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('xzcat data.xz')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('zstdcat data.zst')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('lzcat data.lz')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('/usr/bin/lzcat data.lz')?.prefer).toBe('Read');
    // Real URLs stay allowed for text-browser browsing (even with -dump).
    expect(detectShellDedicatedBypass('w3m https://example.com')).toBeUndefined();
    expect(detectShellDedicatedBypass('w3m -dump https://example.com')).toBeUndefined();
    expect(detectShellDedicatedBypass('lynx http://example.com/docs')).toBeUndefined();
    expect(detectShellDedicatedBypass('lynx -dump http://example.com/docs')).toBeUndefined();
    // Pipelines stay allowed for real shell composition.
    expect(detectShellDedicatedBypass('zcat archive.gz | head')).toBeUndefined();
    // Clipboard file dumps/loads prefer Read/Write; bare/pipeline clipboard stays allowed.
    expect(detectShellDedicatedBypass('pbcopy < src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('wl-copy < notes.md')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('pbpaste > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('xclip src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('xsel notes.md')?.prefer).toBe('Read');
    // pure file -> clipboard dumps prefer Read
    expect(detectShellDedicatedBypass('cat src/a.ts | pbcopy')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content src/a.ts | Set-Clipboard')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('type src\\a.ts | clip')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('cat notes.md | clip')?.prefer).toBe('Read');
    // non-file producers stay allowed
    expect(detectShellDedicatedBypass('echo hi | pbcopy')).toBeUndefined();
    expect(detectShellDedicatedBypass('echo hi | clip')).toBeUndefined();
    expect(detectShellDedicatedBypass('pbcopy')).toBeUndefined();
    // PowerShell clipboard file I/O (Unix pbcopy/pbpaste counterparts)
    expect(detectShellDedicatedBypass('Set-Clipboard -Path src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('scb -LiteralPath src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Set-Clipboard -Value (Get-Content src/a.ts)')?.prefer).toBe(
      'Read',
    );
    expect(detectShellDedicatedBypass('Get-Clipboard > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Get-Clipboard | Set-Content out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('gcb | Out-File notes.md')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('pbpaste | Set-Content out.txt')?.prefer).toBe('Write');
    // bare / interactive clipboard stays allowed
    expect(detectShellDedicatedBypass('Get-Clipboard')).toBeUndefined();
    expect(detectShellDedicatedBypass('Set-Clipboard -Value hello')).toBeUndefined();
    // sort/uniq/shuf single-file dumps prefer Read; multi-file / stdin stay allowed.
    expect(detectShellDedicatedBypass('sort src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('uniq notes.txt')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('shuf data.csv')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('gsort src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('sort -k 2 data.txt')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('sort -t , data.csv')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('sort --key=2 data.txt')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('uniq -f 1 notes.txt')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('sort -n a.txt b.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('sort -')).toBeUndefined();
    expect(detectShellDedicatedBypass('sort -k 2')).toBeUndefined();
    // look WORD FILE prefers Grep; bare look (system dict) stays allowed.
    expect(detectShellDedicatedBypass('look foo words.txt')?.prefer).toBe('Grep');
    expect(detectShellDedicatedBypass('look foo')).toBeUndefined();
    // iconv whole-file re-encode dumps prefer Read; stdin forms stay allowed.
    expect(detectShellDedicatedBypass('iconv -f utf-8 -t ascii//TRANSLIT notes.txt')?.prefer).toBe(
      'Read',
    );
    expect(detectShellDedicatedBypass('iconv -f utf-8 -t ascii//TRANSLIT')).toBeUndefined();
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
    // fd / fdfind / rg --files are file listers → Glob (not Grep).
    expect(detectShellDedicatedBypass('fd .ts src')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('fdfind --type f .')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('rg --files')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass("rg --files -g '*.ts'")?.prefer).toBe('Glob');
    // Content rg still prefers Grep.
    expect(detectShellDedicatedBypass('rg "error" packages')?.prefer).toBe('Grep');
    // ag / ack / ugrep content search → Grep.
    expect(detectShellDedicatedBypass('ag foo src')?.prefer).toBe('Grep');
    expect(detectShellDedicatedBypass('ack foo src')?.prefer).toBe('Grep');
    expect(detectShellDedicatedBypass('ugrep -r foo .')?.prefer).toBe('Grep');
    // git grep → Grep; git ls-files → Glob.
    expect(detectShellDedicatedBypass('git grep -n foo')?.prefer).toBe('Grep');
    expect(detectShellDedicatedBypass('git grep -n -- foo -- "*.ts"')?.prefer).toBe('Grep');
    expect(detectShellDedicatedBypass('git ls-files')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('git ls-files "*.ts"')?.prefer).toBe('Glob');
    // Windows search utilities prefer Grep; pipelines stay allowed.
    expect(detectShellDedicatedBypass('Select-String -Path src -Pattern foo')?.prefer).toBe(
      'Grep',
    );
    expect(detectShellDedicatedBypass('sls foo src/a.ts')?.prefer).toBe('Grep');
    expect(detectShellDedicatedBypass('findstr foo src/a.ts')?.prefer).toBe('Grep');
    expect(detectShellDedicatedBypass('findstr.exe /s /i foo *.ts')?.prefer).toBe('Grep');
    expect(detectShellDedicatedBypass('Get-ChildItem | Select-String foo')).toBeUndefined();
    // PowerShell Format-*/Out-String path dumps → Read; pipelines/bare stay allowed.
    expect(detectShellDedicatedBypass('Format-List -Path src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Format-Table Path,Length -Path src/a.ts')?.prefer).toBe(
      'Read',
    );
    expect(detectShellDedicatedBypass('Out-String -InputObject (Get-Content a.ts)')?.prefer).toBe(
      'Read',
    );
    expect(detectShellDedicatedBypass('Format-List')).toBeUndefined();
    // pure Get-Content path | Format-* dumps prefer Read
    expect(detectShellDedicatedBypass('Get-Content a.ts | Format-List')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content a.ts | Out-String')?.prefer).toBe('Read');
    // multi-pipe / real process left-hand side stay allowed
    expect(detectShellDedicatedBypass('Get-Process | Format-List')).toBeUndefined();
    // ConvertTo-Json / ConvertFrom-Json path dumps → Read; pipelines stay allowed.
    expect(detectShellDedicatedBypass('ConvertTo-Json -Path src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('ConvertFrom-Json -Path src/a.json')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('ConvertFrom-Json -LiteralPath config.json')?.prefer).toBe(
      'Read',
    );
    // pure Get-Content path | Convert*/Import-* dumps prefer Read
    expect(detectShellDedicatedBypass('Get-Content a.ts | ConvertTo-Json')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content a.json | ConvertFrom-Json')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content a.ts | ConvertTo-Csv')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content a.ts | ConvertTo-Html')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content a.ts | ConvertTo-Xml')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content a.xml | Select-Xml -XPath //x')?.prefer).toBe(
      'Read',
    );
    // analysis/count pipes stay allowed
    expect(detectShellDedicatedBypass('Get-Content a.ts | Measure-Object')).toBeUndefined();
    expect(detectShellDedicatedBypass('cat a.ts | wc -l')).toBeUndefined();
    // Import-Csv / Export-Csv path dumps → Read/Write; pure Get-Content pipes prefer Read.
    expect(detectShellDedicatedBypass('Import-Csv -Path data.csv')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('ipcsv report.csv')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('ConvertFrom-Csv -Path data.csv')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Export-Csv -Path out.csv')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('epcsv results.csv')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('ConvertTo-Csv -Path out.csv')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Get-Content data.csv | Import-Csv')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Process | Export-Csv out.csv')).toBeUndefined();
    // Import-Clixml / Export-Clixml path dumps → Read/Write; pure Get-Content pipes prefer Read.
    expect(detectShellDedicatedBypass('Import-Clixml -Path state.clixml')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Export-Clixml -Path state.clixml')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Get-Content state.clixml | Import-Clixml')?.prefer).toBe(
      'Read',
    );
    expect(detectShellDedicatedBypass('Get-Process | Export-Clixml state.clixml')).toBeUndefined();
    // Select-Object path dumps → Read; pipelines stay allowed.
    expect(detectShellDedicatedBypass('Select-Object -Path src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('select -Path src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Select-Object -First 5 -Path src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Select-Object -LiteralPath src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Select-Object -InputObject (Get-Content a.ts)')?.prefer).toBe(
      'Read',
    );
    // pure Get-Content/Get-Item path | Select-Object dumps prefer Read
    expect(detectShellDedicatedBypass('Get-Content a.ts | Select-Object -First 5')?.prefer).toBe(
      'Read',
    );
    expect(detectShellDedicatedBypass('Get-Item src/a.ts | Select-Object Name')?.prefer).toBe(
      'Read',
    );
    // bare Select-Object stays allowed
    expect(detectShellDedicatedBypass('Select-Object -First 5')).toBeUndefined();
    // Format-Hex / Get-FileHash / Select-Xml path dumps → Read; pure Get-Content pipes prefer Read.
    expect(detectShellDedicatedBypass('Format-Hex -Path src/a.bin')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('fhx notes.md')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-FileHash -Path src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Select-Xml -Path config.xml')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content a.bin | Format-Hex')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-ChildItem | Get-FileHash')).toBeUndefined();
    // ConvertTo-Html -Path writes → Write; bare path dumps → Read; pipelines stay allowed.
    expect(detectShellDedicatedBypass('ConvertTo-Html -Path out.html')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('ConvertTo-Html report.html')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Process | ConvertTo-Html')).toBeUndefined();
    // Out-GridView path dumps → Read; pure Get-Content pipes prefer Read.
    expect(detectShellDedicatedBypass('Out-GridView -Path src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('ogv notes.md')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content a.ts | Out-GridView')?.prefer).toBe('Read');
    // Windows recursive listing prefers Glob; bare dir/gci navigation stays allowed.
    expect(detectShellDedicatedBypass('Get-ChildItem -Recurse -Filter *.ts')?.prefer).toBe(
      'Glob',
    );
    expect(detectShellDedicatedBypass('Get-ChildItem -Recurse')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('gci -Recurse -Filter *.ts')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('dir /s /b')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('dir /s /b *.ts')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('where /r . *.ts')?.prefer).toBe('Glob');
    // tree / ls -R recursive listing → Glob.
    expect(detectShellDedicatedBypass('tree')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('tree -L 3 src')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('ls -R packages')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('ls -laR')?.prefer).toBe('Glob');
    // macOS Spotlight / Unix locate name search → Glob.
    expect(detectShellDedicatedBypass('mdfind -name "*.ts"')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('mdfind -onlyin . kMDItemFSName == "*.ts"')?.prefer).toBe(
      'Glob',
    );
    expect(detectShellDedicatedBypass('locate "*.ts"')?.prefer).toBe('Glob');
    // Bash pathname expansion listing → Glob.
    expect(detectShellDedicatedBypass("compgen -G '*.ts'")?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('compgen -G "packages/**/*.ts"')?.prefer).toBe('Glob');
    // PowerShell name-only listing → Glob; bare navigation stays allowed.
    expect(detectShellDedicatedBypass('Get-ChildItem -Name src')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('gci -Name *.ts')?.prefer).toBe('Glob');
    expect(detectShellDedicatedBypass('Get-ChildItem src')).toBeUndefined();
    expect(detectShellDedicatedBypass('dir')).toBeUndefined();
    expect(detectShellDedicatedBypass('ls packages')).toBeUndefined();
    expect(detectShellDedicatedBypass('where.exe python')).toBeUndefined();
  });

  it('blocks simple echo/printf/cat redirects to files', () => {
    expect(detectShellDedicatedBypass('echo hello > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass("printf 'x' >> out.txt")?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('cat > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('echo hello 1> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass("printf 'x' 1>> out.txt")?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('cat 1> out.txt')?.prefer).toBe('Write');
  });

  it('blocks simple Write-Output/Write-Host redirects to files', () => {
    expect(detectShellDedicatedBypass('Write-Output hello > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Write-Host hi > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Write-Output hello >> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('write-output x > ./notes.md')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Write-Output hello 1> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Write-Host hi 1>> out.txt')?.prefer).toBe('Write');
    // stdout-only / real process composition stay allowed
    expect(detectShellDedicatedBypass('Write-Output hello')).toBeUndefined();
    expect(detectShellDedicatedBypass('Get-Process | Write-Output > out.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('Write-Output hello 2> err.txt')).toBeUndefined();
  });

  it('blocks pure identity/listing redirects to files', () => {
    expect(detectShellDedicatedBypass('pwd > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('hostname > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('whoami > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('date > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('uname -a > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('ls > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('dir > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Get-Location > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Get-ChildItem > out.txt')?.prefer).toBe('Write');
    // recursive/filter listings and real process work stay allowed
    expect(detectShellDedicatedBypass('ls -R > out.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('Get-ChildItem -Recurse > out.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('git status > out.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('pwd')).toBeUndefined();
  });

  it('blocks pure Get-Content/type redirects to files', () => {
    expect(detectShellDedicatedBypass('Get-Content a.ts > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('gc notes.md >> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('type a.ts > out.txt')?.prefer).toBe('Write');
    // bare single-file dumps prefer Read; stderr multi-redirect stays allowed
    expect(detectShellDedicatedBypass('Get-Content a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content a.ts 2> err.txt')).toBeUndefined();
  });

  it('blocks pure file pipes into pagers/head/tail', () => {
    expect(detectShellDedicatedBypass('cat src/a.ts | less')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('type src\\a.ts | more')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content src/a.ts | more')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('cat notes.md | head')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('cat notes.md | tail -n 5')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('gcat ./readme.md | nl')?.prefer).toBe('Read');
    // non-file left-hand side / multi-pipe / analysis stay allowed
    expect(detectShellDedicatedBypass('echo hi | less')).toBeUndefined();
    expect(detectShellDedicatedBypass('cat src/a.ts | head | wc -l')).toBeUndefined();
    expect(detectShellDedicatedBypass('cat src/a.ts | wc -l')).toBeUndefined();
  });

  it('blocks pure PowerShell producer pipes into file writers', () => {
    expect(detectShellDedicatedBypass('Write-Output x | Set-Content out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Write-Host x | Out-File out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass("echo hello | Out-File notes.md")?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass("Write-Output x | Tee-Object out.txt")?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass("'hello' | Set-Content out.txt")?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('"hello" | Add-Content out.txt')?.prefer).toBe('Write');
    expect(
      detectShellDedicatedBypass('Write-Output x | Set-Content -Path out.txt')?.prefer,
    ).toBe('Write');
    expect(detectShellDedicatedBypass('echo hi | sponge out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass("printf %s hi | tee out.txt")?.prefer).toBe('Write');
    // pure file dumps into write sinks prefer Write
    expect(detectShellDedicatedBypass('Get-Content a.txt | Set-Content b.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Get-Content a.ts | Out-File out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('type a.ts | Out-File out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('cat a.ts | tee out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('cat a.ts | sponge out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('bat a.ts | sponge out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('bat a.ts | tee out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('tac a.ts | Set-Content out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('pygmentize a.ts | Out-File out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('glow README.md | sponge out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('mdcat docs/guide.md | tee out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('rich src/a.py | Set-Content out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('python -m rich.syntax src/a.py | Out-File out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('head -n 5 a.ts | tee out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('tail -n 5 a.ts | Set-Content out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('nl a.ts | Out-File out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('base64 a.ts | Set-Content out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('hexdump -C a.ts | Set-Content out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('less a.ts | tee out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('jq . a.json | Set-Content out.json')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('yq . a.yaml | Out-File out.yaml')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('python -m json.tool a.json | Set-Content out.json')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('python3 -m json.tool a.json | tee out.json')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('gc notes.md | Add-Content out.txt')?.prefer).toBe('Write');
    // real process left-hand side / multi-pipe / no path stay allowed
    expect(detectShellDedicatedBypass('Get-Process | Set-Content out.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('Write-Output x | Set-Content out.txt | Measure-Object')).toBeUndefined();
    expect(detectShellDedicatedBypass('Write-Output x | Set-Content')).toBeUndefined();
    expect(detectShellDedicatedBypass('Get-Content a.ts | Set-Content b.ts | Measure-Object')).toBeUndefined();
  });

  it('blocks Write-* stream redirects to files', () => {
    expect(detectShellDedicatedBypass('Write-Verbose hi > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Write-Warning hi > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Write-Error hi >> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Write-Information hi > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Write-Debug hi > out.txt')?.prefer).toBe('Write');
    // stdout-only stays allowed
    expect(detectShellDedicatedBypass('Write-Verbose hi')).toBeUndefined();
    expect(detectShellDedicatedBypass('Write-Warning hi')).toBeUndefined();
  });

  it('blocks constant producer pipes into file writers', () => {
    expect(detectShellDedicatedBypass('$null | Set-Content out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('0 | Set-Content out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('1..3 | Out-File notes.md')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('1.5 | Add-Content out.txt')?.prefer).toBe('Write');
    // real process left-hand side stays allowed
    expect(detectShellDedicatedBypass('Get-Date | Out-File out.txt')).toBeUndefined();
  });

  it('blocks here-string producer pipes into file writers', () => {
    expect(detectShellDedicatedBypass("@'hello'@ | Set-Content out.txt")?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('@"hello"@ | Out-File notes.md')?.prefer).toBe('Write');
    expect(
      detectShellDedicatedBypass("@'line1\nline2'@ | Add-Content out.txt")?.prefer,
    ).toBe('Write');
  });

  it('blocks Start-Transcript path dumps but allows Stop-Transcript', () => {
    expect(detectShellDedicatedBypass('Start-Transcript -Path log.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Start-Transcript -LiteralPath ./session.log')?.prefer).toBe(
      'Write',
    );
    expect(detectShellDedicatedBypass('Start-Transcript log.txt')?.prefer).toBe('Write');
    // path-less / stop stay allowed
    expect(detectShellDedicatedBypass('Start-Transcript')).toBeUndefined();
    expect(detectShellDedicatedBypass('Stop-Transcript')).toBeUndefined();
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
    expect(detectShellDedicatedBypass('cut -d, -f1 data.csv')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('cut -c1-10 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('/usr/bin/cut -f1 notes.txt')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass("sed -n '1,20p' src/a.ts")?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass("gsed -n '1,20p' src/a.ts")?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass("busybox sed -n '1,20p' src/a.ts")?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass("/usr/bin/sed -n '1,5p' src/a.ts")?.prefer).toBe('Read');
    // stdin / expression-only forms stay allowed
    expect(detectShellDedicatedBypass("sed -n '1,20p'")).toBeUndefined();
    expect(detectShellDedicatedBypass('sed -n')).toBeUndefined();
    expect(detectShellDedicatedBypass('awk 1 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass("awk '{print}' src/a.ts")?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('gawk 1 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('nawk 1 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('busybox awk 1 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass("/usr/bin/awk -F, '{print $1}' data.csv")?.prefer).toBe(
      'Read',
    );
    // stdin / program-only forms stay allowed
    expect(detectShellDedicatedBypass('awk 1')).toBeUndefined();
    expect(detectShellDedicatedBypass("awk '{print}'")).toBeUndefined();
    expect(detectShellDedicatedBypass('base64 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('base32 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('base64 -d encoded.b64')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('base64 --decode encoded.b64')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('base32 -d encoded.b32')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('base32 --decode encoded.b32')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('/usr/bin/base64 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('hexdump -C src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('od -An -tx1 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('xxd src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('xxd -l 100 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('strings src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('/usr/bin/strings -n 8 src/a.ts')?.prefer).toBe('Read');
    // multi-file paste and pipelines stay allowed; bare dumpers without a path too
    expect(detectShellDedicatedBypass('paste src/a.ts src/b.ts')).toBeUndefined();
    expect(detectShellDedicatedBypass('cut -f1')).toBeUndefined();
    expect(detectShellDedicatedBypass('cut -f1 -')).toBeUndefined();
    expect(detectShellDedicatedBypass('cut -f1 a.txt b.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('cat src/a.ts | base64')).toBeUndefined();
    expect(detectShellDedicatedBypass('od -An -tx1')).toBeUndefined();
    expect(detectShellDedicatedBypass('strings')).toBeUndefined();
    expect(detectShellDedicatedBypass('base64 -d')).toBeUndefined();
    expect(detectShellDedicatedBypass('base64 --decode')).toBeUndefined();
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
    // pure file dump → sponge prefers Write; non-file producer pipes stay allowed
    expect(detectShellDedicatedBypass('cat src/a.ts | sponge out.txt')?.prefer).toBe('Write');
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
    // pure Get-Content path | Select-Object dumps prefer Read
    expect(detectShellDedicatedBypass('Get-Content src/a.ts | Select-Object -First 5')?.prefer).toBe(
      'Read',
    );
    // PowerShell single-file writes prefer Write; pure file-dump pipes also prefer Write.
    expect(detectShellDedicatedBypass('Set-Content out.txt -Value hello')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Out-File -Path out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Add-Content notes.md more')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Get-Content a.ts | Set-Content b.ts')?.prefer).toBe('Write');
  });

  it('blocks PowerShell Get-Item single-file dumps but allows dirs/pipelines', () => {
    expect(detectShellDedicatedBypass('Get-Item src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('gi packages/foo/bar.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Item .\\src\\a.ts')?.prefer).toBe('Read');
    // pure Get-Item/Get-FileHash path | Format-*/Select-Object dumps prefer Read
    expect(detectShellDedicatedBypass('Get-Item src/a.ts | Format-List')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Item src/a.ts | Select-Object *')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-FileHash src/a.ts | Format-List')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-FileHash src/a.ts | fl')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content src/a.ts | Out-Host')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content src/a.ts | Out-Null')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-Content src/a.ts | Out-Printer')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('Get-ChildItem src/a.ts | Format-List')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('gci notes.md | Select-Object *')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('certutil -hashfile src/a.ts SHA256')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('certutil.exe -hashfile notes.md MD5')?.prefer).toBe('Read');
    // directory navigation and multi-file/process work stay allowed
    expect(detectShellDedicatedBypass('Get-Item .')).toBeUndefined();
    expect(detectShellDedicatedBypass('Get-Item src')).toBeUndefined();
    expect(detectShellDedicatedBypass('Get-Item -Recurse src')).toBeUndefined();
    expect(detectShellDedicatedBypass('Get-ChildItem | Get-FileHash')).toBeUndefined();
    expect(detectShellDedicatedBypass('Get-ChildItem src | Format-List')).toBeUndefined();
    expect(detectShellDedicatedBypass('Get-ChildItem | Format-List')).toBeUndefined();
  });

  it('blocks PowerShell Clear-Content / New-Item File / Copy-Item writes', () => {
    expect(detectShellDedicatedBypass('Clear-Content out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('clc -Path notes.md')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('New-Item -ItemType File empty.ts')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('ni out.txt -ItemType File')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('New-Item empty.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('New-Item -Path ./notes.md')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Copy-Item src/a.ts dest/a.ts')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('ci src/a.ts dest/a.ts')?.prefer).toBe('Write');
    // directories / recursive / pipelines stay allowed
    expect(detectShellDedicatedBypass('New-Item -ItemType Directory dir')).toBeUndefined();
    expect(detectShellDedicatedBypass('Copy-Item -Recurse src dest')).toBeUndefined();
    expect(detectShellDedicatedBypass('Clear-Content a.txt | Out-Null')).toBeUndefined();
  });

  it('blocks PowerShell Tee-Object single-file writes', () => {
    expect(detectShellDedicatedBypass('Tee-Object out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Tee-Object -FilePath notes.md')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('tee -Path src/a.ts')?.prefer).toBe('Write');
    // clipboard → Tee-Object file dumps (composition guard would otherwise skip)
    expect(detectShellDedicatedBypass('Get-Clipboard | Tee-Object out.txt')?.prefer).toBe('Write');
    // pure file dump → Tee-Object prefers Write; bare Tee-Object stays allowed
    expect(detectShellDedicatedBypass('Get-Content a.ts | Tee-Object out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('Tee-Object')).toBeUndefined();
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

  it('strips powershell/pwsh/cmd one-shot wrappers for file I/O', () => {
    expect(detectShellDedicatedBypass('powershell -Command Get-Content src/a.ts')?.prefer).toBe(
      'Read',
    );
    expect(detectShellDedicatedBypass('powershell.exe -NoProfile -Command Get-Content src/a.ts')?.prefer).toBe(
      'Read',
    );
    expect(detectShellDedicatedBypass("pwsh -c 'Get-Content src/a.ts'")?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('pwsh -Command "Set-Content out.txt -Value hello"')?.prefer).toBe(
      'Write',
    );
    expect(detectShellDedicatedBypass('cmd /c type src\\a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('cmd.exe /C "type src\\a.ts"')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('type.exe src\\a.ts')?.prefer).toBe('Read');
    // interactive hosts / non-file work stay allowed
    expect(detectShellDedicatedBypass('powershell')).toBeUndefined();
    expect(detectShellDedicatedBypass('pwsh -NoProfile')).toBeUndefined();
    expect(detectShellDedicatedBypass('cmd /c pnpm test')).toBeUndefined();
  });

  it('blocks jq/yq/json.tool whole-file dumps', () => {
    expect(detectShellDedicatedBypass('jq . package.json')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('jq package.json')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('yq . config.yaml')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('yq e . config.yaml')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('python3 -m json.tool package.json')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('/usr/bin/python3 -m json.tool data.json')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass("jq -r '.name' package.json")?.prefer).toBe('Read');
    // pipelines / stdin-only filters stay allowed
    expect(detectShellDedicatedBypass('cat package.json | jq .')).toBeUndefined();
    expect(detectShellDedicatedBypass('jq .')).toBeUndefined();
    expect(detectShellDedicatedBypass('jq -c .')).toBeUndefined();
    expect(detectShellDedicatedBypass('yq e .')).toBeUndefined();
    expect(detectShellDedicatedBypass('python3 -m json.tool')).toBeUndefined();
    expect(detectShellDedicatedBypass('python -m json.tool -')).toBeUndefined();
  });

  it('blocks empty redirect file creators', () => {
    expect(detectShellDedicatedBypass(': > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('true > out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass(':>out.txt')?.prefer).toBe('Write');
    // Explicit stdout fd forms (`1>` / `1>>`) are the same empty-file shape.
    expect(detectShellDedicatedBypass(': 1> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('true 1> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('false 1>> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('1> out.txt')?.prefer).toBe('Write');
    expect(detectShellDedicatedBypass('1>> out.txt')?.prefer).toBe('Write');
    // stderr / multi-redirect real shell work stays allowed
    expect(detectShellDedicatedBypass(': 2> err.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('true 2> err.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('true > out.txt && echo hi')).toBeUndefined();
  });

  it('blocks text formatter whole-file dumps', () => {
    expect(detectShellDedicatedBypass('fmt src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('fmt -w 80 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('pr -n src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('fold -w 80 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('expand src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('unexpand src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('column -t src/a.ts')?.prefer).toBe('Read');
    // line/byte metrics stay allowed; single-file hash dumps prefer Read
    expect(detectShellDedicatedBypass('wc -l src/a.ts')).toBeUndefined();
    expect(detectShellDedicatedBypass('sha256sum src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('md5sum src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('sha1sum notes.md')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('cksum src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('shasum -a 256 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('openssl dgst -sha256 src/a.ts')?.prefer).toBe('Read');
    // stdin / check modes / multi-file / globs / multi-pipe stay allowed
    expect(detectShellDedicatedBypass('md5sum')).toBeUndefined();
    expect(detectShellDedicatedBypass('sha256sum -c checksums.txt')).toBeUndefined();
    expect(detectShellDedicatedBypass('cat src/a.ts | sha256sum')).toBeUndefined();
    expect(detectShellDedicatedBypass('md5sum a.ts b.ts')).toBeUndefined();
    expect(detectShellDedicatedBypass('sha256sum *.ts')).toBeUndefined();
    expect(detectShellDedicatedBypass('cksum a.ts b.ts')).toBeUndefined();
  });

  it('routes macOS md5 / gsha256sum / openssl md5 / node -p / plutil dumps to Read', () => {
    expect(detectShellDedicatedBypass('md5 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('md5 -q src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('md5 -r src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('/sbin/md5 src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('gsha256sum src/a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('openssl md5 src/a.ts')?.prefer).toBe('Read');
    expect(
      detectShellDedicatedBypass(
        'node -p "require(\'fs\').readFileSync(\'src/a.ts\',\'utf8\')"',
      )?.prefer,
    ).toBe('Read');
    expect(detectShellDedicatedBypass('plutil -p Info.plist')?.prefer).toBe('Read');
    expect(
      detectShellDedicatedBypass('plutil -convert xml1 -o - Info.plist')?.prefer,
    ).toBe('Read');

    // Multi-file / non-dump forms stay allowed.
    expect(detectShellDedicatedBypass('md5 a.ts b.ts')).toBeUndefined();
    expect(detectShellDedicatedBypass("md5 -s 'hello'")).toBeUndefined();
    expect(detectShellDedicatedBypass('plutil -convert xml1 Info.plist')).toBeUndefined();
    expect(detectShellDedicatedBypass('node -p "1+1"')).toBeUndefined();
  });

  it('routes node --eval/--print, bun/deno, PlistBuddy Print, xmllint dumps to Read', () => {
    expect(
      detectShellDedicatedBypass(
        'node --eval "require(\'fs\').readFileSync(\'src/a.ts\')"',
      )?.prefer,
    ).toBe('Read');
    expect(
      detectShellDedicatedBypass(
        'node --print "require(\'fs\').readFileSync(\'src/a.ts\',\'utf8\')"',
      )?.prefer,
    ).toBe('Read');
    expect(
      detectShellDedicatedBypass(
        'bun -e "console.log(await Bun.file(\'src/a.ts\').text())"',
      )?.prefer,
    ).toBe('Read');
    expect(
      detectShellDedicatedBypass(
        'deno eval "console.log(Deno.readTextFileSync(\'src/a.ts\'))"',
      )?.prefer,
    ).toBe('Read');
    expect(detectShellDedicatedBypass('PlistBuddy -c Print Info.plist')?.prefer).toBe('Read');
    expect(
      detectShellDedicatedBypass('/usr/libexec/PlistBuddy -c Print Info.plist')?.prefer,
    ).toBe('Read');
    expect(detectShellDedicatedBypass('xmllint --format a.xml')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('xmllint a.xml')?.prefer).toBe('Read');

    // Non-dump / mutating forms stay allowed.
    expect(detectShellDedicatedBypass('node --eval "1+1"')).toBeUndefined();
    expect(detectShellDedicatedBypass('PlistBuddy -c "Set :k v" Info.plist')).toBeUndefined();
    expect(detectShellDedicatedBypass('xmllint --shell a.xml')).toBeUndefined();
  });

  it('routes perl -nE/-pE/-lne and ruby -ne/-pe/-npe single-file dumps to Read', () => {
    expect(detectShellDedicatedBypass('perl -ne "print" a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('perl -nE "print" a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('perl -pE "" a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('perl -lne "print" a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('ruby -ne "puts $_" a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('ruby -pe "" a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('ruby -npe "" a.ts')?.prefer).toBe('Read');
    expect(detectShellDedicatedBypass('ruby -ane "puts $_" a.ts')?.prefer).toBe('Read');

    // Scripts / multi-file / in-place stay allowed.
    expect(detectShellDedicatedBypass('perl script.pl')).toBeUndefined();
    expect(detectShellDedicatedBypass('ruby script.rb')).toBeUndefined();
    expect(detectShellDedicatedBypass('perl -i -pe "s/a/b/" a.ts')?.prefer).toBe('Edit');
  });

