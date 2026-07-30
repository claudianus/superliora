import type { UltraSwarmMemberMetadata } from '#/tui/components/messages/agent-swarm-progress';
import { collapseWhitespace, normalizeFinalOutputText } from '#/tui/utils/agent-swarm-cell-render';

const RESUMED_ITEM_LABEL = '(resumed)';

export interface AgentSwarmResultStatus {
  readonly index: number;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly verdict?: string;
  readonly evidenceIds?: readonly string[];
  readonly ultraSwarm?: UltraSwarmMemberMetadata;
  readonly completedText?: string;
  readonly failureText?: string;
}

export interface UltraSwarmIntegrationReportAgent {
  readonly expertId: string;
  readonly name: string;
  readonly emoji?: string;
  readonly phase: string;
  readonly focus?: string;
  readonly outcome: string;
  readonly verdict: string;
  readonly summary?: string;
  readonly findings?: string;
  readonly risksAndGaps?: string;
}

export interface UltraSwarmIntegrationReport {
  readonly headline: string;
  readonly agents: readonly UltraSwarmIntegrationReportAgent[];
  readonly openGaps?: string;
}

export interface AgentSwarmResultSummary {
  readonly completed: number;
  readonly failed: number;
  readonly aborted: number;
  readonly parsed: boolean;
}

export function agentSwarmItemsFromArgs(args: Record<string, unknown>): string[] {
  const items = args['items'];
  if (!Array.isArray(items)) return [];
  return items.map(String);
}

export function agentSwarmResumeItemsFromArgs(args: Record<string, unknown>): string[] {
  const resumeAgentIds = args['resume_agent_ids'];
  if (
    typeof resumeAgentIds !== 'object' ||
    resumeAgentIds === null ||
    Array.isArray(resumeAgentIds)
  ) {
    return [];
  }
  return Object.keys(resumeAgentIds).map(() => RESUMED_ITEM_LABEL);
}

export function ultraSwarmExpertItemsFromArgs(args: Record<string, unknown>): string[] {
  const experts = args['experts'];
  const requiredExperts = args['required_experts'];
  return [
    ...(Array.isArray(experts) ? experts.map(String) : []),
    ...(Array.isArray(requiredExperts) ? requiredExperts.map(String) : []),
  ];
}

export function agentSwarmPartialItemsCountFromArguments(argumentsText: string): number {
  return agentSwarmPartialItemsFromArguments(argumentsText).length;
}

export function swarmWorkItemsStartedFromArguments(argumentsText: string): boolean {
  return (
    /"items"\s*:/.test(argumentsText) ||
    /"resume_agent_ids"\s*:/.test(argumentsText) ||
    /"experts"\s*:/.test(argumentsText) ||
    /"required_experts"\s*:/.test(argumentsText)
  );
}

