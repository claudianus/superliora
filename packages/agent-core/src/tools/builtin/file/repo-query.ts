/**
 * RepoQueryTool — unified repository search (v0).
 *
 * Delegates content/path modes to Grep/Glob. Symbol/outline modes use the
 * codemap when warm, with regex/live-parse fallbacks. Always returns structured
 * text; never throws to the agent loop.
 */

import type { Kaos } from '@superliora/kaos';

import type { BuiltinTool } from '../../../agent/tool';
import { getCodeMapForWorkspace } from '../../../codemap/code-map';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolOutput, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { queryRepoIndexContentAsync } from '../../../repo-index/engine';
import {
  parseRepoIndexEngineEnv,
  REPO_INDEX_ENGINE_ENV,
} from '../../../repo-index/status';
import { noopTelemetryClient, type TelemetryClient } from '../../../telemetry';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import type { WorkspaceConfig } from '../../support/workspace';
import { collectContextFiles } from '../context/context-discovery';
import { GlobTool } from './glob';
import { GrepTool } from './grep';
import {
  formatRepoQueryOutput,
  normalizeRepoQueryLimit,
  parseRepoQueryInput,
  softFailRepoQuery,
  type RepoQueryIndexStatus,
  type RepoQueryInput,
  RepoQueryInputSchema,
} from './repo-query-core';
import REPO_QUERY_DESCRIPTION from './repo-query.md?raw';

export {
  DEFAULT_REPO_QUERY_LIMIT,
  REPO_QUERY_MODES,
  RepoQueryInputSchema,
  formatRepoQueryOutput,
  normalizeRepoQueryLimit,
  parseRepoQueryInput,
  softFailRepoQuery,
  validateRepoQueryModeInput,
  type RepoQueryIndexStatus,
  type RepoQueryInput,
  type RepoQueryMode,
  type RepoQueryResultEnvelope,
} from './repo-query-core';

