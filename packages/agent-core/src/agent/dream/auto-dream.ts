import { copyFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { createProvider, type ChatProvider, type GenerateResult, type Message } from '@superliora/kosong';
import type { Agent } from '../index';
import type { LioraRecallStore } from '../../memory/store';
import type { MemoryRecord } from '../../memory/types';

const DEFAULT_MIN_HOURS_SINCE_LAST_DREAM = 4;
const DEFAULT_MIN_ACTIVE_RECORDS = 8;
const MAX_RECORDS_PER_DREAM = 200;

export interface AutoDreamOptions { readonly minHoursSinceLastDream?: number; readonly minActiveRecords?: number; }
interface MergeGroup { readonly keeperId: string; readonly duplicateIds: readonly string[]; readonly mergedSubject?: string; readonly mergedContent?: string; }
interface DreamPlan { readonly merges: readonly MergeGroup[]; }
interface DreamResult { readonly examined: number; readonly semanticMerged: number; }

export interface AutoDreamSnapshot {
  readonly enabled: boolean;
  readonly inFlight: boolean;
  readonly runs: number;
  readonly lastDreamAt: number | null;
  readonly lastExamined: number | null;
  readonly lastMerged: number | null;
  readonly minHours: number;
  readonly minActiveRecords: number;
}

export class AutoDreamService {
  private inFlight = false;
  private lastDreamAt = 0;
  private runs = 0;
  private lastExamined: number | null = null;
  private lastMerged: number | null = null;
  private readonly minHours: number;
  private readonly minActiveRecords: number;
  constructor(private readonly agent: Agent, private readonly store: LioraRecallStore, options: AutoDreamOptions = {}) {
    this.minHours = options.minHoursSinceLastDream ?? DEFAULT_MIN_HOURS_SINCE_LAST_DREAM;
    this.minActiveRecords = options.minActiveRecords ?? DEFAULT_MIN_ACTIVE_RECORDS;
  }

  /** Operator-facing snapshot for /status Memory transparency. */
  snapshot(): AutoDreamSnapshot {
    return {
      enabled: this.agent.experimentalFlags.enabled('auto_dream'),
      inFlight: this.inFlight,
      runs: this.runs,
      lastDreamAt: this.lastDreamAt > 0 ? this.lastDreamAt : null,
      lastExamined: this.lastExamined,
      lastMerged: this.lastMerged,
      minHours: this.minHours,
      minActiveRecords: this.minActiveRecords,
    };
  }

  maybeSchedule(): void {
    if (!this.agent.experimentalFlags.enabled('auto_dream')) return;
    if (this.inFlight) return;
    if ((Date.now() - this.lastDreamAt) / 3_600_000 < this.minHours) return;
    // Fire-and-forget; cheap gate already passed. Failures stay local to memory.
    void this.runDream().catch((e) => {
      this.agent.log.warn('auto-dream failed', e);
    });
  }
  private async runDream(): Promise<DreamResult | undefined> {
    this.inFlight = true;
    const backupPath = this.backupStore();
    try {
      const active = await this.store.list({ status: 'active', limit: MAX_RECORDS_PER_DREAM });
      if (active.length < this.minActiveRecords) {
        this.lastExamined = active.length;
        this.lastMerged = 0;
        return { examined: active.length, semanticMerged: 0 };
      }
      const plan = await this.planConsolidation(active);
      if (plan.merges.length === 0) {
        this.lastDreamAt = Date.now();
        this.runs += 1;
        this.lastExamined = active.length;
        this.lastMerged = 0;
        return { examined: active.length, semanticMerged: 0 };
      }
      const merged = await this.applyPlan(plan);
      this.lastDreamAt = Date.now();
      this.runs += 1;
      this.lastExamined = active.length;
      this.lastMerged = merged;
      this.discardBackup(backupPath);
      return { examined: active.length, semanticMerged: merged };
    } catch (e) { this.restoreBackup(backupPath); throw e; }
    finally { this.inFlight = false; }
  }
  private async planConsolidation(records: readonly MemoryRecord[]): Promise<DreamPlan> {
    const provider = this.resolveProvider();
    const catalog = records.map((r) => ({ id: r.id, kind: r.kind, subject: r.subject, content: r.content.slice(0, 500) }));
    const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: buildDreamPrompt(catalog) }], toolCalls: [] }];
    const response = await this.agent.generate(provider, DREAM_SYSTEM_PROMPT, [], messages, undefined, { signal: new AbortController().signal });
    const text = extractText(response);
    if (text.trim().length === 0) throw new Error('auto-dream: empty plan');
    return parseDreamPlan(text, records);
  }
  private async applyPlan(plan: DreamPlan): Promise<number> {
    let merged = 0;
    for (const m of plan.merges) {
      if (m.mergedSubject !== undefined || m.mergedContent !== undefined) await this.store.update(m.keeperId, { ...(m.mergedSubject ? { subject: m.mergedSubject } : {}), ...(m.mergedContent ? { content: m.mergedContent } : {}) });
      for (const d of m.duplicateIds) { await this.store.update(d, { status: 'superseded', supersededBy: m.keeperId }); merged += 1; }
    }
    return merged;
  }
  private resolveProvider(): ChatProvider {
    const alias = this.agent.kimiConfig?.loopControl?.compactionModel;
    const resolved = alias ? this.agent.modelProvider?.resolveProviderConfig(alias) : undefined;
    return (resolved ? createProvider(resolved.provider) : this.agent.config.provider).withThinking('off');
  }
  private backupStore(): string { const p = this.store.getStorePath(); const b = `${p}.dream-bak-${Date.now()}`; copyFileSync(p, b); return b; }
  private restoreBackup(b: string): void { const p = this.store.getStorePath(); if (existsSync(b)) try { renameSync(b, p); } catch { /* best-effort */ } }
  private discardBackup(b: string): void { try { unlinkSync(b); } catch { /* gone */ } }
}

