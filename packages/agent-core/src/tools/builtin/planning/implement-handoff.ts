/**
 * Parse Plan Desk "Implement handoff" blocks into JobCreate-ready fields.
 * Mechanical compile of Seed Spec / AC into structured brief — no auto-spawn.
 */

import type { JobDeliveryMode, JobTddMode } from '../job/job-store-key';

export interface ImplementHandoff {
  readonly successCriteria: readonly string[];
  readonly mustNotTouch: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly ownershipPaths: readonly string[];
  readonly contextPaths: readonly string[];
  readonly testSeams: readonly string[];
  readonly tddMode?: JobTddMode;
  readonly deliveryMode: JobDeliveryMode;
}

const HANDOFF_HEADER = /^##\s*Implement handoff\s*$/im;

const LIST_KEYS = [
  'success_criteria',
  'must_not_touch',
  'verification_commands',
  'ownership_paths',
  'context_paths',
  'test_seams',
] as const;

type ListKey = (typeof LIST_KEYS)[number];

/**
 * Extract the handoff section from a plan summary / plan excerpt.
 * Returns undefined when the header is missing or required lists are empty
 * for greenfield (success_criteria + must_not_touch).
 */
export function parseImplementHandoff(text: string): ImplementHandoff | undefined {
  const raw = text.trim();
  if (raw.length === 0) return undefined;
  const headerMatch = HANDOFF_HEADER.exec(raw);
  if (headerMatch === null || headerMatch.index === undefined) return undefined;
  const body = raw.slice(headerMatch.index + headerMatch[0].length);
  // Stop at the next markdown H2 if present.
  const nextH2 = body.search(/\n##\s+\S/);
  const section = (nextH2 === -1 ? body : body.slice(0, nextH2)).trim();
  if (section.length === 0) return undefined;

  const lists: Record<ListKey, string[]> = {
    success_criteria: [],
    must_not_touch: [],
    verification_commands: [],
    ownership_paths: [],
    context_paths: [],
    test_seams: [],
  };
  let deliveryMode: JobDeliveryMode = 'standard';
  let tddMode: JobTddMode | undefined;
  let active: ListKey | undefined;

  for (const line of section.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const modeMatch = /^delivery_mode:\s*(greenfield|standard)\s*$/i.exec(trimmed);
    if (modeMatch !== null) {
      active = undefined;
      deliveryMode = modeMatch[1]!.toLowerCase() as JobDeliveryMode;
      continue;
    }
    const tddMatch = /^tdd_mode:\s*(required|preferred|off)\s*$/i.exec(trimmed);
    if (tddMatch !== null) {
      active = undefined;
      tddMode = tddMatch[1]!.toLowerCase() as JobTddMode;
      continue;
    }
    const keyMatch =
      /^(success_criteria|must_not_touch|verification_commands|ownership_paths|context_paths|test_seams)\s*:\s*$/i.exec(
        trimmed,
      );
    if (keyMatch !== null) {
      active = keyMatch[1]!.toLowerCase() as ListKey;
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet !== null && active !== undefined) {
      const item = bullet[1]!.trim();
      if (item.length > 0) lists[active].push(item);
    }
  }

  if (deliveryMode === 'greenfield') {
    if (lists.success_criteria.length === 0 || lists.must_not_touch.length === 0) {
      return undefined;
    }
  } else if (lists.success_criteria.length === 0 && lists.must_not_touch.length === 0) {
    // Standard handoff with zero structured content is useless — treat as missing.
    return undefined;
  }

  return {
    successCriteria: lists.success_criteria,
    mustNotTouch: lists.must_not_touch,
    verificationCommands: lists.verification_commands,
    ownershipPaths: lists.ownership_paths,
    contextPaths: lists.context_paths,
    testSeams: lists.test_seams,
    tddMode,
    deliveryMode,
  };
}

/** Compact JobCreate draft for JobInspect / desk Next-move. */
export function renderImplementHandoffDraft(handoff: ImplementHandoff): string {
  const lines = [
    'implement_handoff (JobCreate draft — copy fields; do not invent a new brief):',
    `delivery_mode: ${handoff.deliveryMode}`,
  ];
  if (handoff.deliveryMode === 'greenfield') {
    lines.push(
      'greenfield_chain: true  # preferred after ultra plan approval; runtime splits skeleton/fill/delete-pass contracts',
    );
  }
  if (handoff.tddMode !== undefined) {
    lines.push(`tdd_mode: ${handoff.tddMode}`);
  }
  const pushList = (key: string, items: readonly string[]): void => {
    if (items.length === 0) return;
    lines.push(`${key}: [${items.map((i) => JSON.stringify(i)).join(', ')}]`);
  };
  pushList('success_criteria', handoff.successCriteria);
  pushList('must_not_touch', handoff.mustNotTouch);
  pushList('verification_commands', handoff.verificationCommands);
  pushList('ownership_paths', handoff.ownershipPaths);
  pushList('context_paths', handoff.contextPaths);
  pushList('test_seams', handoff.testSeams);
  return lines.join('\n');
}

/** True when a completed mission/plan job summary looks like it should carry a handoff. */
export function textLooksLikePlanCompletion(summary: string | undefined): boolean {
  if (summary === undefined || summary.trim().length === 0) return false;
  return HANDOFF_HEADER.test(summary) || /\b(seed spec|ac tree|workgraph|plan path)\b/i.test(summary);
}

const NOT_YET_SPECIFIED = /^##\s*Not yet specified\s*$/im;

/**
 * Wayfinder-lite fog: a non-empty "## Not yet specified" section that still
 * lists open decision fog — Conductor must not spawn implement Jobs yet.
 */
export function missionHasBlockingFog(summary: string | undefined): boolean {
  if (summary === undefined || summary.trim().length === 0) return false;
  const match = NOT_YET_SPECIFIED.exec(summary);
  if (match === null || match.index === undefined) return false;
  const body = summary.slice(match.index + match[0].length);
  const nextH2 = body.search(/\n##\s+\S/);
  const section = (nextH2 === -1 ? body : body.slice(0, nextH2)).trim();
  if (section.length === 0) return false;
  // Empty / placeholder fog does not block.
  if (/^(?:none|n\/a|—|-|empty)\s*$/i.test(section)) return false;
  // At least one bullet or non-trivial line.
  return /(?:^|\n)\s*[-*]\s+\S/.test(section) || section.length > 20;
}
