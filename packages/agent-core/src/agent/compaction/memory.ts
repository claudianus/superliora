import { estimateTokens } from '../../utils/tokens';

export interface ExtractedFact {
  readonly category: 'file' | 'decision' | 'error' | 'dependency' | 'config' | 'api' | 'state';
  readonly subject: string;
  readonly detail: string;
  readonly importance: 'critical' | 'important' | 'contextual';
}

export interface CompactionMemory {
  readonly facts: readonly ExtractedFact[];
  readonly workingSummary: string;
}

export interface StructuredCompactionMemory {
  readonly currentGoal?: string;
  readonly lastKnownState: readonly string[];
  readonly decisions: readonly string[];
  readonly filesTouched: readonly string[];
  readonly failedAttempts: readonly string[];
  readonly openQuestions: readonly string[];
  readonly nextActions: readonly string[];
  readonly rawRefs: readonly string[];
  readonly swarmRuns: readonly string[];
}

const MAX_FACTS = 50;
const FACT_TOKEN_BUDGET = 2000;

type StructuredListKey =
  | 'lastKnownState'
  | 'decisions'
  | 'filesTouched'
  | 'failedAttempts'
  | 'openQuestions'
  | 'nextActions'
  | 'rawRefs'
  | 'swarmRuns';

export function parseStructuredCompactionMemory(summary: string): StructuredCompactionMemory {
  let currentGoal: string | undefined;
  const sections: Record<StructuredListKey, string[]> = {
    lastKnownState: [],
    decisions: [],
    filesTouched: [],
    failedAttempts: [],
    openQuestions: [],
    nextActions: [],
    rawRefs: [],
    swarmRuns: [],
  };

  let currentSection: StructuredListKey | null = null;
  for (const line of summary.split('\n')) {
    const parsedHeading = parseStructuredHeading(line);
    if (parsedHeading !== null) {
      if (parsedHeading.key === 'currentGoal') {
        currentSection = null;
        if (parsedHeading.value.length > 0) currentGoal = parsedHeading.value;
      } else {
        currentSection = parsedHeading.key;
        if (parsedHeading.value.length > 0) sections[parsedHeading.key].push(parsedHeading.value);
      }
      continue;
    }
    if (/^\s*#{1,6}\s+/.test(line)) {
      currentSection = null;
      continue;
    }

    const item = normalizeMemoryItem(line);
    if (item.length === 0) continue;
    if (currentSection !== null) {
      sections[currentSection].push(item);
    }
  }

  return {
    currentGoal,
    lastKnownState: uniqueList(sections.lastKnownState),
    decisions: uniqueList(sections.decisions),
    filesTouched: uniqueList(sections.filesTouched),
    failedAttempts: uniqueList(sections.failedAttempts),
    openQuestions: uniqueList(sections.openQuestions),
    nextActions: uniqueList(sections.nextActions),
    rawRefs: uniqueList(sections.rawRefs),
    swarmRuns: uniqueList(sections.swarmRuns),
  };
}

export function isPlaceholderCompactionMemoryItem(item: string): boolean {
  const lower = item.replaceAll(/\s+/g, ' ').trim().toLowerCase();
  return (
    lower.length === 0 ||
    lower === 'none' ||
    lower === 'n/a' ||
    lower === 'none captured during compaction.' ||
    lower === 'not captured during compaction.' ||
    lower === 'no captured item.'
  );
}

export function isUsefulCompactionMemoryItem(item: string): boolean {
  const normalized = item.replaceAll(/\s+/g, ' ').trim();
  if (isPlaceholderCompactionMemoryItem(normalized)) return false;
  if (/^#{1,6}\s+/.test(normalized)) return false;
  if (/^\*\*(?:file|decision|error|state|config|dependency|api)\*\*:\s*$/i.test(normalized)) {
    return false;
  }
  return true;
}

export function isPromptControlCompactionMemoryItem(item: string): boolean {
  return /(?:ignore|disregard|override|forget|bypass).{0,40}(?:system|developer|previous|prior|above|safety|policy|instructions?)|(?:reveal|print|exfiltrate|leak).{0,40}(?:secret|token|credential|api[_ -]?key|password)|(?:treat|consider).{0,40}(?:this|the following).{0,40}(?:system|developer).{0,40}(?:message|instruction)/i.test(
    item,
  );
}

export function extractFactsFromSummary(summary: string): readonly ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const lines = summary.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const fileMatch = trimmed.match(/`([^`]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))`/i);
    if (fileMatch) {
      facts.push({
        category: 'file',
        subject: fileMatch[1]!,
        detail: trimmed,
        importance: 'important',
      });
      continue;
    }

    const errorMatch =
      /^(?:[-*]?\s*)?(?:ERROR|FAILED|BUG|CRASH|EXCEPTION|FIXED|RESOLVED)[\s:]/i.test(
        trimmed,
      );
    if (errorMatch && !/^\s*\[(?:pending|in_progress|done)\]/i.test(trimmed)) {
      facts.push({
        category: 'error',
        subject: trimmed.slice(0, 80),
        detail: trimmed,
        importance: 'critical',
      });
      continue;
    }

    const decisionMatch = trimmed.match(/(?:decided|chosen|approach|solution|using|migrated to|switched to|replaced with)/i);
    if (decisionMatch) {
      facts.push({
        category: 'decision',
        subject: trimmed.slice(0, 80),
        detail: trimmed,
        importance: 'critical',
      });
      continue;
    }

    const depMatch = trimmed.match(/(?:npm|pnpm|yarn|pip|cargo|go mod|gradle|maven|import|require|install|dependency|package)/i);
    if (depMatch) {
      facts.push({
        category: 'dependency',
        subject: trimmed.slice(0, 80),
        detail: trimmed,
        importance: 'important',
      });
      continue;
    }

    const configMatch = trimmed.match(/(?:config|setting|env|variable|flag|toggle|enable|disable)/i);
    if (configMatch) {
      facts.push({
        category: 'config',
        subject: trimmed.slice(0, 80),
        detail: trimmed,
        importance: 'important',
      });
      continue;
    }
  }

  const seen = new Set<string>();
  const deduped: ExtractedFact[] = [];
  for (const fact of facts) {
    const key = `${fact.category}:${fact.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(fact);
  }

  return deduped.slice(0, MAX_FACTS);
}

