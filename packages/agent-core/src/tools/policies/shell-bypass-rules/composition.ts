/**
 * Shared preprocessing helpers used by the shell-dedicated-bypass dispatcher:
 * peeling process-wrapper prefixes and detecting real shell composition
 * (pipes, lists, redirects, substitution) that should always allow Bash.
 */

/**
 * Peel leading no-op / process wrappers so dedicated-tool detection still fires.
 * Leaves `command -v`, `env -i`, multi-arg env assignments, etc. alone.
 */
export function stripLeadingShellUtilityWrappers(command: string): string {
  let next = command.trim();
  // Leading backslash escapes alias lookup: `\cat file` → `cat file`.
  if (next.startsWith('\\') && next.length > 1 && !next.startsWith('\\\\')) {
    next = next.slice(1).trimStart();
  }
  for (let i = 0; i < 4; i += 1) {
    const before = next;
    // `command cat …` but not `command -v cat` / `command -p …`
    if (/^command(?:\s+--)?\s+(?![-/])/.test(next)) {
      next = next.replace(/^command(?:\s+--)?\s+/, '').trimStart();
    }
    // bare `env cmd …` without KEY=val / -options
    else if (/^env\s+(?![A-Za-z_][A-Za-z0-9_]*=)(?!-)\S/.test(next)) {
      next = next.replace(/^env\s+/, '').trimStart();
    }
    // `timeout [opts] DURATION cmd` — duration is required before the utility
    else if (/^timeout\b/.test(next)) {
      const stripped = next
        .replace(/^timeout\b/, '')
        .replaceAll(/^\s+(?:--foreground|--preserve-status|--verbose|-v)\b/g, '')
        .replace(/^\s+--signal(?:=\S+|\s+\S+)/, '')
        .replace(/^\s+-s(?:\s+\S+|=?\S+)/, '')
        .replace(/^\s+--kill-after(?:=\S+|\s+\S+)/, '')
        .replace(/^\s+-k(?:\s+\S+|=?\S+)/, '')
        .trimStart();
      // First token is duration (5, 5s, 1m, …); drop it if present.
      const m = /^(\d+(?:\.\d+)?[smhd]?)\s+(.+)$/.exec(stripped);
      if (m?.[2] !== undefined) next = m[2].trimStart();
    }
    // `stdbuf -oL cat …` / `stdbuf -i0 -o0 -e0 cat …`
    else if (/^stdbuf\b/.test(next)) {
      const stripped = next
        .replace(/^stdbuf\b/, '')
        .replaceAll(/(?:\s+-[ioe](?:=\S+|\s+\S+))+/g, ' ')
        .replaceAll(/(?:\s+--(?:input|output|error)-buf(?:=\S+|\s+\S+))+/g, ' ')
        .trimStart();
      if (stripped.length > 0 && stripped !== next.replace(/^stdbuf\b/, '').trimStart()) {
        next = stripped;
      } else if (/^stdbuf(?:\s+-[ioe]\S*)+\s+\S/.test(next)) {
        next = next.replace(/^stdbuf(?:\s+-[ioe]\S*)+\s+/, '').trimStart();
      }
    }
    // `nice [-n N] cmd` / bare `nice cmd`
    else if (/^nice\b/.test(next)) {
      const stripped = next
        .replace(/^nice\b/, '')
        .replace(/^\s+-n(?:\s+\S+|=?\S+)/, '')
        .replace(/^\s+--adjustment(?:=\S+|\s+\S+)/, '')
        .trimStart();
      if (stripped.length > 0) next = stripped;
    }
    // `nohup cmd`
    else if (/^nohup\s+/.test(next)) {
      next = next.replace(/^nohup\s+/, '').trimStart();
    }
    // `powershell -Command …` / `pwsh -c '…'` — unwrap one-shot script hosts so
    // dedicated-tool detection still prefers Read/Write for simple file I/O.
    // Interactive/session hosts without -Command/-c stay allowed.
    else if (/^(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/i.test(next)) {
      const m =
        /^(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b(?:\s+(?!(?:-Command|-c)\b)\S+)*\s+(?:-Command|-c)\s+(.+)$/i.exec(
          next,
        );
      if (m?.[1] !== undefined) {
        let inner = m[1].trim();
        if (
          (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) ||
          (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2)
        ) {
          inner = inner.slice(1, -1).trim();
        }
        if (inner.length > 0) next = inner;
      }
    }
    // `cmd /c type file` / `cmd.exe /C "Get-Content a.ts"` — unwrap one-shot cmd.
    else if (/^cmd(?:\.exe)?\s+\/[cC]\s+/.test(next)) {
      let inner = next.replace(/^cmd(?:\.exe)?\s+\/[cC]\s+/i, '').trim();
      if (
        (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) ||
        (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2)
      ) {
        inner = inner.slice(1, -1).trim();
      }
      if (inner.length > 0) next = inner;
    }
    if (next === before) break;
  }
  return next.trim();
}

export function hasShellComposition(command: string): boolean {
  // Pipes, sequential/parallel lists, subshells, process substitution, redirects.
  // Allow simple `2>/dev/null` on a single utility? Still composition — skip deny.
  if (/[|;&`\n]/.test(command)) return true;
  if (/\b(?:&&|\|\|)\b/.test(command)) return true;
  if (/[<>]/.test(command)) return true;
  if (/\$\(|\$\{/.test(command)) return true;
  return false;
}
