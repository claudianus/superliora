// Diagnostics attached to a file mutation's tool result.

import type { Agent } from '..';
import { collectSyntaxReport, formatSyntaxReport } from '#/codemap/syntax-check';

/**
 * Diagnostics appended to a mutation's tool result.
 *
 * A plugin LSP reports types and semantics, so when it produces output the
 * built-in parse is skipped — a parse cannot see a type error, and paying for
 * both on every edit would buy nothing.
 *
 * It cannot be skipped merely because an LSP is *configured*, though.
 * `PluginLspRuntime.collectForFile` returns nothing for three different
 * reasons: no server claims the path, the server is blacklisted after a failed
 * spawn, and the file is genuinely clean. Reading that silence as "an LSP
 * covered this edit" let a TypeScript LSP swallow a broken Python edit without
 * a word — strictly worse than having no LSP at all, which is the case the
 * built-in check was added for. Falling through costs one parse of a file that
 * is usually clean and rescues the three cases that would otherwise report
 * nothing at all.
 */
export function buildFileMutationHook(
  agent: Pick<Agent, 'fileMutationHook'>,
): (path: string, content: string) => string | Promise<string | undefined> | undefined {
  return (path, content) => {
    const lsp = agent.fileMutationHook;
    if (lsp === undefined) return builtInSyntaxCheck(path, content);
    return Promise.resolve(lsp(path, content)).then((reported) =>
      reported ?? builtInSyntaxCheck(path, content),
    );
  };
}

/**
 * Undefined when there is nothing to report, which is the common case: a
 * "0 problems" line would spend tokens on every successful edit.
 */
function builtInSyntaxCheck(path: string, content: string): string | undefined {
  const report = collectSyntaxReport(path, content);
  return report === undefined ? undefined : formatSyntaxReport(path, report);
}
