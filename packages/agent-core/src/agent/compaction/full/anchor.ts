export interface AnchorDocument {
  readonly intent: string;
  readonly changes: readonly string[];
  readonly decisions: readonly string[];
  readonly nextSteps: readonly string[];
}

const ANCHOR_HEADER = '# Anchor Document\n\nThis document persists across compactions and is updated incrementally.\n';
const MAX_CHANGES = 30;
const MAX_DECISIONS = 20;
const MAX_NEXT_STEPS = 10;

export function createAnchorDocument(initialIntent: string): AnchorDocument {
  return {
    intent: initialIntent,
    changes: [],
    decisions: [],
    nextSteps: [],
  };
}

export function mergeIntoAnchor(
  anchor: AnchorDocument,
  diff: Partial<AnchorDocument>,
): AnchorDocument {
  return {
    intent: diff.intent ?? anchor.intent,
    changes: dedupeAndLimit([...anchor.changes, ...(diff.changes ?? [])], MAX_CHANGES),
    decisions: dedupeAndLimit([...anchor.decisions, ...(diff.decisions ?? [])], MAX_DECISIONS),
    nextSteps: dedupeAndLimit([...anchor.nextSteps, ...(diff.nextSteps ?? [])], MAX_NEXT_STEPS),
  };
}

export function renderAnchor(anchor: AnchorDocument): string {
  if (anchor.changes.length === 0 && anchor.decisions.length === 0 && anchor.nextSteps.length === 0) {
    return '';
  }

  const lines: string[] = [ANCHOR_HEADER];

  lines.push(`## Intent\n${anchor.intent}\n`);

  if (anchor.changes.length > 0) {
    lines.push('## Changes Made');
    for (const c of anchor.changes) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  if (anchor.decisions.length > 0) {
    lines.push('## Decisions Taken');
    for (const d of anchor.decisions) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  if (anchor.nextSteps.length > 0) {
    lines.push('## Next Steps');
    for (const s of anchor.nextSteps) {
      lines.push(`- ${s}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function extractAnchorDiff(summary: string): Partial<AnchorDocument> {
  const lines = summary.split('\n');

  const changes: string[] = [];
  const decisions: string[] = [];
  const nextSteps: string[] = [];

  let currentSection: 'changes' | 'decisions' | 'next' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      currentSection = null;
      continue;
    }

    if (/^#{1,4}\s*(current task|task|goal|intent)/i.test(trimmed)) {
      currentSection = null;
      continue;
    }
    if (/^#{1,4}\s*(changes made|completed work|work done)/i.test(trimmed)) {
      currentSection = 'changes';
      continue;
    }
    if (/^#{1,4}\s*(decisions? taken|key decisions?)/i.test(trimmed)) {
      currentSection = 'decisions';
      continue;
    }
    if (/^#{1,4}\s*(next steps?|pending|todo)/i.test(trimmed)) {
      currentSection = 'next';
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const item = trimmed.slice(2);
      if (currentSection === 'changes') changes.push(item);
      else if (currentSection === 'decisions') decisions.push(item);
      else if (currentSection === 'next') nextSteps.push(item);
    }

    if (/^DECIDED:/i.test(trimmed)) {
      decisions.push(trimmed.replace(/^DECIDED:\s*/i, ''));
    }
    if (/^CHANGED:/i.test(trimmed)) {
      changes.push(trimmed.replace(/^CHANGED:\s*/i, ''));
    }
  }

  return {
    changes: changes.length > 0 ? changes : undefined,
    decisions: decisions.length > 0 ? decisions : undefined,
    nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
  };
}

function dedupeAndLimit(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}
