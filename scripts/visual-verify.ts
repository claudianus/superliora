/**
 * Visual verification script — renders all new TUI modules to stdout
 * so we can verify actual terminal output quality.
 */

// Simple ANSI color helpers for standalone rendering
const fg = (token: string, text: string): string => {
  const colors: Record<string, string> = {
    text: '\x1b[37m', textMuted: '\x1b[90m', textDim: '\x1b[2m',
    primary: '\x1b[36m', accent: '\x1b[35m', success: '\x1b[32m',
    warning: '\x1b[33m', error: '\x1b[31m',
  };
  return `${colors[token] ?? ''}${text}\x1b[0m`;
};
const boldFg = (token: string, text: string): string => {
  const colors: Record<string, string> = {
    text: '\x1b[1;37m', textMuted: '\x1b[1;90m', textStrong: '\x1b[1;97m',
    primary: '\x1b[1;36m', accent: '\x1b[1;35m', success: '\x1b[1;32m',
    warning: '\x1b[1;33m', error: '\x1b[1;31m',
  };
  return `${colors[token] ?? ''}${text}\x1b[0m`;
};
const dimFg = (token: string, text: string): string => {
  return `\x1b[2m${text}\x1b[0m`;
};
const bg = (token: string, text: string): string => {
  return `\x1b[44m${text}\x1b[0m`;
};

const opts = { width: 70, height: 20, fg, boldFg, dimFg, bg };