export class RepoQueryTool implements BuiltinTool<RepoQueryInput> {
  readonly name = 'RepoQuery' as const;
  readonly description = REPO_QUERY_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(RepoQueryInputSchema);
  private readonly grep: GrepTool;
  private readonly glob: GlobTool;

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    telemetry: TelemetryClient = noopTelemetryClient,
  ) {
    this.grep = new GrepTool(kaos, workspace, telemetry);
    this.glob = new GlobTool(kaos, workspace, telemetry);
  }

  resolveExecution(args: RepoQueryInput): ToolExecution {
    const parsed = parseRepoQueryInput(args);
    const fallbackMode = inferMode(args);
    if (!parsed.ok) {
      return this.softExecution(fallbackMode, parsed.message, 'Fix the parameters and retry RepoQuery.');
    }

    const input = parsed.value;
    const limit = normalizeRepoQueryLimit(input.limit);
    let scopePath: string | undefined;
    if (input.path !== undefined) {
      try {
        scopePath = resolveScopePath(this.kaos, this.workspace, input.path);
      } catch (error) {
        return this.softExecution(
          input.mode,
          error instanceof Error ? error.message : String(error),
          'Check path is inside the workspace or use an allowed absolute path.',
        );
      }
    }

    const searchRoot = scopePath ?? this.workspace.workspaceDir;
    return {
      accesses: ToolAccesses.searchTree(searchRoot),
      readOnly: true,
      description: `RepoQuery ${input.mode} "${input.query}"`,
      approvalRule: this.name,
      execute: ({ signal }) => this.execution(input, limit, scopePath, signal),
    };
  }

  private softExecution(
    mode: RepoQueryInput['mode'],
    hint: string,
    nextStep: string,
  ): ToolExecution {
    return {
      accesses: ToolAccesses.searchTree(this.workspace.workspaceDir),
      readOnly: true,
      description: `RepoQuery ${mode}`,
      approvalRule: this.name,
      execute: async () => ({ output: softFailRepoQuery(mode, hint, nextStep) }),
    };
  }

  private async execution(
    input: RepoQueryInput,
    limit: number,
    scopePath: string | undefined,
    signal: AbortSignal,
  ): Promise<ExecutableToolResult> {
    const started = Date.now();
    try {
      switch (input.mode) {
        case 'content':
          return await this.runContent(input, limit, signal, started);
        case 'path':
          return await this.runPath(input, limit, signal, started);
        case 'symbol':
          return await this.runSymbol(input, limit, scopePath, started);
        case 'outline':
          return await this.runOutline(input, limit, scopePath, started);
      }
    } catch (error) {
      return {
        output: softFailRepoQuery(
          input.mode,
          error instanceof Error ? error.message : String(error),
          nextStepForMode(input.mode),
          Date.now() - started,
        ),
      };
    }
  }

  private async runContent(
    input: RepoQueryInput,
    limit: number,
    signal: AbortSignal,
    started: number,
  ): Promise<ExecutableToolResult> {
    const engine = parseRepoIndexEngineEnv(process.env[REPO_INDEX_ENGINE_ENV]);
    const indexQuery =
      engine === 'sqlite' || engine === 'zoekt'
        ? await queryRepoIndexContentAsync({ query: input.query, path: input.path, limit }, engine)
        : null;
    if (indexQuery !== null && indexQuery.results.length > 0) {
      return {
        output: formatRepoQueryOutput({
          mode: 'content',
          results: [...indexQuery.results],
          index_status: indexQuery.index_status,
          took_ms: Date.now() - started,
          truncated: indexQuery.results.length >= limit,
          hint: indexQuery.hint,
          next_step: indexQuery.next_step,
        }),
      };
    }

    const grepExecution = this.grep.resolveExecution({
      pattern: input.query,
      path: input.path,
      output_mode: 'content',
      head_limit: limit,
      ...(input.context_lines !== undefined ? { '-C': input.context_lines } : {}),
    });
    const delegated = await runDelegatedTool(grepExecution, signal);
    if (delegated.kind === 'resolve-error') {
      return {
        output: softFailRepoQuery(
          'content',
          delegated.output,
          'Try Grep with the same pattern or Read when you know the file path.',
          Date.now() - started,
        ),
      };
    }
    const result = delegated.result;
    const body = stripToolMeta(toolOutputToText(result.output));
    if (result.isError === true) {
      return {
        output: softFailRepoQuery(
          'content',
          body.trim() || 'Content search failed.',
          'Try Grep with the same pattern or Read when you know the file path.',
          Date.now() - started,
        ),
      };
    }

    const lines = body
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    const truncated =
      result.truncated === true ||
      body.includes('Results truncated') ||
      body.includes('Use offset=') ||
      body.includes('[stdout truncated');

    return {
      output: formatRepoQueryOutput({
        mode: 'content',
        results: lines,
        index_status: 'cold',
        took_ms: Date.now() - started,
        truncated,
        hint: lines.length === 0 ? indexQuery?.hint : undefined,
        next_step:
          lines.length === 0
            ? indexQuery?.next_step ??
              'Broaden the pattern, check path scope, or use mode=path to locate files first.'
            : 'Use Read for exact file bytes or Grep with offset/head_limit to page further.',
      }),
    };
  }

  private async runPath(
    input: RepoQueryInput,
    limit: number,
    signal: AbortSignal,
    started: number,
  ): Promise<ExecutableToolResult> {
    const globExecution = this.glob.resolveExecution({
      pattern: input.query,
      path: input.path,
    });
    const delegated = await runDelegatedTool(globExecution, signal);
    if (delegated.kind === 'resolve-error') {
      return {
        output: softFailRepoQuery(
          'path',
          delegated.output,
          'Try Glob with the same pattern or add a subdirectory anchor.',
          Date.now() - started,
        ),
      };
    }
    const result = delegated.result;
    const body = stripToolMeta(toolOutputToText(result.output));
    if (result.isError === true) {
      return {
        output: softFailRepoQuery(
          'path',
          body.trim() || 'Path search failed.',
          'Try Glob with the same pattern or add a subdirectory anchor.',
          Date.now() - started,
        ),
      };
    }

    const lines = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('Glob timed out'));
    const globTruncated = body.includes('truncated to') || body.includes('Refine the pattern');
    const truncated = globTruncated || lines.length > limit;
    const limited = lines.slice(0, limit);

    return {
      output: formatRepoQueryOutput({
        mode: 'path',
        results: limited,
        index_status: 'cold',
        took_ms: Date.now() - started,
        truncated,
        next_step:
          limited.length === 0
            ? 'Relax the glob, check path scope, or use mode=content once you have a filename hint.'
            : 'Use Read or mode=outline on a chosen path; narrow the glob if truncated.',
      }),
    };
  }

  private async runSymbol(
    input: RepoQueryInput,
    limit: number,
    scopePath: string | undefined,
    started: number,
  ): Promise<ExecutableToolResult> {
    const codemap = getCodeMapForWorkspace(this.workspace.workspaceDir);
    const indexReady = scopePath === undefined && codemap.ensureReady();
    if (indexReady) {
      const hits = codemap.findSymbol(input.query, limit);
      const results = hits.map(
        (hit) => `${hit.filePath}:L${String(hit.startLine)} ${hit.kind} ${hit.signature}`,
      );
      return {
        output: formatRepoQueryOutput({
          mode: 'symbol',
          results,
          index_status: 'warm',
          took_ms: Date.now() - started,
          truncated: hits.length >= limit,
          next_step:
            results.length === 0
              ? 'Try mode=content with the symbol name or Grep for partial matches.'
              : 'Use Read for exact edit bytes.',
        }),
      };
    }

    const explicitPaths =
      scopePath === undefined
        ? undefined
        : [resolveScopePath(this.kaos, this.workspace, scopePath, 'read')];
    const files = await collectContextFiles({
      kaos: this.kaos,
      workspace: this.workspace,
      explicitPaths,
      query: input.query,
    });
    const { definitions, references } = scanSymbolMatches(files, input.query, limit);
    const results = [...definitions, ...references].slice(0, limit);
    const indexStatus: RepoQueryIndexStatus = results.length > 0 ? 'partial' : 'cold';

    if (results.length === 0) {
      return {
        output: softFailRepoQuery(
          'symbol',
          indexReady
            ? `No symbol "${input.query}" in indexed workspace.`
            : `Symbol index is cold; no matches for "${input.query}".`,
          'Use Grep for text matches, then Read. Retry RepoQuery mode=symbol when the codemap is warm.',
          Date.now() - started,
        ),
      };
    }

    return {
      output: formatRepoQueryOutput({
        mode: 'symbol',
        results,
        index_status: indexStatus,
        took_ms: Date.now() - started,
        truncated: definitions.length + references.length > limit,
        hint: indexReady ? undefined : 'Symbol index is cold; results used regex fallback.',
        next_step: 'Use Read for exact edit bytes.',
      }),
    };
  }

  private async runOutline(
    input: RepoQueryInput,
    limit: number,
    scopePath: string | undefined,
    started: number,
  ): Promise<ExecutableToolResult> {
    let targetPath = scopePath;
    let symbolFilter = input.query.trim();
    if (targetPath === undefined) {
      targetPath = input.query;
      symbolFilter = '';
    }

    let safePath: string;
    try {
      safePath = resolveScopePath(this.kaos, this.workspace, targetPath, 'read');
    } catch (error) {
      return {
        output: softFailRepoQuery(
          'outline',
          error instanceof Error ? error.message : String(error),
          'Pass path to a readable file, then retry mode=outline.',
          Date.now() - started,
        ),
      };
    }

    const codemap = getCodeMapForWorkspace(this.workspace.workspaceDir);
    codemap.ensureReady();
    const outline = codemap.outlineFile(safePath);
    const filter = symbolFilter.toLowerCase();
    const filtered =
      filter.length === 0
        ? outline
        : outline.filter((hit) => hit.signature.toLowerCase().includes(filter));
    const results = filtered.slice(0, limit).map(
      (hit) => `${hit.filePath}:L${String(hit.startLine)} ${hit.signature}`,
    );
    const truncated = filtered.length > limit;

    if (results.length === 0) {
      return {
        output: softFailRepoQuery(
          'outline',
          filter.length > 0
            ? `No outline entries match "${symbolFilter}" in ${targetPath}.`
            : `No outline entries parsed for ${targetPath}.`,
          'Use Read for raw file bytes or mode=content to search within the file.',
          Date.now() - started,
        ),
      };
    }

    return {
      output: formatRepoQueryOutput({
        mode: 'outline',
        results,
        index_status: 'partial',
        took_ms: Date.now() - started,
        truncated,
        next_step: 'Use Read to inspect bodies of selected symbols.',
      }),
    };
  }
}