const DREAM_SYSTEM_PROMPT = 'You are a memory-consolidation engine. Find near-duplicate or overlapping memory records to merge. Respond with ONLY JSON: {"merges":[{"keeperId":"<id>","duplicateIds":["<id>"],"mergedSubject":"<opt>","mergedContent":"<opt>"}]}. If nothing overlaps return {"merges":[]}.';
function buildDreamPrompt(c: readonly { id: string; kind: string; subject: string; content: string }[]): string {
  return `Catalog of ${c.length} records:\n${c.map((r) => `- id=${r.id} kind=${r.kind} subject=${JSON.stringify(r.subject)} content=${JSON.stringify(r.content)}`).join('\n')}\n\nReturn merge JSON.`;
}
function extractText(r: GenerateResult): string { const c = r.message.content; return typeof c === 'string' ? c : c.map((p) => p.type === 'text' ? p.text : '').join(''); }
export function parseDreamPlan(text: string, records: readonly MemoryRecord[]): DreamPlan {
  const validIds = new Set(records.map((r) => r.id));
  const m = /\{[\s\S]*\}/.exec(text); if (!m) return { merges: [] };
  let p: unknown; try { p = JSON.parse(m[0]); } catch { return { merges: [] }; }
  const raw = (p as { merges?: unknown })['merges']; if (!Array.isArray(raw)) return { merges: [] };
  const merges: MergeGroup[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const k = (r as Record<string, unknown>)['keeperId']; const d = (r as Record<string, unknown>)['duplicateIds'];
    const keeperId = typeof k === 'string' ? k : undefined; const dups = Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : [];
    if (!keeperId || !validIds.has(keeperId)) continue;
    const valid = dups.filter((x) => validIds.has(x) && x !== keeperId); if (!valid.length) continue;
    merges.push({ keeperId, duplicateIds: valid, mergedSubject: typeof (r as Record<string, unknown>)['mergedSubject'] === 'string' ? (r as Record<string, unknown>)['mergedSubject'] as string : undefined, mergedContent: typeof (r as Record<string, unknown>)['mergedContent'] === 'string' ? (r as Record<string, unknown>)['mergedContent'] as string : undefined });
  }
  return { merges };
}
export const DREAM_BACKUP_SUFFIX = '.dream-bak';