export function agentSwarmPartialItemsFromArguments(argumentsText: string): string[] {
  const match = /"items"\s*:\s*\[/.exec(argumentsText);
  if (match === null) return [];
  const items: string[] = [];
  for (let i = match.index + match[0].length; i < argumentsText.length; i += 1) {
    const ch = argumentsText[i];
    if (ch === ']') return items;
    if (ch !== '"') continue;

    const parsed = parsePartialJsonString(argumentsText, i + 1);
    items.push(parsed.value);
    if (parsed.closed) {
      i = parsed.nextIndex;
      continue;
    }
    return items;
  }
  return items;
}

export function agentSwarmPartialResumeItemsFromArguments(argumentsText: string): string[] {
  const match = /"resume_agent_ids"\s*:\s*\{/.exec(argumentsText);
  if (match === null) return [];
  return Array.from(
    { length: countPartialJsonObjectEntries(argumentsText, match.index + match[0].length) },
    () => RESUMED_ITEM_LABEL,
  );
}

export function ultraSwarmPartialExpertItemsFromArguments(argumentsText: string): string[] {
  return [
    ...partialStringArrayFromArguments(argumentsText, 'experts'),
    ...partialStringArrayFromArguments(argumentsText, 'required_experts'),
  ];
}

function partialStringArrayFromArguments(argumentsText: string, field: string): string[] {
  const match = new RegExp(`"${field}"\\s*:\\s*\\[`).exec(argumentsText);
  if (match === null) return [];
  const items: string[] = [];
  for (let i = match.index + match[0].length; i < argumentsText.length; i += 1) {
    const ch = argumentsText[i];
    if (ch === ']') return items;
    if (ch !== '"') continue;

    const parsed = parsePartialJsonString(argumentsText, i + 1);
    items.push(parsed.value);
    if (parsed.closed) {
      i = parsed.nextIndex;
      continue;
    }
    return items;
  }
  return items;
}

export function agentSwarmDescriptionFromArgs(args: Record<string, unknown>): string {
  const description = args['description'];
  return typeof description === 'string' ? description : '';
}

export function agentSwarmPromptTemplateFromArgs(args: Record<string, unknown>): string {
  const promptTemplate = args['prompt_template'];
  return typeof promptTemplate === 'string' ? promptTemplate : '';
}

export function agentSwarmPartialPromptTemplateFromArguments(argumentsText: string): string {
  const match = /"prompt_template"\s*:\s*"/.exec(argumentsText);
  if (match === null) return '';
  return parsePartialJsonString(argumentsText, match.index + match[0].length).value;
}

export function agentSwarmResultSummaryFromOutput(output: string): AgentSwarmResultSummary {
  const statuses = parseAgentSwarmResultStatuses(output);
  let completed = 0;
  let failed = 0;
  let aborted = 0;
  for (const status of statuses) {
    if (status.status === 'completed') completed += 1;
    if (status.status === 'failed') failed += 1;
    if (status.status === 'cancelled') aborted += 1;
  }
  return {
    completed,
    failed,
    aborted,
    parsed: statuses.length > 0,
  };
}

export function parseAgentSwarmResultStatuses(output: string): AgentSwarmResultStatus[] {
  const xmlStatuses = parseAgentSwarmXmlResultStatuses(output);
  if (xmlStatuses.length > 0) return xmlStatuses;
  const ultraXmlStatuses = parseUltraSwarmXmlResultStatuses(output);
  if (ultraXmlStatuses.length > 0) return ultraXmlStatuses;
  return parseAgentSwarmLegacyResultStatuses(output);
}

export function forEachSubagentTag<T>(
  output: string,
  callback: (attrs: string, body: string, index: number) => T | undefined,
): T[] {
  const result: T[] = [];
  const tagPattern = /<subagent\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = tagPattern.exec(output)) !== null) {
    const attrs = match[1] ?? '';
    const closeIndex = output.indexOf('</subagent>', tagPattern.lastIndex);
    if (closeIndex < 0) break;
    const body = output.slice(tagPattern.lastIndex, closeIndex);
    index += 1;
    const value = callback(attrs, body, index);
    if (value !== undefined) result.push(value);
    tagPattern.lastIndex = closeIndex + '</subagent>'.length;
  }
  return result;
}

export function parseAgentSwarmXmlResultStatuses(output: string): AgentSwarmResultStatus[] {
  return forEachSubagentTag(output, (attrs, body, tagIndex) => {
    const explicitIndex = Number(xmlAttribute(attrs, 'index'));
    const index =
      Number.isInteger(explicitIndex) && explicitIndex > 0 ? explicitIndex : tagIndex;
    const outcome = xmlAttribute(attrs, 'outcome');
    if (
      outcome !== 'completed' &&
      outcome !== 'failed' &&
      outcome !== 'aborted' &&
      outcome !== 'cancelled'
    ) {
      return undefined;
    }
    return {
      index,
      status: outcome === 'aborted' || outcome === 'cancelled' ? 'cancelled' : outcome,
      completedText: outcome === 'completed' ? body : undefined,
      failureText: outcome === 'failed' ? body : undefined,
    };
  });
}

