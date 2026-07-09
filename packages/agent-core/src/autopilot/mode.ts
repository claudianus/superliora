import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AutopilotCard, AutopilotRun } from '@superliora/protocol';
import type { Agent } from '../agent';
import { buildCard, dedupeCards, pickNextCard, type RawCardInput } from './intake';
import { commitAll, createWorktree, removeWorktree, runGit, runGh } from './git';
import { findUnsafeVerificationCommand, parseVerificationCommand, type VerificationCommand, type AutopilotVerificationResult } from './verification';

const MAX_ATTEMPTS = 3;
export interface AutopilotPolicy { readonly baseBranch: string; readonly mergeLabel: string; readonly verificationCommands: readonly VerificationCommand[]; readonly maxAttempts?: number; }
const DEFAULT_POLICY: AutopilotPolicy = { baseBranch: 'main', mergeLabel: 'autopilot:merge', verificationCommands: ['pnpm run build', 'pnpm run check:imports'], maxAttempts: MAX_ATTEMPTS };

export class AutopilotMode {
  private cards: Map<string, AutopilotCard> = new Map();
  private runs: Map<string, AutopilotRun> = new Map();
  private policy: AutopilotPolicy = DEFAULT_POLICY;
  private inFlight = false;
  constructor(private readonly agent: Agent) {}
  isEnabled(): boolean { return this.agent.experimentalFlags.enabled('auto_pilot'); }
  getCards(): readonly AutopilotCard[] { return [...this.cards.values()]; }
  getActiveRun(): AutopilotRun | undefined { return [...this.runs.values()].find((r) => r.status === 'running' || r.status === 'verifying'); }
  setPolicy(p: Partial<AutopilotPolicy>): void { this.policy = { ...this.policy, ...p }; }
  ingest(inputs: readonly RawCardInput[]): readonly AutopilotCard[] { const f = inputs.map((i) => buildCard(i)); this.cards = new Map(dedupeCards([...this.cards.values(), ...f]).map((c) => [c.id, c])); return f; }
  async tick(): Promise<AutopilotRun | undefined> {
    if (!this.isEnabled() || this.inFlight) return this.inFlight ? this.getActiveRun() : (pickNextCard([...this.cards.values()]) ? undefined : undefined);
    const card = pickNextCard([...this.cards.values()]); if (!card) return undefined;
    this.inFlight = true; try { return await this.runCard(card); } finally { this.inFlight = false; }
  }
  private async runCard(card: AutopilotCard): Promise<AutopilotRun> {
    const max = this.policy.maxAttempts ?? MAX_ATTEMPTS, root = this.agent.config.cwd;
    const runId = `run_${randomUUID().slice(0, 12)}`, branch = `autopilot/${card.id}`;
    const wt = join(root, '.autopilot-worktrees', `autopilot-${runId}`);
    let attempt = card.attempts, lastError: string | undefined;
    let run: AutopilotRun = { id: runId, cardId: card.id, status: 'running', worktreePath: wt, branch, attempt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.runs.set(runId, run); this.upd(card.id, { status: 'running', runId });
    await createWorktree(this.agent.kaos, root, wt, branch, this.policy.baseBranch);
    try {
      while (attempt < max) {
        attempt++; run = { ...run, attempt, updatedAt: new Date().toISOString() }; this.runs.set(runId, run); this.upd(card.id, { attempts: attempt });
        this.agent.turn.prompt([{ type: 'text', text: `Autopilot task: ${card.title}\n\n${card.body}\n\nWorking directory: ${wt}\nImplement the change and verify.` }], { kind: 'system_trigger', name: 'autopilot_step' });
        run = { ...run, status: 'verifying', updatedAt: new Date().toISOString() }; this.runs.set(runId, run);
        const v = await this.verify(wt); if (!v.passed) { lastError = v.output; continue; }
        await commitAll(this.agent.kaos, wt, `autopilot: ${card.title}`);
        const push = await runGit(this.agent.kaos, wt, ['push', '-u', 'origin', branch]); if (!push.ok) { lastError = `push failed: ${push.stderr}`; break; }
        const pr = await runGh(this.agent.kaos, ['pr', 'create', '--fill', '--body', `Autopilot: ${card.title}\n${card.body}`, '--head', branch, '--label', 'autopilot']); if (!pr.ok) { lastError = `pr create failed: ${pr.stderr}`; break; }
        run = { ...run, status: 'pr-open', prUrl: pr.stdout.trim(), verificationSummary: v.output.slice(0, 2000), updatedAt: new Date().toISOString() };
        this.runs.set(runId, run); this.upd(card.id, { status: 'pr-open' }); return run;
      }
      run = { ...run, status: 'failed', lastError, updatedAt: new Date().toISOString() }; this.runs.set(runId, run); this.upd(card.id, { status: 'failed', lastError }); return run;
    } catch (e) { lastError = e instanceof Error ? e.message : String(e); run = { ...run, status: 'failed', lastError, updatedAt: new Date().toISOString() }; this.runs.set(runId, run); this.upd(card.id, { status: 'failed', lastError }); return run; }
    finally { await removeWorktree(this.agent.kaos, root, wt).catch(() => {}); }
  }
  private async verify(cwd: string): Promise<AutopilotVerificationResult> {
    const unsafe = findUnsafeVerificationCommand(this.policy.verificationCommands);
    if (unsafe) return { passed: false, output: `Rejected unsafe: ${typeof unsafe === 'string' ? unsafe : unsafe.command}` };
    const outs: string[] = [];
    for (const cmd of this.policy.verificationCommands) {
      const p = parseVerificationCommand(cmd)!; const proc = await this.agent.kaos.exec(...p.tokens); proc.stdin.end();
      const o = collect(proc.stdout), e = collect(proc.stderr); const code = await proc.wait(); const oo = await o, ee = await e;
      if (code !== 0) return { passed: false, output: `${oo}\n${ee}`, failedCommand: typeof cmd === 'string' ? cmd : cmd.command };
      outs.push(oo);
    }
    return { passed: true, output: outs.join('\n---\n') };
  }
  private upd(id: string, patch: Partial<Pick<AutopilotCard, 'status' | 'attempts' | 'runId' | 'lastError'>>): void { const e = this.cards.get(id); if (e) this.cards.set(id, { ...e, ...patch, updatedAt: new Date().toISOString() }); }
}
function collect(s: NodeJS.ReadableStream): Promise<string> { return new Promise((r) => { let d = ''; s.setEncoding('utf8'); s.on('data', (c) => { d += c; }); s.on('end', () => r(d)); s.on('error', () => r(d)); }); }
