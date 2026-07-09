import { createHash } from 'node:crypto';
import type { AutopilotCard, AutopilotCardSource } from '@superliora/protocol';
const BUG = ['bug', 'crash', 'error', 'fail', 'broken', 'regression', 'panic', 'leak'];
const URGENT = ['urgent', 'critical', 'blocker', 'security', ' cve', 'production down'];
const BASE: Record<AutopilotCardSource, number> = { 'github-issue': 50, 'github-pr': 40, manual: 70, 'cron-scan': 30 };
export interface RawCardInput { readonly source: AutopilotCardSource; readonly title: string; readonly body: string; readonly refNumber?: number; }
export function buildCard(i: RawCardInput, now = Date.now()): AutopilotCard {
  const fp = fp2(i), sc = score(i);
  return { id: `card_${fp.slice(0, 16)}`, source: i.source, title: i.title, body: i.body, fingerprint: fp, score: sc, status: 'queued', refNumber: i.refNumber, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), attempts: 0 };
}
export function dedupeCards(cards: readonly AutopilotCard[]): AutopilotCard[] {
  const m = new Map<string, AutopilotCard>(); for (const c of cards) { const e = m.get(c.fingerprint); if (!e || c.score > e.score) m.set(c.fingerprint, c); } return [...m.values()];
}
export function pickNextCard(cards: readonly AutopilotCard[]): AutopilotCard | undefined { const q = cards.filter((c) => c.status === 'queued'); return q.length ? q.toSorted((a, b) => b.score - a.score)[0] : undefined; }
function fp2(i: RawCardInput): string { return createHash('sha256').update(`${i.source}\0${i.refNumber ?? ''}\0${i.title.trim().toLowerCase().replaceAll(/\s+/g, ' ')}`).digest('hex'); }
function score(i: RawCardInput): number { const t = `${i.title} ${i.body}`.toLowerCase(); let s = BASE[i.source] ?? 30; for (const k of BUG) if (t.includes(k)) s += 10; for (const k of URGENT) if (t.includes(k)) s += 15; return Math.min(s, 100); }