export function parseUltraSwarmXmlResultStatuses(output: string): AgentSwarmResultStatus[] {
  const result: AgentSwarmResultStatus[] = [];
  const tagPattern = /<expert\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = tagPattern.exec(output)) !== null) {
    const attrs = match[1] ?? '';
    const closeIndex = output.indexOf('</expert>', tagPattern.lastIndex);
    if (closeIndex < 0) break;
    const body = output.slice(tagPattern.lastIndex, closeIndex);
    index += 1;
    const outcome = xmlAttribute(attrs, 'outcome');
    if (
      outcome === 'completed' ||
      outcome === 'failed' ||
      outcome === 'aborted' ||
      outcome === 'cancelled'
    ) {
      result.push({
        index,
        status: outcome === 'aborted' || outcome === 'cancelled' ? 'cancelled' : outcome,
        verdict: xmlAttribute(attrs, 'verdict'),
        evidenceIds: commaSeparatedXmlAttribute(attrs, 'evidence_ids'),
        ultraSwarm: {
          expertId: xmlAttribute(attrs, 'expert_id') ?? xmlAttribute(attrs, 'name') ?? `expert-${String(index)}`,
          name: xmlAttribute(attrs, 'name') ?? `Expert ${String(index)}`,
          division: xmlAttribute(attrs, 'division'),
          emoji: xmlAttribute(attrs, 'emoji'),
          coverageLane: xmlAttribute(attrs, 'coverage_lane'),
          selectionReason: selectionReasonFromUltraSwarmBody(body),
          focus: xmlAttribute(attrs, 'focus'),
          dependsOn: commaSeparatedXmlAttribute(attrs, 'depends_on'),
          taskIds: commaSeparatedXmlAttribute(attrs, 'work_node_ids'),
        },
        completedText: outcome === 'completed' ? stripUltraSwarmMetadata(body) : undefined,
        failureText: outcome === 'failed' ? stripUltraSwarmMetadata(body) : undefined,
      });
    }
    tagPattern.lastIndex = closeIndex + '</expert>'.length;
  }
  return result;
}

export function parseUltraSwarmIntegrationReport(output: string): UltraSwarmIntegrationReport | undefined {
  const reportMatch = /<integration_report\b([^>]*)>([\s\S]*?)<\/integration_report>/i.exec(output);
  if (reportMatch === null) return undefined;

  const inner = reportMatch[2] ?? '';
  const headline = xmlElementText(inner, 'headline') ?? '';
  const openGaps = xmlElementText(inner, 'open_gaps');
  const agents: UltraSwarmIntegrationReportAgent[] = [];
  const agentPattern = /<agent\b([^>]*)>([\s\S]*?)<\/agent>/gi;
  let agentMatch: RegExpExecArray | null;
  while ((agentMatch = agentPattern.exec(inner)) !== null) {
    const attrs = agentMatch[1] ?? '';
    const body = agentMatch[2] ?? '';
    const expertId = xmlAttribute(attrs, 'expert_id');
    const name = xmlAttribute(attrs, 'name');
    if (expertId === undefined || name === undefined) continue;
    agents.push({
      expertId,
      name,
      emoji: xmlAttribute(attrs, 'emoji'),
      phase: xmlAttribute(attrs, 'phase') ?? 'unknown',
      focus: xmlAttribute(attrs, 'focus'),
      outcome: xmlAttribute(attrs, 'outcome') ?? 'unknown',
      verdict: xmlAttribute(attrs, 'verdict') ?? 'UNKNOWN',
      summary: xmlElementText(body, 'summary'),
      findings: xmlElementText(body, 'findings'),
      risksAndGaps: xmlElementText(body, 'risks_and_gaps'),
    });
  }

  if (agents.length === 0 && headline.length === 0) return undefined;
  return { headline, agents, openGaps };
}

function xmlElementText(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  const value = match?.[1]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function stripUltraSwarmMetadata(body: string): string {
  return body.replaceAll(/<selection_reason>[\s\S]*?<\/selection_reason>\n?/g, '').trim();
}

function selectionReasonFromUltraSwarmBody(body: string): string | undefined {
  const match = /<selection_reason>([\s\S]*?)<\/selection_reason>/.exec(body);
  return match?.[1]?.trim();
}

function commaSeparatedXmlAttribute(attrs: string, name: string): readonly string[] | undefined {
  const value = xmlAttribute(attrs, name);
  if (value === undefined || value.trim().length === 0) return undefined;
  const items = value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  return items.length === 0 ? undefined : items;
}

function xmlAttribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match?.[1];
}

function forEachAgentBlock<T>(
  output: string,
  callback: (block: string, index: number) => T | undefined,
): T[] {
  const result: T[] = [];
  for (const block of output.split(/\n(?=\[agent \d+\]\n)/)) {
    const indexMatch = /^\[agent (\d+)\]$/m.exec(block);
    if (indexMatch === null) continue;
    const value = callback(block, Number(indexMatch[1]));
    if (value !== undefined) result.push(value);
  }
  return result;
}

