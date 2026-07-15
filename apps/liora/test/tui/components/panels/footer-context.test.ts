import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';
import chalk from 'chalk';

import {
  FooterComponent,
  formatFooterGitBadge,
  formatContextOSFooterBadge,
  formatMicroCompactionFooterBadge,
  buildWeightedTips,
} from '#/tui/components/chrome/footer';
import { darkColors } from '#/tui/theme/colors';
import type { AppState } from '#/tui/types';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function hexToSgr(hex: string): string {
  const value = hex.replace(/^#/, '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `\u001B[38;2;${String(r)};${String(g)};${String(b)}m`;
}

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    model: 'k2',
    workDir: '/tmp',
    additionalDirs: [],
    sessionId: 'sess_1',
    permissionMode: 'manual',
    planMode: false,
    thinking: false,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: 'test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    availableModels: {},
    ...overrides,
  } as AppState;
}

function dirtyGitWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kimi-footer-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'scratch.txt'), 'dirty\n');
  return dir;
}

describe('FooterComponent — context NaN resilience', () => {
  it('NaN usage → renders 0.0% (never literal "NaN%")', () => {
    const fc = new FooterComponent(baseState({ contextUsage: Number.NaN }));
    const out = strip(fc.render(120).join(''));
    expect(out).not.toMatch(/NaN/);
    expect(out).toMatch(/context: 0\.0%/);
  });

  it('undefined-ish (coerced) usage → renders 0.0%', () => {
    const fc = new FooterComponent(
      baseState({ contextUsage: undefined as unknown as number }),
    );
    const out = strip(fc.render(120).join(''));
    expect(out).not.toMatch(/NaN/);
    expect(out).toMatch(/context: 0\.0%/);
  });

  it('clamps ratios above 1.0 → renders 100.0%', () => {
    const fc = new FooterComponent(baseState({ contextUsage: 1.5 }));
    const out = strip(fc.render(120).join(''));
    expect(out).toMatch(/context: 100\.0%/);
  });

  it('ratio 0.427 → renders 42.7%', () => {
    const fc = new FooterComponent(baseState({ contextUsage: 0.427 }));
    const out = strip(fc.render(200).join(''));
    expect(out).toMatch(/context: 42\.7%/);
  });

  it('tokens provided but max=0 → falls back to percent-only, no division-by-zero artefact', () => {
    const fc = new FooterComponent(
      baseState({ contextUsage: 0, contextTokens: 500, maxContextTokens: 0 }),
    );
    const out = strip(fc.render(200).join(''));
    expect(out).not.toMatch(/Infinity|NaN/);
    expect(out).toMatch(/context: 0\.0%/);
    // With maxTokens=0, token-count annotation is suppressed.
    expect(out).not.toMatch(/\(500\//);
  });

  it('setState updates visible model and context values', () => {
    const footer = new FooterComponent(baseState({ model: 'k2', contextUsage: 0 }));

    footer.setState(baseState({ model: 'kimi-k2-5', contextUsage: 0.5 }));

    const out = strip(footer.render(200).join(''));
    expect(out).toContain('kimi-k2-5');
    expect(out).not.toContain(' k2 ');
    expect(out).toMatch(/context: 50\.0%/);
  });

  it('shows "thinking" label when thinking is enabled, hides it when disabled', () => {
    const on = new FooterComponent(baseState({ model: 'k2', thinking: true }));
    const off = new FooterComponent(baseState({ model: 'k2', thinking: false }));

    expect(strip(on.render(120)[0]!)).toContain('thinking');
    expect(strip(off.render(120)[0]!)).not.toContain('thinking');
  });

  it('labels Ultrawork mode separately from plain plan mode in the footer', () => {
    const footer = new FooterComponent(baseState({ planMode: true, ultraworkMode: true }));

    const [line1, line2] = footer.render(120);
    const out = strip(line1 ?? '');

    expect(out).toContain('ultrawork');
    expect(out).not.toContain('ultrawork-ready');
    expect(out).not.toContain('plan-first');
    expect(out).not.toContain('plan  k2');
    expect(strip(line2 ?? '')).toContain(
      'Workflow research -> interview -> goal -> swarm decision -> integrate -> verify -> learn',
    );
    expect(strip(line2 ?? '')).not.toContain('Ultrawork plans, sets goal, swarms, verifies');
    expect(strip(line2 ?? '')).not.toContain('helpers');
  });

  it('keeps the Ultrawork pipeline visible after plan mode exits', () => {
    const footer = new FooterComponent(baseState({ planMode: false, ultraworkMode: true }));

    const [line1, line2] = footer.render(120);

    expect(strip(line1 ?? '')).toContain('ultrawork');
    expect(strip(line1 ?? '')).not.toContain('plan');
    expect(strip(line2 ?? '')).toContain(
      'Workflow research -> interview -> goal -> swarm decision -> integrate -> verify -> learn',
    );
  });

  it('keeps the Ultrawork pipeline visible while streaming', () => {
    const footer = new FooterComponent(
      baseState({ planMode: false, ultraworkMode: true, streamingPhase: 'thinking' }),
    );

    const [, line2] = footer.render(120);

    expect(strip(line2 ?? '')).toContain(
      'Workflow research -> interview -> goal -> swarm decision -> integrate -> verify -> learn',
    );
  });

  it('renders transient hints on the context line', () => {
    const footer = new FooterComponent(baseState());

    footer.setTransientHint('Press Ctrl-C again to exit');

    const [, line2] = footer.render(120);
    expect(strip(line2 ?? '')).toContain('Press Ctrl-C again to exit');
    expect(strip(line2 ?? '')).toContain('context: 0.0%');
  });

  it('keeps the idle next action visible beside context usage', () => {
    const previous = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'test-key';
    try {
      const footer = new FooterComponent(baseState());

      const [, line2] = footer.render(120);

      expect(strip(line2 ?? '')).toContain('next: Shift-Tab toggles Ultrawork/off, or type normally');
      expect(strip(line2 ?? '')).not.toContain('Ultrawork plans, sets goal, swarms, verifies');
      expect(strip(line2 ?? '')).not.toContain('helpers');
      expect(strip(line2 ?? '')).toContain('context: 0.0%');
    } finally {
      if (previous === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = previous;
    }
  });

  it('points idle users without media keys at zero-config image/video setup', () => {
    const previous = {
      OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
      GOOGLE_API_KEY: process.env['GOOGLE_API_KEY'],
      GEMINI_API_KEY: process.env['GEMINI_API_KEY'],
    };
    delete process.env['OPENAI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    try {
      const footer = new FooterComponent(baseState());
      const [, line2] = footer.render(120);
      expect(strip(line2 ?? '')).toContain('OPENAI_API_KEY or GOOGLE_API_KEY for image/video');
      expect(strip(line2 ?? '')).toContain('context: 0.0%');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('shows a compact history badge while transcript follow output is paused', () => {
    let followOutput = false;
    const footer = new FooterComponent(
      baseState(),
      undefined,
      () => ({ followOutput, offsetFromBottom: 42 }),
    );

    expect(strip(footer.render(120)[0] ?? '')).toContain('[history +42 rows]');

    followOutput = true;
    expect(strip(footer.render(120)[0] ?? '')).not.toContain('[history');
  });

  it('points logged-out users at setup before describing a task', () => {
    const footer = new FooterComponent(baseState({ model: '' }));

    const [, line2] = footer.render(120);

    expect(strip(line2 ?? '')).toContain('next: /login to add a provider, then /model');
    expect(strip(line2 ?? '')).not.toContain('next: describe task');
  });

  it('points idle dirty worktrees at review instead of new tasks', () => {
    const workDir = dirtyGitWorktree();
    try {
      const footer = new FooterComponent(baseState({ workDir }));

      const [, line2] = footer.render(120);

      expect(strip(line2 ?? '')).toContain('next: review changes');
      expect(strip(line2 ?? '')).not.toContain('next: describe task');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('highlights the pull request badge separately from git status text', () => {
    const previousLevel = chalk.level;
    chalk.level = 3;
    try {
      const out = formatFooterGitBadge(
        {
          branch: 'feature/footer',
          dirty: false,
          ahead: 0,
          behind: 0,
          diffAdded: 0,
          diffDeleted: 0,
          pullRequest: {
            number: 6,
            url: 'https://github.com/acme/repo/pull/6',
          },
        },
        darkColors,
      );

      const primaryIndex = out.indexOf(hexToSgr(darkColors.primary));
      const statusIndex = out.indexOf(hexToSgr(darkColors.textDim));
      const badgeIndex = out.indexOf('[PR#6]');
      expect(statusIndex).toBeGreaterThanOrEqual(0);
      expect(primaryIndex).toBeGreaterThanOrEqual(0);
      expect(primaryIndex).toBeLessThan(badgeIndex);
      expect(strip(out)).toContain('feature/footer ');
      expect(strip(out)).toContain('[PR#6]');
    } finally {
      chalk.level = previousLevel;
    }
  });
});

  it('shows Context OS evidence badge when durable IDs were dropped', () => {
    const footer = new FooterComponent(
      baseState({
        contextUsage: 0.2,
        contextTokens: 1000,
        maxContextTokens: 10_000,
        contextOS: {
          pageCount: 2,
          readyPageCount: 1,
          needsRehydrationPageCount: 1,
          atRiskPageCount: 0,
          missingEvidencePageCount: 1,
          evidenceIdRecallScore: 0.5,
          latestContinuityStatus: 'needs_rehydration',
        },
      }),
    );
    const lines = footer.render(120).map(strip);
    const joined = lines.join('\n');
    expect(joined).toContain('ctx-os:evidence↓0.50');
    expect(formatContextOSFooterBadge({
      pageCount: 2,
      readyPageCount: 1,
      needsRehydrationPageCount: 1,
      atRiskPageCount: 0,
      missingEvidencePageCount: 1,
      evidenceIdRecallScore: 0.5,
      latestContinuityStatus: 'needs_rehydration',
    })).toEqual({ text: 'ctx-os:evidence↓0.50', severity: 'danger' });
    expect(formatContextOSFooterBadge(null)).toBeNull();
  });

  it('shows micro-clear badge when tool-result clearing has fired', () => {
    const footer = new FooterComponent(
      baseState({
        contextUsage: 0.3,
        contextTokens: 2000,
        maxContextTokens: 10_000,
        microCompaction: {
          total: 3,
          lastTrigger: 'usage_pressure',
          lastContextUsageRatio: 0.62,
          byTrigger: { usage_pressure: 2, swarm_pressure: 1 },
        },
      }),
    );
    const joined = footer.render(120).map(strip).join('\n');
    expect(joined).toContain('micro:usage_pressure×3');
    expect(
      formatMicroCompactionFooterBadge({
        total: 3,
        lastTrigger: 'usage_pressure',
        lastContextUsageRatio: 0.62,
        byTrigger: { usage_pressure: 2 },
      }),
    ).toEqual({ text: 'micro:usage_pressure×3', severity: 'info' });
    expect(
      formatMicroCompactionFooterBadge({
        total: 2,
        lastTrigger: 'swarm_pressure',
        lastContextUsageRatio: 0.8,
        byTrigger: { swarm_pressure: 2 },
      }),
    ).toEqual({ text: 'micro:swarm_pressure×2', severity: 'warning' });
    expect(formatMicroCompactionFooterBadge(null)).toBeNull();
  });

describe('buildWeightedTips — weighted rotation', () => {
  it('repeats higher-priority tips more often (length = sum of weights)', () => {
    const seq = buildWeightedTips([
      { text: 'a' }, // weight 1 (default)
      { text: 'b', priority: 3 },
      { text: 'c', priority: 2 },
    ]);

    const count = (t: string) => seq.filter((x) => x.text === t).length;
    expect(seq).toHaveLength(6);
    expect(count('a')).toBe(1);
    expect(count('b')).toBe(3);
    expect(count('c')).toBe(2);
    expect(count('b')).toBeGreaterThan(count('a'));
  });

  it('keeps duplicates spread out — no tip sits next to itself', () => {
    const seq = buildWeightedTips([
      { text: 'a' },
      { text: 'b', priority: 3 },
      { text: 'c', priority: 2 },
    ]);

    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]!.text).not.toBe(seq[i - 1]!.text);
    }
  });

  it('preserves array order when all weights are the default (1)', () => {
    const seq = buildWeightedTips([{ text: 'x' }, { text: 'y' }, { text: 'z' }]);
    expect(seq.map((t) => t.text)).toEqual(['x', 'y', 'z']);
  });

  it('clamps non-positive / fractional priorities to a weight of at least 1', () => {
    const seq = buildWeightedTips([
      { text: 'a', priority: 0 },
      { text: 'b', priority: -5 },
      { text: 'c', priority: 1.9 },
    ]);
    expect(seq).toHaveLength(3);
    expect(seq.map((t) => t.text).toSorted()).toEqual(['a', 'b', 'c']);
  });
});
