/**
 * Apply + rollback for harness edits.
 *
 * Every applied edit records a HarnessRefinementEvent carrying before/after
 * snapshots; rollback replays the inverse. Ledger kinds (prompt/subagent)
 * use optimistic concurrency via expectedVersion; memory/skill kinds write
 * through to their real stores and snapshot the prior state for restore.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'pathe';

import type { Agent } from '..';
import type { MemoryRecord } from '../../memory/types';
import { parseSkillMetadataFromFile } from '../../skill/parser';
import {
  autoSkillsRoot,
  readIfExists,
  renderSkillMd,
} from '../../tools/builtin/fleet/skill-create';
import type { HarnessEdit } from './plan';
import {
  findEntry,
  removeEntry,
  upsertEntry,
  type HarnessEntry,
  type HarnessEntryKind,
  type HarnessRefinementEvent,
  type HarnessScope,
  type HarnessState,
} from './state';

export class HarnessApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessApplyError';
  }
}

export interface ApplyContext {
  readonly agent: Agent;
  readonly state: HarnessState;
  readonly scope: HarnessScope;
  readonly now?: () => number;
}

/** Apply one validated edit; returns the recorded event (status applied). */
export async function applyHarnessEdit(
  context: ApplyContext,
  edit: HarnessEdit,
): Promise<HarnessRefinementEvent> {
  switch (edit.kind) {
    case 'prompt':
    case 'subagent':
      return applyLedgerEdit(context, { ...edit, kind: edit.kind });
    case 'memory':
      return applyMemoryEdit(context, edit);
    case 'skill':
      return applySkillEdit(context, edit);
  }
}

function applyLedgerEdit(
  context: ApplyContext,
  edit: HarnessEdit & { readonly kind: HarnessEntryKind },
): HarnessRefinementEvent {
  const { state, scope } = context;
  const now = context.now?.() ?? Date.now();
  const kind = edit.kind;
  const base = {
    id: randomUUID(),
    at: now,
    scope,
    kind,
    summary: edit.evidence,
    status: 'applied' as const,
  };

  if (edit.operation === 'create') {
    const content = requireField(edit.content, 'content', edit);
    const entry: HarnessEntry = {
      id: randomUUID(),
      kind,
      title: requireField(edit.title, 'title', edit),
      content,
      path: kind === 'subagent' ? (edit.path ?? '') : '',
      scope,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    upsertEntry(state, entry);
    return { ...base, targetId: entry.id, before: undefined, after: entry };
  }

  const targetId = requireField(edit.targetId, 'targetId', edit);
  const existing = findEntry(state, kind, targetId);
  if (existing === undefined) {
    throw new HarnessApplyError(`${kind} entry "${targetId}" not found.`);
  }
  if (edit.expectedVersion !== undefined && edit.expectedVersion !== existing.version) {
    throw new HarnessApplyError(
      `${kind} entry "${targetId}" version conflict: expected ${String(edit.expectedVersion)}, current ${String(existing.version)}. Re-plan against the current state.`,
    );
  }

  if (edit.operation === 'delete') {
    removeEntry(state, kind, targetId);
    return { ...base, targetId, before: existing, after: undefined };
  }

  const updated: HarnessEntry = {
    ...existing,
    title: edit.title ?? existing.title,
    content: edit.content ?? existing.content,
    path: kind === 'subagent' ? (edit.path ?? existing.path) : existing.path,
    version: existing.version + 1,
    updatedAt: now,
  };
  upsertEntry(state, updated);
  return { ...base, targetId, before: existing, after: updated };
}

async function applyMemoryEdit(
  context: ApplyContext,
  edit: HarnessEdit,
): Promise<HarnessRefinementEvent> {
  const memory = context.agent.memory;
  if (memory === undefined || !memory.isEnabled()) {
    throw new HarnessApplyError('Memory store is not enabled in this session.');
  }
  const now = context.now?.() ?? Date.now();
  const base = {
    id: randomUUID(),
    at: now,
    scope: context.scope,
    kind: 'memory' as const,
    summary: edit.evidence,
    status: 'applied' as const,
  };
  // Refine scope mapping: local = this workspace, global = across workspaces.
  const memoryScope = context.scope === 'global' ? 'user' : 'workspace';

  if (edit.operation === 'create') {
    const record = await memory.remember({
      type: 'rule',
      scope: memoryScope,
      subject: requireField(edit.subject, 'subject', edit),
      content: requireField(edit.content, 'content', edit),
      ...(edit.tags !== undefined ? { tags: edit.tags } : {}),
    });
    return { ...base, targetId: record.id, before: undefined, after: record };
  }

  const targetId = requireField(edit.targetId, 'targetId', edit);
  const existing = await memory.get(targetId);
  if (existing === undefined) {
    throw new HarnessApplyError(`memory record "${targetId}" not found.`);
  }

  if (edit.operation === 'delete') {
    await memory.forget(targetId);
    return { ...base, targetId, before: existing, after: undefined };
  }

  const updated = await memory.update(targetId, {
    ...(edit.subject !== undefined ? { subject: edit.subject } : {}),
    ...(edit.content !== undefined ? { content: edit.content } : {}),
    ...(edit.tags !== undefined ? { tags: edit.tags } : {}),
  });
  return { ...base, targetId, before: existing, after: updated };
}

async function applySkillEdit(
  context: ApplyContext,
  edit: HarnessEdit,
): Promise<HarnessRefinementEvent> {
  const { agent } = context;
  const now = context.now?.() ?? Date.now();
  const base = {
    id: randomUUID(),
    at: now,
    scope: context.scope,
    kind: 'skill' as const,
    summary: edit.evidence,
    status: 'applied' as const,
  };
  const name = requireField(edit.name ?? edit.targetId, 'name', edit);
  const skillDir = path.join(autoSkillsRoot(agent.config.cwd), name);
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const before = await readIfExists(skillMdPath);

  if (edit.operation === 'delete') {
    if (before === undefined) {
      throw new HarnessApplyError(`skill "${name}" not found at ${skillMdPath}.`);
    }
    await fs.rm(skillDir, { recursive: true, force: true });
    agent.skills?.registry?.unregister?.(name);
    return { ...base, targetId: name, before, after: undefined };
  }

  const content = renderSkillMd({
    name,
    description: requireField(edit.description, 'description', edit),
    ...(edit.whenToUse !== undefined ? { whenToUse: edit.whenToUse } : {}),
    body: requireField(edit.body, 'body', edit),
  });
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillMdPath, content, 'utf-8');
  await registerSkill(agent, skillMdPath, name);
  return { ...base, targetId: name, before, after: content };
}