function inferMode(args: RepoQueryInput): RepoQueryInput['mode'] {
  if (typeof args === 'object' && args !== null && 'mode' in args) {
    const mode = (args as { mode?: unknown }).mode;
    if (mode === 'symbol' || mode === 'content' || mode === 'path' || mode === 'outline') {
      return mode;
    }
  }
  return 'content';
}

function resolveScopePath(
  kaos: Kaos,
  workspace: WorkspaceConfig,
  path: string,
  operation: 'search' | 'read' = 'search',
): string {
  return resolvePathAccessPath(path, {
    kaos,
    workspace,
    operation,
    policy:
      operation === 'search'
        ? { guardMode: 'absolute-outside-allowed', checkSensitive: false }
        : undefined,
  });
}

function stripToolMeta(output: string): string {
  const marker = '\n<tool_meta';
  const index = output.indexOf(marker);
  return index === -1 ? output : output.slice(0, index);
}

async function runDelegatedTool(
  execution: ToolExecution,
  signal: AbortSignal,
): Promise<
  | { kind: 'ok'; result: ExecutableToolResult }
  | { kind: 'resolve-error'; output: string }
> {
  if (!('execute' in execution)) {
    return { kind: 'resolve-error', output: toolOutputToText(execution.output) };
  }
  const result = await execution.execute({
    turnId: 'repo-query',
    toolCallId: 'repo-query',
    signal,
  });
  return { kind: 'ok', result };
}