export function parseAgentSwarmLegacyResultStatuses(output: string): AgentSwarmResultStatus[] {
  return forEachAgentBlock(output, (block, index) => {
    const statusMatch = /^status: (completed|failed|aborted|cancelled)$/m.exec(block);
    if (statusMatch === null) return undefined;
    const status = statusMatch[1] as 'completed' | 'failed' | 'aborted' | 'cancelled';
    return {
      index,
      status: status === 'aborted' || status === 'cancelled' ? 'cancelled' : status,
      completedText: status === 'completed' ? parseAgentSwarmCompletedText(block) : undefined,
      failureText: status === 'failed' ? parseAgentSwarmFailureText(block) : undefined,
    };
  });
}

function parseAgentSwarmCompletedText(block: string): string | undefined {
  const marker = '\n[summary]\n';
  const markerIndex = block.indexOf(marker);
  if (markerIndex < 0) return undefined;
  return normalizeFinalOutputText(block.slice(markerIndex + marker.length));
}

function parseAgentSwarmFailureText(block: string): string | undefined {
  const match = /^subagent error:\s*([\s\S]*)$/m.exec(block);
  if (match === null) return undefined;
  return normalizeFailureText(match[1]);
}

export function normalizeFailureText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const nestedFailureText = nestedAgentSwarmFailureText(text);
  const normalized = stripAgentSwarmPrefix(collapseWhitespace(nestedFailureText ?? text));
  return normalized.length > 0 ? normalized : undefined;
}

function nestedAgentSwarmFailureText(text: string): string | undefined {
  const xmlFailureText = nestedAgentSwarmXmlFailureText(text);
  if (xmlFailureText !== undefined) return nestedAgentSwarmFailureText(xmlFailureText) ?? xmlFailureText;

  if (!/^\s*agent_swarm:\s*failed\b/m.test(text)) return undefined;
  const match = /^\s*subagent error:\s*([\s\S]*?)(?=\n\[agent \d+\]\n|$)/m.exec(text);
  if (match === null) return undefined;
  const failureText = match[1];
  if (failureText === undefined) return undefined;
  return nestedAgentSwarmFailureText(failureText) ?? failureText;
}

function nestedAgentSwarmXmlFailureText(text: string): string | undefined {
  if (!/<agent_swarm_result\b/.test(text)) return undefined;
  const failed = parseAgentSwarmXmlResultStatuses(text).find((entry) => {
    return entry.status === 'failed' && entry.failureText !== undefined;
  });
  return failed?.failureText;
}

function stripAgentSwarmPrefix(text: string): string {
  return text.replace(/^agent_swarm:\s*(?:failed|completed)?\s*/i, '').trim();
}

function countPartialJsonObjectEntries(text: string, startIndex: number): number {
  let count = 0;
  let expectKey = true;
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '}') return count;
    if (ch === ',') {
      expectKey = true;
      continue;
    }
    if (ch !== '"') continue;

    const parsed = parsePartialJsonString(text, i + 1);
    if (expectKey) {
      if (parsed.closed || parsed.value.length > 0) count += 1;
      expectKey = false;
    }
    if (!parsed.closed) return count;
    i = parsed.nextIndex;
  }
  return count;
}

function parsePartialJsonString(
  text: string,
  startIndex: number,
): { value: string; closed: boolean; nextIndex: number } {
  let value = '';
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') return { value, closed: true, nextIndex: i };
    if (ch !== '\\') {
      value += ch;
      continue;
    }

    const escaped = text[i + 1];
    if (escaped === undefined) return { value, closed: false, nextIndex: i };
    switch (escaped) {
      case 'n': value += '\n'; break;
      case 't': value += '\t'; break;
      case 'r': value += '\r'; break;
      case 'b': value += '\b'; break;
      case 'f': value += '\f'; break;
      case '"':
      case '\\':
      case '/':
        value += escaped;
        break;
      case 'u': {
        const hex = text.slice(i + 2, i + 6);
        if (hex.length < 4) return { value, closed: false, nextIndex: i };
        const code = Number.parseInt(hex, 16);
        if (Number.isNaN(code)) return { value, closed: false, nextIndex: i };
        value += String.fromCodePoint(code);
        i += 4;
        break;
      }
      default:
        value += escaped;
    }
    i += 1;
  }
  return { value, closed: false, nextIndex: text.length };
}
