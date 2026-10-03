/**
 * Verb-group labels for a run of tool calls.
 * Bash commands and SessionControl activity use observed running states.
 * member is still running, past tense once the run settles.
 */

export type VerbGroupKind =
  | 'subagent'
  | 'command'
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
  subagent: { past: 'Ran', present: 'Running', one: 'session operation', many: 'session operations' },
  command: { past: 'Ran', present: 'Running', one: 'command', many: 'commands' },
  other: { past: 'Ran', present: 'Running', one: 'tool', many: 'tools' },
};

const NAME_KIND: Record<string, VerbGroupKind> = {
  Bash: 'command',
  SessionControl: 'subagent',
};

export function classifyToolVerbKind(name: string): VerbGroupKind {
  const mapped = NAME_KIND[name];
  if (mapped !== undefined) return mapped;
  return 'other';
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