async function registerSkill(agent: Agent, skillMdPath: string, name: string): Promise<void> {
  const registry = agent.skills?.registry;
  if (registry?.register === undefined) return;
  const parsed = await parseSkillMetadataFromFile({
    skillMdPath,
    skillDirName: name,
    source: 'project',
  });
  registry.register(parsed, { replace: true });
}

/**
 * Replay the inverse of an applied event. Throws HarnessApplyError when the
 * current state no longer matches the event's `after` snapshot (someone else
 * touched the target since).
 */
export async function rollbackHarnessEvent(
  context: ApplyContext,
  event: HarnessRefinementEvent,
): Promise<void> {
  if (event.status !== 'applied') {
    throw new HarnessApplyError(`Refinement ${event.id} is not applied (status: ${event.status}).`);
  }
  switch (event.kind) {
    case 'prompt':
    case 'subagent':
      rollbackLedgerEvent(context, event.kind, event);
      return;
    case 'memory':
      await rollbackMemoryEvent(context, event);
      return;
    case 'skill':
      await rollbackSkillEvent(context, event);
      return;
  }
}

function rollbackLedgerEvent(
  context: ApplyContext,
  kind: HarnessEntryKind,
  event: HarnessRefinementEvent,
): void {
  const { state } = context;
  const after = event.after as HarnessEntry | undefined;
  const before = event.before as HarnessEntry | undefined;

  if (after !== undefined) {
    const current = findEntry(state, kind, event.targetId);
    if (current === undefined) {
      throw new HarnessApplyError(
        `Cannot roll back ${event.id}: ${kind} entry "${event.targetId}" no longer exists.`,
      );
    }
    if (current.version !== after.version) {
      throw new HarnessApplyError(
        `Cannot roll back ${event.id}: ${kind} entry "${event.targetId}" is at v${String(current.version)}, expected v${String(after.version)}.`,
      );
    }
  }

  if (before === undefined) {
    removeEntry(state, kind, event.targetId);
  } else {
    upsertEntry(state, before);
  }
}

async function rollbackMemoryEvent(
  context: ApplyContext,
  event: HarnessRefinementEvent,
): Promise<void> {
  const memory = context.agent.memory;
  if (memory === undefined || !memory.isEnabled()) {
    throw new HarnessApplyError('Memory store is not enabled in this session.');
  }
  const before = event.before as MemoryRecord | undefined;
  const after = event.after as MemoryRecord | undefined;

  if (before === undefined && after !== undefined) {
    // Created by the event → forget it.
    await memory.forget(after.id);
    return;
  }
  if (before !== undefined && after === undefined) {
    // Deleted by the event → re-create. ponytail: the restored record gets a
    // fresh id; links/evidenceRefs pointing at the old id are not reattached.
    await memory.remember({
      type: before.type,
      epistemic: before.epistemic,
      scope: before.scope,
      ...(before.scopeKey !== undefined ? { scopeKey: before.scopeKey } : {}),
      subject: before.subject,
      content: before.content,
      tags: before.tags,
      confidence: before.confidence,
      importance: before.importance,
    });
    return;
  }
  if (before !== undefined) {
    await memory.update(event.targetId, {
      subject: before.subject,
      content: before.content,
      tags: before.tags,
    });
    return;
  }
  throw new HarnessApplyError(`Refinement ${event.id} has no snapshots to roll back from.`);
}

async function rollbackSkillEvent(
  context: ApplyContext,
  event: HarnessRefinementEvent,
): Promise<void> {
  const { agent } = context;
  const name = event.targetId;
  const skillDir = path.join(autoSkillsRoot(agent.config.cwd), name);
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const before = event.before as string | undefined;

  if (before === undefined) {
    // Created by the event → remove it.
    await fs.rm(skillDir, { recursive: true, force: true });
    agent.skills?.registry?.unregister?.(name);
    return;
  }
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillMdPath, before, 'utf-8');
  await registerSkill(agent, skillMdPath, name);
}

function requireField(value: string | undefined, field: string, edit: HarnessEdit): string {
  if (value === undefined || value.trim().length === 0) {
    throw new HarnessApplyError(
      `${edit.kind} ${edit.operation} edit is missing required field "${field}".`,
    );
  }
  return value;
}