export function formatFactsAsMemoryBlock(facts: readonly ExtractedFact[]): string {
  if (facts.length === 0) return '';

  const critical = facts.filter((f) => f.importance === 'critical');
  const important = facts.filter((f) => f.importance === 'important');

  const lines: string[] = ['## Working Memory (Key Facts)'];

  if (critical.length > 0) {
    lines.push('### Critical');
    for (const fact of critical) {
      lines.push(`- **${fact.category}**: ${fact.detail}`);
    }
  }

  if (important.length > 0) {
    lines.push('### Important');
    for (const fact of important.slice(0, 15)) {
      lines.push(`- **${fact.category}**: ${fact.detail}`);
    }
  }

  const result = lines.join('\n');
  if (estimateTokens(result) > FACT_TOKEN_BUDGET) {
    const criticalOnly = ['## Working Memory (Key Facts)', '### Critical'];
    for (const fact of critical.slice(0, 20)) {
      criticalOnly.push(`- **${fact.category}**: ${fact.detail}`);
    }
    return criticalOnly.join('\n');
  }

  return result;
}

export function mergeFactSets(
  previous: readonly ExtractedFact[] | undefined,
  current: readonly ExtractedFact[],
): readonly ExtractedFact[] {
  const merged = new Map<string, ExtractedFact>();

  if (previous !== undefined) {
    for (const fact of previous) {
      const key = `${fact.category}:${fact.subject}`;
      merged.set(key, fact);
    }
  }

  for (const fact of current) {
    const key = `${fact.category}:${fact.subject}`;
    merged.set(key, fact);
  }

  return Array.from(merged.values()).slice(0, MAX_FACTS);
}

function parseStructuredHeading(
  line: string,
): { key: 'currentGoal' | StructuredListKey; value: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const heading = trimmed.match(/^#{1,6}\s*(.+)$/);
  const labelSource = heading?.[1] ?? trimmed;
  const colon = labelSource.match(/^([A-Za-z0-9 _-]+):\s*(.*)$/);
  const label = normalizeSectionLabel(colon?.[1] ?? labelSource);
  const key = sectionKeyForLabel(label);
  if (key === null) return null;
  return { key, value: normalizeMemoryItem(colon?.[2] ?? '') };
}

function sectionKeyForLabel(label: string): 'currentGoal' | StructuredListKey | null {
  switch (label) {
    case 'current_goal':
    case 'current_focus':
    case 'current_task':
    case 'goal':
    case 'intent':
      return 'currentGoal';
    case 'last_known_state':
    case 'state':
    case 'status':
    case 'changes_made':
    case 'completed_work':
    case 'work_done':
      return 'lastKnownState';
    case 'decisions':
    case 'decisions_taken':
    case 'key_decisions':
      return 'decisions';
    case 'files_touched':
    case 'files':
    case 'modified_files':
      return 'filesTouched';
    case 'failed_attempts':
    case 'failures':
    case 'active_issues':
    case 'errors':
      return 'failedAttempts';
    case 'open_questions':
    case 'questions':
    case 'blockers':
      return 'openQuestions';
    case 'next_actions':
    case 'next_steps':
    case 'pending':
    case 'todo':
      return 'nextActions';
    case 'raw_refs':
    case 'raw_references':
    case 'references':
      return 'rawRefs';
    case 'swarm_runs':
    case 'swarm_coordination':
    case 'ultra_swarm':
      return 'swarmRuns';
    default:
      return null;
  }
}

function normalizeSectionLabel(label: string): string {
  return label
    .trim()
    .replaceAll(/[`*]/g, '')
    .replaceAll(/[^A-Za-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .toLowerCase();
}

function normalizeMemoryItem(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, '')
    .trim();
}

function uniqueList(items: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
