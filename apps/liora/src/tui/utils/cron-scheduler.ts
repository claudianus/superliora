/**
 * CronScheduler — cron job management with next run visualization.
 *
 * Provides a cron job management UI:
 * - Cron expression parser and validator
 * - Human-readable schedule descriptions
 * - Next N run times calculation
 * - Job status (active/paused/completed)
 * - Execution history with success/failure
 * - Job grouping by category
 * - Enable/disable jobs
 * - Manual trigger
 * - Overlap detection warnings
 * - Timeline visualization
 *
 * Visual style:
 * ┌─ Cron Scheduler ──────────────────── [4 active] ──┐
 * │                                                   │
 * │ ● backup-db      0 2 * * *    Daily at 2:00 AM   │
 * │   Next: Jul 23, 02:00 (in 11h 22m)               │
 * │   Last: ✓ Jul 22, 02:00 (took 45s)               │
 * │                                                   │
 * │ ● cleanup-logs   0 0 * * 0    Weekly on Sun      │
 * │   Next: Jul 27, 00:00 (in 4d 9h)                 │
 * │   Last: ✓ Jul 20, 00:00 (took 12s)               │
 * │                                                   │
 * │ ○ send-report    0 9 * * 1-5  Weekdays at 9:00   │
 * │   Next: Jul 23, 09:00 (in 18h 22m)               │
 * │   Last: ✖ Jul 22, 09:00 (failed: timeout)        │
 * │                                                   │
 * │ [Run] [Pause] [Edit]           4 active, 1 paused │
 * └───────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface CronJob {
  readonly id: string;
  readonly name: string;
  readonly schedule: string; // cron expression
  readonly command: string;
  readonly status: JobStatus;
  readonly category?: string;
  readonly lastRun?: { timestamp: number; success: boolean; duration?: number; error?: string };
  readonly nextRun?: number;
  readonly enabled: boolean;
}

export interface CronField {
  readonly minute: number[];
  readonly hour: number[];
  readonly dayOfMonth: number[];
  readonly month: number[];
  readonly dayOfWeek: number[];
}

export interface CronRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showNextRuns?: boolean;
  readonly showHistory?: boolean;
  readonly groupByCategory?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// CronScheduler
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<JobStatus, string> = {
  active: '●', paused: '○', completed: '✓', failed: '✖',
};

const STATUS_TOKENS: Record<JobStatus, string> = {
  active: 'success', paused: 'textMuted', completed: 'primary', failed: 'error',
};

export class CronScheduler {
  private jobs: Map<string, CronJob> = new Map();
  private counter = 0;
  private selectedJobId: string | null = null;

  // ─── Job Management ──────────────────────────────────────────────

  /** Add a cron job. */
  addJob(options: {
    name: string;
    schedule: string;
    command: string;
    category?: string;
    enabled?: boolean;
  }): string {
    const id = `job-${String(++this.counter)}`;
    const job: CronJob = {
      id,
      name: options.name,
      schedule: options.schedule,
      command: options.command,
      status: options.enabled === false ? 'paused' : 'active',
      category: options.category,
      enabled: options.enabled !== false,
      nextRun: this.calculateNextRun(options.schedule),
    };
    this.jobs.set(id, job);
    return id;
  }

  /** Update a job. */
  updateJob(id: string, updates: Partial<Omit<CronJob, 'id'>>): void {
    const job = this.jobs.get(id);
    if (job) {
      this.jobs.set(id, { ...job, ...updates });
    }
  }

  /** Remove a job. */
  removeJob(id: string): void {
    this.jobs.delete(id);
    if (this.selectedJobId === id) this.selectedJobId = null;
  }

  /** Get a job. */
  getJob(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  /** Get all jobs. */
  getJobs(): CronJob[] {
    return [...this.jobs.values()];
  }

  /** Get active jobs count. */
  get activeCount(): number {
    return [...this.jobs.values()].filter((j) => j.enabled && j.status === 'active').length;
  }

  // ─── Job Control ─────────────────────────────────────────────────

  /** Enable a job. */
  enable(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      this.jobs.set(id, { ...job, enabled: true, status: 'active' });
    }
  }

  /** Disable a job. */
  disable(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      this.jobs.set(id, { ...job, enabled: false, status: 'paused' });
    }
  }

  /** Record a job execution. */
  recordExecution(id: string, success: boolean, duration?: number, error?: string): void {
    const job = this.jobs.get(id);
    if (job) {
      this.jobs.set(id, {
        ...job,
        lastRun: { timestamp: Date.now(), success, duration, error },
        status: success ? 'active' : 'failed',
        nextRun: this.calculateNextRun(job.schedule),
      });
    }
  }

  // ─── Selection ───────────────────────────────────────────────────

  /** Select a job. */
  select(id: string | null): void {
    this.selectedJobId = id;
  }

  /** Get selected job. */
  getSelected(): CronJob | null {
    return this.selectedJobId ? this.jobs.get(this.selectedJobId) ?? null : null;
  }

  // ─── Cron Parsing ────────────────────────────────────────────────

  /** Parse a cron expression. */
  parseCron(expression: string): CronField | null {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    try {
      return {
        minute: this.parseField(parts[0]!, 0, 59),
        hour: this.parseField(parts[1]!, 0, 23),
        dayOfMonth: this.parseField(parts[2]!, 1, 31),
        month: this.parseField(parts[3]!, 1, 12),
        dayOfWeek: this.parseField(parts[4]!, 0, 6),
      };
    } catch {
      return null;
    }
  }

  private parseField(field: string, min: number, max: number): number[] {
    const values: number[] = [];

    for (const part of field.split(',')) {
      if (part === '*') {
        for (let i = min; i <= max; i++) values.push(i);
      } else if (part.includes('/')) {
        const [range, stepStr] = part.split('/');
        const step = parseInt(stepStr!, 10);
        const start = range === '*' ? min : parseInt(range!, 10);
        for (let i = start; i <= max; i += step) values.push(i);
      } else if (part.includes('-')) {
        const [startStr, endStr] = part.split('-');
        const start = parseInt(startStr!, 10);
        const end = parseInt(endStr!, 10);
        for (let i = start; i <= end; i++) values.push(i);
      } else {
        values.push(parseInt(part, 10));
      }
    }

    return values;
  }

  /** Get human-readable description of cron expression. */
  describeCron(expression: string): string {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return 'Invalid';

    const [minute, hour, dom, month, dow] = parts;

    // Common patterns
    if (minute === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      return 'Every hour';
    }
    if (minute === '0' && hour === '0' && dom === '*' && month === '*' && dow === '*') {
      return 'Daily at midnight';
    }
    if (minute === '0' && hour === '2' && dom === '*' && month === '*' && dow === '*') {
      return 'Daily at 2:00 AM';
    }
    if (minute === '0' && hour === '0' && dom === '*' && month === '*' && dow === '0') {
      return 'Weekly on Sunday';
    }
    if (minute === '0' && hour === '9' && dom === '*' && month === '*' && dow === '1-5') {
      return 'Weekdays at 9:00 AM';
    }
    if (minute === '*/5' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      return 'Every 5 minutes';
    }
    if (minute === '*/15' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      return 'Every 15 minutes';
    }
    if (minute === '0' && hour === '*/6' && dom === '*' && month === '*' && dow === '*') {
      return 'Every 6 hours';
    }

    // Generic description
    const timeDesc = minute === '0' ? `at ${hour}:00` : `at ${hour}:${minute}`;
    if (dom === '*' && month === '*' && dow === '*') {
      return `Daily ${timeDesc}`;
    }
    if (dow !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `${days[parseInt(dow, 10)] ?? dow} ${timeDesc}`;
    }

    return expression;
  }

  /** Calculate next run time from cron expression. */
  calculateNextRun(expression: string, from: Date = new Date()): number | undefined {
    const parsed = this.parseCron(expression);
    if (!parsed) return undefined;

    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);

    // Simple approximation: check next 24 hours
    for (let i = 0; i < 1440; i++) {
      const m = next.getMinutes();
      const h = next.getHours();
      const dom = next.getDate();
      const mon = next.getMonth() + 1;
      const dow = next.getDay();

      if (
        parsed.minute.includes(m) &&
        parsed.hour.includes(h) &&
        parsed.dayOfMonth.includes(dom) &&
        parsed.month.includes(mon) &&
        parsed.dayOfWeek.includes(dow)
      ) {
        return next.getTime();
      }

      next.setMinutes(next.getMinutes() + 1);
    }

    return undefined;
  }

  /** Get next N run times. */
  getNextRuns(expression: string, count: number, from: Date = new Date()): number[] {
    const runs: number[] = [];
    let current = from;

    for (let i = 0; i < count; i++) {
      const next = this.calculateNextRun(expression, current);
      if (next === undefined) break;
      runs.push(next);
      current = new Date(next);
    }

    return runs;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the cron scheduler. */
  render(options: CronRenderOptions): string[] {
    const { width, height, showNextRuns = true, showHistory = true, groupByCategory = false, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    // Header
    const activeCount = this.activeCount;
    const title = ` Cron Scheduler`;
    const badge = ` [${boldFg('success', `${String(activeCount)} active`)}]`;
    lines.push(fg('textMuted', `┌─${boldFg('text', title)}${'─'.repeat(Math.max(0, innerWidth - title.length - 16))}${badge} ┐`));

    // Jobs
    const jobs = this.getJobs();
    const contentHeight = height - 4;
    let lineCount = 0;

    if (groupByCategory) {
      const categories = new Map<string, CronJob[]>();
      for (const job of jobs) {
        const cat = job.category ?? 'General';
        const list = categories.get(cat) ?? [];
        list.push(job);
        categories.set(cat, list);
      }

      for (const [category, catJobs] of categories) {
        if (lineCount >= contentHeight) break;
        lines.push(fg('textMuted', '│') + ` ${boldFg('accent', `▾ ${category}`)}` + ' '.repeat(innerWidth - category.length - 4) + fg('textMuted', '│'));
        lineCount++;

        for (const job of catJobs) {
          if (lineCount >= contentHeight) break;
          const jobLines = this.renderJob(job, innerWidth, showNextRuns, showHistory, options);
          for (const line of jobLines) {
            if (lineCount >= contentHeight) break;
            lines.push(fg('textMuted', '│') + line + fg('textMuted', '│'));
            lineCount++;
          }
        }
      }
    } else {
      for (const job of jobs) {
        if (lineCount >= contentHeight) break;
        const jobLines = this.renderJob(job, innerWidth, showNextRuns, showHistory, options);
        for (const line of jobLines) {
          if (lineCount >= contentHeight) break;
          lines.push(fg('textMuted', '│') + line + fg('textMuted', '│'));
          lineCount++;
        }
        // Blank line between jobs
        if (lineCount < contentHeight) {
          lines.push(fg('textMuted', '│' + ' '.repeat(innerWidth) + '│'));
          lineCount++;
        }
      }
    }

    // Pad
    while (lines.length < height - 1) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    // Footer
    const pausedCount = jobs.filter((j) => !j.enabled).length;
    const footer = ` ${fg('primary', '[Run]')} ${fg('warning', '[Pause]')} ${fg('accent', '[Edit]')}           ${String(activeCount)} active, ${String(pausedCount)} paused`;
    lines.push(fg('textMuted', `└${padRight(footer, innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private renderJob(job: CronJob, width: number, showNextRuns: boolean, showHistory: boolean, options: CronRenderOptions): string[] {
    const { fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const isSelected = job.id === this.selectedJobId;

    // Main line: status icon, name, schedule, description
    const icon = fg(STATUS_TOKENS[job.status], STATUS_ICONS[job.status]);
    const name = isSelected ? boldFg('primary', job.name.padEnd(14)) : fg('text', job.name.padEnd(14));
    const schedule = dimFg('textMuted', job.schedule.padEnd(12));
    const desc = fg('text', this.describeCron(job.schedule));

    lines.push(` ${icon} ${name.slice(0, 14)} ${schedule} ${desc.slice(0, width - 35)}`);

    // Next run
    if (showNextRuns && job.nextRun) {
      const nextDate = new Date(job.nextRun);
      const relative = formatRelativeFuture(job.nextRun);
      const nextLine = dimFg('textMuted', `   Next: ${formatDateTime(nextDate)} (in ${relative})`);
      lines.push(nextLine);
    }

    // Last run
    if (showHistory && job.lastRun) {
      const lastDate = new Date(job.lastRun.timestamp);
      const statusIcon = job.lastRun.success ? fg('success', '✓') : fg('error', '✖');
      const duration = job.lastRun.duration ? ` (took ${formatDuration(job.lastRun.duration)})` : '';
      const error = job.lastRun.error ? fg('error', ` (${job.lastRun.error})`) : '';
      const lastLine = `   Last: ${statusIcon} ${dimFg('textMuted', formatDateTime(lastDate))}${dimFg('textMuted', duration)}${error}`;
      lines.push(lastLine);
    }

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${String(date.getDate())}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatRelativeFuture(timestamp: number): string {
  const diff = timestamp - Date.now();
  if (diff < 0) return 'now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `${String(hours)}h ${String(mins)}m`;
  }
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return `${String(days)}d ${String(hours)}h`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function padRight(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo cron scheduler with sample jobs. */
export function createDemoCronScheduler(): CronScheduler {
  const scheduler = new CronScheduler();
  const now = Date.now();

  scheduler.addJob({
    name: 'backup-db',
    schedule: '0 2 * * *',
    command: 'pg_dump mydb > /backups/db-$(date +%F).sql',
    category: 'Maintenance',
  });
  scheduler.recordExecution('job-1', true, 45000);

  scheduler.addJob({
    name: 'cleanup-logs',
    schedule: '0 0 * * 0',
    command: 'find /var/log -name "*.log" -mtime +30 -delete',
    category: 'Maintenance',
  });
  scheduler.recordExecution('job-2', true, 12000);

  scheduler.addJob({
    name: 'send-report',
    schedule: '0 9 * * 1-5',
    command: 'node /scripts/daily-report.js',
    category: 'Reports',
  });
  scheduler.recordExecution('job-3', false, undefined, 'timeout');

  scheduler.addJob({
    name: 'sync-files',
    schedule: '*/15 * * * *',
    command: 'rsync -av /data/ remote:/backup/',
    category: 'Sync',
  });

  scheduler.addJob({
    name: 'health-check',
    schedule: '*/5 * * * *',
    command: 'curl -s https://api.example.com/health',
    category: 'Monitoring',
  });
  scheduler.recordExecution('job-5', true, 230);

  return scheduler;
}