function toolOutputToText(output: ExecutableToolOutput): string {
  return typeof output === 'string' ? output : JSON.stringify(output);
}

function nextStepForMode(mode: RepoQueryInput['mode']): string {
  switch (mode) {
    case 'content':
      return 'Try Grep with the same pattern or Read when you know the file path.';
    case 'path':
      return 'Try Glob with the same pattern or narrow path.';
    case 'outline':
      return 'Pass path to a file and retry, or use Read for raw content.';
    default:
      return 'Try Grep or RepoQuery mode=symbol, then Read for exact bytes.';
  }
}

function scanSymbolMatches(
  files: Awaited<ReturnType<typeof collectContextFiles>>,
  name: string,
  limit: number,
): { definitions: string[]; references: string[] } {
  const escaped = escapeRegExp(name);
  const definitionRe = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?(?:function|class|interface|type|const|let|var)\\s+${escaped}\\b`,
    'u',
  );
  const referenceRe = new RegExp(`\\b${escaped}\\b`, 'u');
  const definitions: string[] = [];
  const references: string[] = [];
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      const lineNumber = index + 1;
      if (definitionRe.test(trimmed)) {
        definitions.push(`${file.displayPath}:L${String(lineNumber)} def ${trimmed.slice(0, 140)}`);
      } else if (referenceRe.test(trimmed)) {
        references.push(`${file.displayPath}:L${String(lineNumber)} ref ${trimmed.slice(0, 140)}`);
      }
      if (definitions.length + references.length >= limit * 2) {
        return { definitions, references };
      }
    }
  }
  return { definitions, references };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
