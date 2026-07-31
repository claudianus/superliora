/**
 * Whole-command scripting-language one-liners (python/node/bun/deno/ruby/php/perl/lua)
 * that only read or only write a single file via their -c/-e/-r flags.
 */

import type { ShellDedicatedBypassHit } from './types';

/**
 * Whole-command language one-liners that only read a file.
 * Matches: python -c open('path'), node -e readFileSync('path'), etc.
 * Skips: multi-statement scripts, network I/O, writes.
 */
export function matchLanguageReadLike(command: string): ShellDedicatedBypassHit | undefined {
  // Avoid multi-line scripts and shell lists/pipes. Language one-liners often
  // use `;` (php/perl) and `<` as open-mode strings — those are not shell composition.
  if (/[|`\n]/.test(command)) return undefined;
  if (/\b(?:&&|\|\|)\b/.test(command)) return undefined;

  // python/python3 -c "...open('path')..."
  if (/^(?:\/usr\/bin\/)?python3?(?:\d+(?:\.\d+)*)?\b/.test(command) && /(?:^|\s)-c(?:\s|$)/.test(command)) {
    if (/\bopen\s*\(/.test(command) || /\bPath\s*\(/.test(command) || /\bread_text\s*\(/.test(command)) {
      // Writing through python should not be forced to Read.
      if (/\bopen\s*\([^)]*['"]\s*,\s*['"][wax+]/.test(command)) return undefined;
      if (/\bwrite(?:_text|_bytes)?\s*\(/.test(command)) return undefined;
      return {
        prefer: 'Read',
        pattern: 'python -c open(file)',
        message: 'Use Read or RepoQuery instead of python -c open(...) for file contents.',
      };
    }
  }

  // node/nodejs -e / -p / --eval / --print "...readFileSync('path')..."
  // Long forms (`--eval`, `--print`) are the same dump surface as short flags.
  if (
    /^(?:\/usr\/bin\/)?node(?:js)?\b/.test(command) &&
    /(?:^|\s)(?:-(?:e|p)|--eval|--print)(?:\s|=|$)/.test(command)
  ) {
    if (/readFile(?:Sync)?\s*\(/.test(command) || /promises\.readFile\s*\(/.test(command)) {
      if (/writeFile(?:Sync)?\s*\(/.test(command) || /appendFile(?:Sync)?\s*\(/.test(command)) {
        return undefined;
      }
      const flag = /(?:^|\s)(?:-p|--print)(?:\s|=|$)/.test(command)
        ? /(?:^|\s)--print(?:\s|=|$)/.test(command)
          ? '--print'
          : '-p'
        : /(?:^|\s)--eval(?:\s|=|$)/.test(command)
          ? '--eval'
          : '-e';
      return {
        prefer: 'Read',
        pattern: `node ${flag} readFile`,
        message: `Use Read or RepoQuery instead of node ${flag} readFile for file contents.`,
      };
    }
  }

  // bun -e / bun -p / bun --eval "...Bun.file / readFileSync..."
  if (
    /^(?:\/usr\/bin\/)?bun\b/.test(command) &&
    /(?:^|\s)(?:-(?:e|p)|--eval|--print)(?:\s|=|$)/.test(command)
  ) {
    if (
      /readFile(?:Sync)?\s*\(/.test(command) ||
      /Bun\.file\s*\(/.test(command) ||
      /promises\.readFile\s*\(/.test(command)
    ) {
      if (/writeFile(?:Sync)?\s*\(/.test(command) || /Bun\.write\s*\(/.test(command)) {
        return undefined;
      }
      return {
        prefer: 'Read',
        pattern: 'bun -e readFile',
        message: 'Use Read or RepoQuery instead of bun -e for file contents.',
      };
    }
  }

  // deno eval / deno -e "...readTextFile(Sync)..."
  if (
    /^(?:\/usr\/bin\/)?deno\b/.test(command) &&
    /(?:^|\s)(?:eval|-e|--eval)(?:\s|=|$)/.test(command)
  ) {
    if (
      /readTextFile(?:Sync)?\s*\(/.test(command) ||
      /readFile(?:Sync)?\s*\(/.test(command)
    ) {
      if (/writeTextFile(?:Sync)?\s*\(/.test(command) || /writeFile(?:Sync)?\s*\(/.test(command)) {
        return undefined;
      }
      return {
        prefer: 'Read',
        pattern: 'deno eval readFile',
        message: 'Use Read or RepoQuery instead of deno eval for file contents.',
      };
    }
  }

  // ruby -e "File.read('path')"
  if (/^(?:\/usr\/bin\/)?ruby\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    if (/File\.read\s*\(/.test(command) || /IO\.read\s*\(/.test(command)) {
      if (/File\.write\s*\(/.test(command) || /IO\.write\s*\(/.test(command)) return undefined;
      return {
        prefer: 'Read',
        pattern: 'ruby -e File.read',
        message: 'Use Read or RepoQuery instead of ruby -e File.read for file contents.',
      };
    }
  }

  // php -r "file_get_contents('path')"
  if (/^(?:\/usr\/bin\/)?php\b/.test(command) && /(?:^|\s)-r(?:\s|$)/.test(command)) {
    if (/file_get_contents\s*\(/.test(command) || /fopen\s*\(/.test(command) || /readfile\s*\(/.test(command)) {
      if (/file_put_contents\s*\(/.test(command) || /fwrite\s*\(/.test(command)) return undefined;
      return {
        prefer: 'Read',
        pattern: 'php -r file_get_contents',
        message: 'Use Read or RepoQuery instead of php -r file_get_contents for file contents.',
      };
    }
  }

  // perl -e/-ne/-nE/-pe/-pE/-lne reading a file (open/read_file or path arg)
  // Clustered short flags (`-nE`, `-lne`, `-pE`) are the same dump surface as `-ne`.
  if (/^(?:\/usr\/bin\/)?perl\b/.test(command)) {
    // In-place edits (`-i`, `-pi`) are Edit jobs — leave for matchEditLike.
    if (/(?:^|\s)-[A-Za-z]*i[A-Za-z]*(?:\S*)?(?:\s|$)/.test(command)) {
      return undefined;
    }
    const perlOneLiner =
      /(?:^|\s)-(?:e|ne|nE|pe|pE|n|p)(?:\s|$)/.test(command) ||
      /(?:^|\s)-[A-Za-z]*[np][A-Za-z]*[eE][A-Za-z]*(?:\s|$)/.test(command) ||
      /(?:^|\s)-[A-Za-z]*[eE][A-Za-z]*(?:\s|$)/.test(command);
    if (perlOneLiner) {
      // Write-mode open belongs to matchLanguageWriteLike / shell work, not Read.
      if (/open\s*[^;]*['"]\s*>/.test(command) || (/\bprint\s+[A-Za-z_]\w*\b/.test(command) && /open\s/.test(command))) {
        /* fall through — write matcher already ran, allow or already blocked */
      } else if (
        /\bopen\b/.test(command) ||
        /read_file\s*\(/.test(command) ||
        command.includes('File::Slurp') ||
        command.includes('Path::Tiny')
      ) {
        return {
          prefer: 'Read',
          pattern: 'perl -e open/read',
          message: 'Use Read or RepoQuery instead of perl one-liners for file contents.',
        };
      }
      // perl -ne/-nE/-pe/-pE/-lne 'print' path  (file arg, no pipe)
      const perlLineLoop =
        /(?:^|\s)-(?:n|p|ne|nE|pe|pE)(?:\s|$)/.test(command) ||
        /(?:^|\s)-[A-Za-z]*[np][A-Za-z]*(?:\s|$)/.test(command);
      if (
        perlLineLoop &&
        /\s\S+\s*$/.test(command) &&
        !/[|<>]/.test(command.replaceAll(/-[A-Za-z]+/g, ''))
      ) {
        // crude: trailing path token after -e script is hard; match `perl -ne '...' file`
        if (/\s+\S+\.[A-Za-z0-9]+\s*$/.test(command) || /\s+\.?\/?[\w./-]+\s*$/.test(command)) {
          return {
            prefer: 'Read',
            pattern: 'perl -ne file',
            message: 'Use Read or RepoQuery instead of perl -ne for file contents.',
          };
        }
      }
    }
  }

  // ruby -ne/-pe/-npe/-ane '…' path  (line-loop file dump, no pipe)
  // Distinct from `ruby -e File.read(...)` which is handled above.
  if (/^(?:\/usr\/bin\/)?ruby\b/.test(command) && !/[|<>]/.test(command.replaceAll(/-[A-Za-z]+/g, ''))) {
    // In-place (`-i`) is Edit.
    if (/(?:^|\s)-[A-Za-z]*i[A-Za-z]*(?:\S*)?(?:\s|$)/.test(command)) {
      return undefined;
    }
    const rubyLineLoop =
      /(?:^|\s)-(?:ne|pe|npe|ane|n|p|a)(?:\s|$)/.test(command) ||
      /(?:^|\s)-[A-Za-z]*[npa][A-Za-z]*(?:\s|$)/.test(command);
    // Require an -e script somewhere so bare `ruby path.rb` stays allowed.
    const hasEval = /(?:^|\s)-(?:e|ne|pe|npe|ane)(?:\s|$)/.test(command) ||
      /(?:^|\s)-[A-Za-z]*e[A-Za-z]*(?:\s|$)/.test(command);
    if (
      rubyLineLoop &&
      hasEval &&
      !/File\.write\s*\(/.test(command) &&
      !/IO\.write\s*\(/.test(command) &&
      (/\s+\S+\.[A-Za-z0-9]+\s*$/.test(command) || /\s+\.?\/?[\w./-]+\s*$/.test(command))
    ) {
      return {
        prefer: 'Read',
        pattern: 'ruby -ne file',
        message: 'Use Read or RepoQuery instead of ruby -ne/-pe for file contents.',
      };
    }
  }

  // lua -e "io.open('path'):read"
  if (/^(?:\/usr\/bin\/)?lua\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    if (/io\.open\s*\(/.test(command) || /\bread\s*\(/.test(command)) {
      if (/:write\s*\(/.test(command)) return undefined;
      return {
        prefer: 'Read',
        pattern: 'lua -e io.open',
        message: 'Use Read or RepoQuery instead of lua -e io.open for file contents.',
      };
    }
  }

  return undefined;
}

/**
 * Whole-command language one-liners that only write a file.
 * Matches: python -c open('path','w').write(...), node writeFileSync, etc.
 * Skips: multi-line scripts, pipelines, network I/O.
 */
export function matchLanguageWriteLike(command: string): ShellDedicatedBypassHit | undefined {
  // Backticks / newlines are shell composition. Bare `|` also appears in ruby
  // block params (`{|f| ...}`), so only reject whitespace-bounded shell pipes
  // and shell OR/AND — not single-pipe language syntax.
  if (/[`\n]/.test(command)) return undefined;
  if (/\s\|\s/.test(command) || command.includes('||') || /\b(?:&&)\b/.test(command)) return undefined;

  // python/python3 -c write
  if (/^(?:\/usr\/bin\/)?python3?(?:\d+(?:\.\d+)*)?\b/.test(command) && /(?:^|\s)-c(?:\s|$)/.test(command)) {
    if (
      /\bopen\s*\([^)]*['"]\s*,\s*['"][wax+]/.test(command) ||
      /\bwrite(?:_text|_bytes)?\s*\(/.test(command) ||
      /\bPath\s*\([^)]*\)\s*\.\s*write_text\s*\(/.test(command)
    ) {
      return {
        prefer: 'Write',
        pattern: 'python -c write(file)',
        message: 'Use Write (or Edit for patches) instead of python -c open(...).write for file content.',
      };
    }
  }

  // node -e writeFileSync / appendFileSync
  if (/^(?:\/usr\/bin\/)?node(?:js)?\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    if (/writeFile(?:Sync)?\s*\(/.test(command) || /appendFile(?:Sync)?\s*\(/.test(command)) {
      return {
        prefer: 'Write',
        pattern: 'node -e writeFile',
        message: 'Use Write (or Edit for patches) instead of node -e writeFile for file content.',
      };
    }
  }

  // ruby -e File.write / File.open(...,'w')
  if (/^(?:\/usr\/bin\/)?ruby\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    if (
      /File\.write\s*\(/.test(command) ||
      /IO\.write\s*\(/.test(command) ||
      // File.open('path','w') or File.open("path", "a") — mode is the 2nd string arg
      /File\.open\s*\(\s*['"][^'"]+['"]\s*,\s*['"][wax+]/.test(command)
    ) {
      return {
        prefer: 'Write',
        pattern: 'ruby -e File.write',
        message: 'Use Write (or Edit for patches) instead of ruby -e File.write for file content.',
      };
    }
  }

  // php -r file_put_contents / fwrite
  if (/^(?:\/usr\/bin\/)?php\b/.test(command) && /(?:^|\s)-r(?:\s|$)/.test(command)) {
    if (/file_put_contents\s*\(/.test(command) || /fwrite\s*\(/.test(command)) {
      return {
        prefer: 'Write',
        pattern: 'php -r file_put_contents',
        message: 'Use Write (or Edit for patches) instead of php -r file_put_contents for file content.',
      };
    }
  }

  // perl -e open with write mode
  if (/^(?:\/usr\/bin\/)?perl\b/.test(command) && /(?:^|\s)-(?:e|ne|pe|n|p)(?:\s|$)/.test(command)) {
    if (/open\s*[^;]*['"]\s*>/.test(command) || /Path::Tiny.*spew/.test(command) || /write_file\s*\(/.test(command)) {
      return {
        prefer: 'Write',
        pattern: 'perl -e open write',
        message: 'Use Write (or Edit for patches) instead of perl one-liners for file content.',
      };
    }
  }

  // lua -e io.open(...):write  (require explicit write-mode open or :write call)
  if (/^(?:\/usr\/bin\/)?lua\b/.test(command) && /(?:^|\s)-e(?:\s|$)/.test(command)) {
    const hasWriteCall = /:write\s*\(/.test(command);
    // Match io.open('path','w') / io.open("path", "a+") — not bare io.open('path'):read('*a')
    const hasWriteModeOpen =
      /io\.open\s*\(\s*['"][^'"]+['"]\s*,\s*['"][wax+]/.test(command);
    if (hasWriteCall || hasWriteModeOpen) {
      return {
        prefer: 'Write',
        pattern: 'lua -e io.write',
        message: 'Use Write (or Edit for patches) instead of lua -e io.open write for file content.',
      };
    }
  }

  return undefined;
}
