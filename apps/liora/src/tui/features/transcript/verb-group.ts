/**
 * Verb-group labels for a run of tool calls.
 * "Reading 2 files · Searching 3 patterns" — present tense while any
 * member is still running, past tense once the run settles.
 */

export type VerbGroupKind =
  | 'file'
  | 'skill'
  | 'search'
  | 'dir'
  | 'webFetch'
  | 'webSearch'
  | 'memory'
  | 'subagent'
  | 'command'
  | 'edit'
  | 'write'
  | 'mcp'
  | 'other';

export interface VerbGroupItem {
  readonly name: string;
  readonly running?: boolean;
}

interface VerbCopy {
  readonly past: string;
  readonly present: string;
  readonly one: string;
  readonly many: string;
}

const VERB_COPY: Record<VerbGroupKind, VerbCopy> = {
  file: { past: 'Read', present: 'Reading', one: 'file', many: 'files' },
  skill: { past: 'Ran', present: 'Running', one: 'skill', many: 'skills' },
  search: { past: 'Searched', present: 'Searching', one: 'pattern', many: 'patterns' },
  dir: { past: 'Listed', present: 'Listing', one: 'dir', many: 'dirs' },
  webFetch: { past: 'Fetched', present: 'Fetching', one: 'website', many: 'websites' },
  webSearch: { past: 'Searched', present: 'Searching', one: 'website', many: 'websites' },
  memory: { past: 'Searched', present: 'Searching', one: 'memory', many: 'memories' },
  subagent: { past: 'Ran', present: 'Running', one: 'subagent', many: 'subagents' },
  command: { past: 'Ran', present: 'Running', one: 'command', many: 'commands' },
  edit: { past: 'Edited', present: 'Editing', one: 'file', many: 'files' },
  write: { past: 'Wrote', present: 'Writing', one: 'file', many: 'files' },
  mcp: { past: 'Called', present: 'Calling', one: 'MCP tool', many: 'MCP tools' },
  other: { past: 'Ran', present: 'Running', one: 'tool', many: 'tools' },
};

const NAME_KIND: Record<string, VerbGroupKind> = {
  Read: 'file',
  LioraRead: 'file',
  Grep: 'search',
  Glob: 'search',
  SemanticSearch: 'search',
  LioraSymbol: 'search',
  SearchSkill: 'search',
  SearchTools: 'search',
  SearchExpert: 'search',
  LS: 'dir',
  LioraTree: 'dir',
  WebSearch: 'webSearch',
  DeepResearch: 'webSearch',
  FetchURL: 'webFetch',
  WebFetch: 'webFetch',
  Context7Docs: 'webFetch',
  Context7Resolve: 'webFetch',
  Memory: 'memory',
  Agent: 'subagent',
  Task: 'subagent',
  Bash: 'command',
  Script: 'command',
  RunProjectChecks: 'command',
  Edit: 'edit',
  Write: 'write',
  NotebookEdit: 'edit',
  Skill: 'skill',
};

export function classifyToolVerbKind(name: string): VerbGroupKind {
  const mapped = NAME_KIND[name];
  if (mapped !== undefined) return mapped;
  if (name.startsWith('mcp_') || name.includes('__')) return 'mcp';
  return 'other';
}

/** Grep/Glob/LS and the same verb-family — fold into `SearchGroupComponent`. */
export function isSearchFamilyTool(name: string): boolean {
  const kind = classifyToolVerbKind(name);
  return kind === 'search' || kind === 'dir';
}

export function formatVerbGroupLabel(
  items: readonly VerbGroupItem[],
  options?: { readonly running?: boolean },
): string {
  if (items.length === 0) return '';
  const running = options?.running ?? items.some((item) => item.running === true);
  const buckets: { kind: VerbGroupKind; count: number }[] = [];
  for (const item of items) {
    const kind = classifyToolVerbKind(item.name);
    const existing = buckets.find((bucket) => bucket.kind === kind);
    if (existing !== undefined) existing.count += 1;
    else buckets.push({ kind, count: 1 });
  }
  return buckets
    .map((bucket) => {
      const copy = VERB_COPY[bucket.kind];
      const noun = bucket.count === 1 ? copy.one : copy.many;
      return `${running ? copy.present : copy.past} ${String(bucket.count)} ${noun}`;
    })
    .join(' · ');
}

export function turnActivityIdentity(items: readonly VerbGroupItem[]): string {
  return items.map((item) => `${item.name}:${item.running === true ? '1' : '0'}`).join('|');
}