async function main() {
  console.log('\n\x1b[1;36m═══ VISUAL VERIFICATION: Iteration 8-10 Modules ═══\x1b[0m\n');

  // ─── 1. Context Budget Viz ───────────────────────────────────────
  console.log('\x1b[1;33m── ContextBudgetTracker ──\x1b[0m');
  const { ContextBudgetTracker, renderStackedBar, renderSparkline, renderPressureGauge } = await import('../apps/liora/src/tui/utils/context-budget-viz.ts');
  const tracker = new ContextBudgetTracker(200000, 50);
  tracker.updateCategory('system', 15000);
  tracker.updateCategory('messages', 85000);
  tracker.updateCategory('tools', 32000);
  tracker.updateCategory('files', 28000);
  tracker.updateCategory('memory', 8000);
  tracker.recordSnapshot(Date.now() - 60000);
  tracker.updateCategory('messages', 95000);
  tracker.recordSnapshot(Date.now() - 30000);
  tracker.updateCategory('messages', 110000);
  tracker.recordSnapshot(Date.now());

  const breakdown = tracker.getBreakdown();
  console.log(`  Total: ${tracker.getTotalTokens()} tokens (${Math.round(tracker.getUsageRatio() * 100)}%)`);
  console.log(`  Pressure: ${tracker.getPressureLevel()}`);
  console.log(`  Stacked: ${renderStackedBar(breakdown, 40, fg)}`);
  console.log(`  Spark:   ${renderSparkline(tracker.getHistory(), 20, fg)}`);
  console.log(`  Gauge:   ${renderPressureGauge(tracker.getUsageRatio(), 30, fg, dimFg)}`);
  const pred = tracker.predict();
  console.log(`  Predict: ${pred.recommendation} (confidence: ${pred.confidence.toFixed(2)})`);

  // ─── 2. Swarm Coordination View ──────────────────────────────────
  console.log('\n\x1b[1;33m── SwarmCoordinator ──\x1b[0m');
  const { SwarmCoordinator } = await import('../apps/liora/src/tui/utils/swarm-coordination-view.ts');
  const swarm = new SwarmCoordinator();
  swarm.addAgent({ id: 'a1', name: 'Architect', role: 'design', status: 'working', currentTask: 'Refactoring layout engine', progress: 0.65, tokensUsed: 45000, elapsedMs: 120000, costUsd: 0.35, lastActivityMs: Date.now() - 2000, errorCount: 0, dependencies: [] });
  swarm.addAgent({ id: 'a2', name: 'Implementer', role: 'code', status: 'tool-call', currentTask: 'Writing responsive-layout.ts', progress: 0.4, tokensUsed: 32000, elapsedMs: 90000, costUsd: 0.22, lastActivityMs: Date.now() - 500, errorCount: 1, dependencies: ['a1'] });
  swarm.addAgent({ id: 'a3', name: 'Reviewer', role: 'review', status: 'waiting-approval', currentTask: 'PR #42 review', progress: 0.8, tokensUsed: 18000, elapsedMs: 60000, costUsd: 0.12, lastActivityMs: Date.now() - 10000, errorCount: 0, dependencies: ['a2'] });
  swarm.addAgent({ id: 'a4', name: 'Tester', role: 'test', status: 'complete', currentTask: null, progress: 1.0, tokensUsed: 25000, elapsedMs: 45000, costUsd: 0.18, lastActivityMs: Date.now() - 30000, errorCount: 0, dependencies: ['a2'] });

  const swarmLines = swarm.render(opts);
  for (const line of swarmLines.slice(0, 12)) console.log(`  ${line}`);

  // ─── 3. Terminal Capability Profile ──────────────────────────────
  console.log('\n\x1b[1;33m── TerminalCapabilityProfile ──\x1b[0m');
  const { buildCapabilityProfile, getFeatureRecommendations, getMaxSafeFps } = await import('../apps/liora/src/tui/utils/terminal-capability-profile.ts');
  const profile = buildCapabilityProfile(process.env, process.stdout.columns, process.stdout.rows);
  console.log(`  Tier: ${profile.tier}`);
  console.log(`  Color: ${profile.colorDepth}`);
  console.log(`  Images: ${profile.imageProtocol}`);
  console.log(`  Keyboard: ${profile.keyboardProtocol}`);
  console.log(`  Unicode: ${profile.unicodeVersion}`);
  console.log(`  Max FPS: ${getMaxSafeFps(profile)}`);
  console.log(`  Summary: ${profile.summary}`);
  const recs = getFeatureRecommendations(profile);
  console.log('  Recommendations:');
  for (const r of recs.slice(0, 5)) {
    console.log(`    ${r.enabled ? fg('success', '✓') : fg('error', '✗')} ${r.feature}: ${r.reason}`);
  }

  // ─── 4. Git Operations Panel ─────────────────────────────────────
  console.log('\n\x1b[1;33m── GitOperationsPanel ──\x1b[0m');
  const { GitOperationsPanel, parseGitDiff } = await import('../apps/liora/src/tui/utils/git-operations-panel.ts');
  const gitPanel = new GitOperationsPanel();
  gitPanel.setFiles([
    { path: 'src/tui/utils/git-operations-panel.ts', status: 'added', staged: true, additions: 692, deletions: 0 },
    { path: 'src/tui/utils/responsive-layout-engine.ts', status: 'added', staged: true, additions: 516, deletions: 0 },
    { path: 'src/tui/liora-tui.ts', status: 'modified', staged: false, additions: 45, deletions: 12 },
    { path: 'src/tui/workspace/panels/file-explorer-panel.ts', status: 'modified', staged: false, additions: 8, deletions: 3 },
    { path: 'old-module.ts', status: 'deleted', staged: false, additions: 0, deletions: 230 },
    { path: 'src/config.ts', status: 'untracked', staged: false, additions: 0, deletions: 0 },
  ]);
  const gitLines = gitPanel.render(opts);
  for (const line of gitLines.slice(0, 12)) console.log(`  ${line}`);

  // Diff parsing
  const diff = parseGitDiff(`@@ -10,6 +10,8 @@ function example()
 context line
-old line removed
+new line added
+another new line
 more context`);
  console.log(`  Parsed ${diff.length} hunk(s), ${diff[0]?.lines.length ?? 0} lines`);

  // ─── 5. Responsive Layout Engine ─────────────────────────────────
  console.log('\n\x1b[1;33m── ResponsiveLayoutEngine ──\x1b[0m');
  const { ResponsiveLayoutEngine, describeLayout } = await import('../apps/liora/src/tui/utils/responsive-layout-engine.ts');
  const layout = new ResponsiveLayoutEngine(ResponsiveLayoutEngine.createStandardLayout(), 120, 40);
  console.log(`  120x40: ${describeLayout(layout)}`);
  const regions = layout.resolve();
  for (const r of regions) {
    console.log(`    [${r.id}] ${r.x},${r.y} ${r.width}x${r.height} ${r.visible ? 'visible' : 'hidden'}${r.collapsed ? ' (collapsed)' : ''}`);
  }
  // Narrow
  layout.resize(60, 24);
  console.log(`  60x24:  ${describeLayout(layout)}`);
  const narrowRegions = layout.resolve();
  for (const r of narrowRegions) {
    console.log(`    [${r.id}] ${r.x},${r.y} ${r.width}x${r.height} ${r.visible ? 'visible' : 'hidden'}${r.collapsed ? ' (collapsed)' : ''}`);
  }

  // ─── 6. Command Palette ──────────────────────────────────────────
  console.log('\n\x1b[1;33m── CommandPalette ──\x1b[0m');
  const { CommandPalette, createDefaultCommands, fuzzyMatch } = await import('../apps/liora/src/tui/utils/command-palette.ts');
  const palette = new CommandPalette();
  palette.setCommands(createDefaultCommands());
  palette.open();
  // Simulate typing "git"
  palette.typeChar('g');
  palette.typeChar('i');
  palette.typeChar('t');
  const paletteLines = palette.render({ ...opts, height: 12 });
  for (const line of paletteLines) console.log(`  ${line}`);

  // Fuzzy match demo
  const match = fuzzyMatch('gpush', 'Git Push');
  console.log(`  fuzzyMatch("gpush", "Git Push"): score=${match?.score ?? 'null'}`);

  // ─── 7. Progress Visualizer ──────────────────────────────────────
  console.log('\n\x1b[1;33m── ProgressVisualizer ──\x1b[0m');
  const { renderProgressBar, renderIndeterminateBar, renderStepProgress, renderSpinner, renderProgress, formatElapsed } = await import('../apps/liora/src/tui/utils/progress-visualizer.ts');
  console.log(`  Determinate:   ${renderProgressBar(65, 100, opts)}`);
  console.log(`  Indeterminate: ${renderIndeterminateBar(opts)}`);
  console.log(`  Spinner:       ${renderSpinner('Building project...', 'braille', opts)}`);
  console.log(`  Elapsed:       ${formatElapsed(Date.now() - 185000)}`);

  const steps = renderStepProgress([
    { label: 'Setup', state: 'complete' },
    { label: 'Install', state: 'complete' },
    { label: 'Build', state: 'active' },
    { label: 'Test', state: 'pending' },
    { label: 'Deploy', state: 'pending' },
  ], 2, opts);
  for (const s of steps) console.log(`  ${s}`);

  // Full progress info
  const progressLines = renderProgress({
    id: 'build', label: 'Building packages', state: 'active',
    current: 7, total: 12, startTime: Date.now() - 45000,
    throughput: 3.2, detail: 'packages/tui-renderer',
  }, opts);
  for (const l of progressLines) console.log(`  ${l}`);

  // ─── 8. Notification Center ──────────────────────────────────────
  console.log('\n\x1b[1;33m── NotificationCenter ──\x1b[0m');
  const { NotificationCenter } = await import('../apps/liora/src/tui/utils/notification-center.ts');
  const notifCenter = new NotificationCenter();
  notifCenter.push('critical', 'agent', 'Agent stalled', { body: 'Implementer has not responded for 60s', actions: [{ id: 'retry', label: 'Retry', dismisses: true }, { id: 'kill', label: 'Kill', dismisses: true }] });
  notifCenter.push('warning', 'git', 'Merge conflict', { body: '3 files have conflicts in feature/layout' });
  notifCenter.push('success', 'agent', 'Task complete', { body: 'Architect finished design phase' });
  notifCenter.push('info', 'system', 'Context compacted', { body: 'Reduced from 180k to 45k tokens' });
  const notifLines = notifCenter.renderList({ ...opts, height: 16 });
  for (const line of notifLines) console.log(`  ${line}`);
  console.log(`  Badge: ${notifCenter.renderBadge(fg)}`);
  // Toast rendering
  const toastLines = notifCenter.renderToasts({ ...opts, width: 50, height: 10 });
  console.log('  Toasts:');
  for (const line of toastLines.slice(0, 8)) console.log(`    ${line}`);

  // ─── 9. Performance Monitor ──────────────────────────────────────
  console.log('\n\x1b[1;33m── PerformanceMonitor ──\x1b[0m');
  const { PerformanceMonitor } = await import('../apps/liora/src/tui/utils/performance-monitor.ts');
  const perfMon = new PerformanceMonitor();
  perfMon.show();
  perfMon.setMode('full');
  // Simulate some frames
  let simTime = Date.now() - 1000;
  for (let i = 0; i < 30; i++) {
    simTime += 14 + Math.random() * 6; // ~60fps with jitter
    perfMon.recordFrame(simTime);
    perfMon.recordLag(2 + Math.random() * 8);
  }
  perfMon.recordMemory();
  perfMon.recordRenderPipeline(1.2, 3.5, 0.8);
  const perfLines = perfMon.render(opts);
  for (const line of perfLines) console.log(`  ${line}`);

  console.log('\n\x1b[1;36m═══ VERIFICATION COMPLETE ═══\x1b[0m\n');
}

main().catch(console.error);
