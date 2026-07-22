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

  // ─── 10. Markdown Renderer ────────────────────────────────────────
  console.log('\n\x1b[1;33m── MarkdownRenderer ──\x1b[0m');
  const { MarkdownRenderer } = await import('../apps/liora/src/tui/utils/markdown-renderer.ts');
  const mdRenderer = new MarkdownRenderer();
  const mdSample = `# SuperLiora TUI\n\n## Features\n\n- **Bold** and *italic* text\n- ~~Strikethrough~~ and \`inline code\`\n- [Links](https://example.com)\n\n> This is a blockquote\n> with multiple lines\n\n\`\`\`typescript\nconst x = 42;\nconsole.log(x);\n\`\`\`\n\n| Name | Status |\n|------|--------|\n| Build | ✓ Pass |\n| Test  | ✓ Pass |\n\n1. First item\n2. Second item\n3. Third item\n\n- [x] Done task\n- [ ] Pending task\n\n---\n\nFinal paragraph.`;
  const mdLines = mdRenderer.render(mdSample, { width: 60, fg, boldFg, dimFg, bg, codeLineNumbers: true });
  for (const line of mdLines) console.log(`  ${line}`);

  // ─── 11. Input History ────────────────────────────────────────────
  console.log('\n\x1b[1;33m── InputHistory ──\x1b[0m');
  const { InputHistory } = await import('../apps/liora/src/tui/utils/input-history.ts');
  const history = new InputHistory();
  history.push('git commit -m "feat: add theme engine"');
  history.push('pnpm run build');
  history.push('git push origin main');
  history.push('npx tsc --noEmit');
  history.push('git add -A');
  history.push('pnpm test');
  history.push('git commit -m "fix: resolve padding"');
  history.push('pnpm run lint');
  console.log(`  History size: ${history.size}`);
  console.log(`  Recent(3): ${history.getRecent(3).map((e) => e.text).join(' | ')}`);
  console.log(`  Frequent: ${history.getFrequent(2).map((e) => `${e.text}(${e.count})`).join(' | ')}`);
  // Search demo
  history.startSearch('incremental');
  history.searchType('g');
  history.searchType('i');
  history.searchType('t');
  const searchLines = history.renderSearch(fg, boldFg, dimFg, 60);
  console.log('  Search "git":');
  for (const line of searchLines) console.log(`    ${line}`);
  history.endSearch();
  // Navigation demo
  const up1 = history.navigateUp();
  const up2 = history.navigateUp();
  console.log(`  Nav up: ${up1} → ${up2}`);

  // ─── 12. Theme Engine ─────────────────────────────────────────────
  console.log('\n\x1b[1;33m── ThemeEngine ──\x1b[0m');
  const { ThemeEngine } = await import('../apps/liora/src/tui/utils/theme-engine.ts');
  const themeEngine = new ThemeEngine('dark');
  console.log(`  Current: ${themeEngine.getCurrent().name} (${themeEngine.currentId})`);
  console.log(`  Available: ${themeEngine.getThemes().map((t) => t.id).join(', ')}`);
  // Color utilities
  const primary = themeEngine.getColor('primary');
  const bgC = themeEngine.getColor('bg');
  console.log(`  Primary: rgb(${primary.r},${primary.g},${primary.b}) → 256-color: ${themeEngine.to256Color(primary)}`);
  console.log(`  Contrast primary/bg: ${themeEngine.contrastRatio(primary, bgC).toFixed(2)}:1`);
  // Theme preview
  const renderOpts = { fg, boldFg, dimFg, bg };
  const previewLines = themeEngine.renderPreview(themeEngine.getCurrent(), renderOpts);
  console.log('  Preview:');
  for (const line of previewLines) console.log(`    ${line}`);
  // Cycle theme
  const next = themeEngine.cycleTheme();
  console.log(`  After cycle: ${next.name}`);
  // Theme list
  const listLines = themeEngine.renderThemeList(renderOpts);
  console.log('  Theme list:');
  for (const line of listLines) console.log(`    ${line}`);

  // ─── 13. Split Pane Manager ───────────────────────────────────────
  console.log('\n\x1b[1;33m── SplitPaneManager ──\x1b[0m');
  const { SplitPaneManager } = await import('../apps/liora/src/tui/utils/split-pane-manager.ts');
  const splitMgr = new SplitPaneManager();
  const p1 = splitMgr.createInitialPane('Editor', 'sess-1');
  splitMgr.splitPane(p1, 'vertical', 'Terminal', 'sess-2');
  splitMgr.splitPane(p1, 'horizontal', 'Preview');
  console.log(`  Panes: ${splitMgr.paneCount} | Layout: ${splitMgr.describeLayout()}`);
  console.log(`  Focused: ${splitMgr.focusedId}`);
  splitMgr.navigateFocus('right');
  console.log(`  After nav right: ${splitMgr.focusedId}`);
  const splitLines = splitMgr.render({ width: 50, height: 20, fg, boldFg, dimFg });
  for (const line of splitLines) console.log(`  ${line}`);
  // MiniMap
  const miniLines = splitMgr.renderMiniMap({ width: 50, height: 20, fg, boldFg, dimFg });
  for (const line of miniLines) console.log(`  ${line}`);
  // Preset: quad
  const quadMgr = new SplitPaneManager();
  quadMgr.applyPreset('quad');
  console.log(`  Quad preset: ${quadMgr.paneCount} panes — ${quadMgr.describeLayout()}`);

  // ─── 14. Diff Viewer ──────────────────────────────────────────────
  console.log('\n\x1b[1;33m── DiffViewer ──\x1b[0m');
  const { DiffViewer } = await import('../apps/liora/src/tui/utils/diff-viewer.ts');
  const diffViewer = new DiffViewer();
  const sampleDiff = `diff --git a/src/utils.ts b/src/utils.ts
index abc1234..def5678 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,7 +10,8 @@ export function helper() {
   const x = 1;
-  const y = 2;
+  const y = 3;
+  const z = 4;
   return x + y;
 }
diff --git a/README.md b/docs/README.md
similarity index 90%
rename from README.md
rename to docs/README.md
--- a/README.md
+++ b/docs/README.md
@@ -1,3 +1,4 @@
 # Project
+Updated description.
 Some text.`;
  const diffStats = diffViewer.parseDiff(sampleDiff);
  console.log(`  Files: ${diffStats.filesChanged} | +${diffStats.totalAdditions} -${diffStats.totalDeletions}`);
  // Unified view
  const unifiedLines = diffViewer.render({ width: 60, mode: 'unified', fg, boldFg, dimFg });
  for (const line of unifiedLines.slice(0, 16)) console.log(`  ${line}`);
  // Stat view
  console.log('  --- Stat view ---');
  const statLines = diffViewer.render({ width: 60, mode: 'stat', fg, boldFg, dimFg });
  for (const line of statLines) console.log(`  ${line}`);

  // ─── 15. Autocomplete Engine ──────────────────────────────────────
  console.log('\n\x1b[1;33m── AutocompleteEngine ──\x1b[0m');
  const { AutocompleteEngine, createSlashCommandProvider, createCommandProvider, createHistoryProvider } = await import('../apps/liora/src/tui/utils/autocomplete-engine.ts');
  const acEngine = new AutocompleteEngine();
  acEngine.registerProvider(createSlashCommandProvider([
    { name: 'help', description: 'Show help' },
    { name: 'status', description: 'Show status' },
    { name: 'compact', description: 'Compact context' },
    { name: 'theme', description: 'Switch theme' },
  ]));
  acEngine.registerProvider(createCommandProvider(['git', 'grep', 'glob', 'build', 'test']));
  acEngine.registerProvider(createHistoryProvider(() => ['git push origin main', 'git commit -m "fix"']));
  // Slash completion
  const slashState = acEngine.complete('/he', 3);
  console.log(`  "/he" → ${slashState.items.length} items: ${slashState.items.map((i) => i.display).join(', ')}`);
  const popupLines = acEngine.renderPopup({ maxWidth: 40, maxVisible: 6, fg, boldFg, dimFg });
  for (const line of popupLines) console.log(`  ${line}`);
  acEngine.dismiss();
  // Command completion
  const cmdState = acEngine.complete('g', 1);
  console.log(`  "g" → ${cmdState.items.length} items: ${cmdState.items.map((i) => i.display).join(', ')}`);
  // Inline preview
  acEngine.dismiss();
  const singleState = acEngine.complete('/stat', 5);
  console.log(`  "/stat" → inline: "${singleState.inlinePreview ?? 'none'}"`);

  // ─── 16. Keybinding Manager ───────────────────────────────────────
  console.log('\n\x1b[1;33m── KeybindingManager ──\x1b[0m');
  const { KeybindingManager, createDefaultKeybindings } = await import('../apps/liora/src/tui/utils/keybinding-manager.ts');
  const keyMgr = new KeybindingManager();
  keyMgr.registerDefaults(createDefaultKeybindings());
  console.log(`  Registered: ${keyMgr.getAllBindings().length} bindings`);
  // Parse test
  const parsed = keyMgr.parseKey('Ctrl+Shift+P');
  console.log(`  Parse "Ctrl+Shift+P": ctrl=${parsed.ctrl} shift=${parsed.shift} key=${parsed.key}`);
  console.log(`  Symbol: ${keyMgr.formatSymbol(parsed)}`);
  // Chord
  const chord = keyMgr.parseSequence('Ctrl+K Ctrl+C');
  console.log(`  Chord: ${chord.map((k) => keyMgr.formatSymbol(k)).join(' ')}`);
  // Resolve
  const result = keyMgr.resolve(keyMgr.parseKey('Ctrl+Shift+P'));
  console.log(`  Resolve Ctrl+Shift+P → ${result.command}`);
  // Conflict detection
  const conflicts = keyMgr.detectConflicts();
  console.log(`  Conflicts: ${conflicts.length}`);
  // Render list (first 8 lines)
  const kbLines = keyMgr.renderList({ fg, boldFg, dimFg, maxWidth: 60 });
  for (const line of kbLines.slice(0, 10)) console.log(`  ${line}`);

  // ─── 17. Animation Scheduler ──────────────────────────────────────
  console.log('\n\x1b[1;33m── AnimationScheduler ──\x1b[0m');
  const { AnimationScheduler, Easing } = await import('../apps/liora/src/tui/utils/animation-scheduler.ts');
  const animSched = new AnimationScheduler();
  // Easing demo
  const easingNames = ['linear', 'easeOutCubic', 'easeOutElastic', 'easeOutBounce', 'spring'] as const;
  console.log('  Easing curves (t=0.5):');
  for (const name of easingNames) {
    const val = Easing[name](0.5);
    const bar = '█'.repeat(Math.round(val * 20));
    console.log(`    ${name.padEnd(16)} ${bar} ${val.toFixed(3)}`);
  }
  // Tween demo
  let tweenValue = 0;
  animSched.tween({ from: 0, to: 100, duration: 1000, easing: Easing.easeOutCubic, onUpdate: (v) => { tweenValue = v; } });
  animSched.tick();
  console.log(`  Tween after tick: ${tweenValue.toFixed(1)}`);
  // Particles
  animSched.emitConfetti(40, 10);
  animSched.tick();
  console.log(`  Particles: ${animSched.particleCount} (after confetti)`);
  const particleRenders = animSched.renderParticles();
  console.log(`  Rendered: ${particleRenders.length} particles, first: (${particleRenders[0]?.x},${particleRenders[0]?.y}) ${particleRenders[0]?.char}`);
  // Debug overlay
  const animDebug = animSched.renderDebug({ fg, dimFg });
  for (const line of animDebug) console.log(`  ${line}`);

  // ─── 18. Dynamic Status Bar ───────────────────────────────────────
  console.log('\n\x1b[1;33m── DynamicStatusBar ──\x1b[0m');
  const { DynamicStatusBar } = await import('../apps/liora/src/tui/utils/dynamic-status-bar.ts');
  const statusBar = new DynamicStatusBar();
  statusBar.update({
    mode: 'agent',
    git: { branch: 'main', ahead: 2, behind: 0, modified: 3, staged: 1, conflicts: 0 },
    agent: { state: 'working', task: 'Building TUI modules', progress: 0.65, elapsedMs: 185000 },
    context: { usedTokens: 145000, budgetTokens: 200000, pressure: 'medium' },
    sessionCount: 3,
    errors: 0,
    warnings: 2,
    notifications: 4,
    clock: '14:32',
    keyHints: [{ keys: '⌃C', action: 'interrupt' }, { keys: '⌃↵', action: 'approve' }],
  });
  statusBar.tick();
  const sbLines = statusBar.renderFull({ width: 70, fg, boldFg, dimFg, bg });
  for (const line of sbLines) console.log(`  ${line}`);
  // Mode change
  statusBar.setMode('insert');
  const sbInsert = statusBar.render({ width: 70, fg, boldFg, dimFg, bg });
  console.log(`  Insert mode: ${sbInsert}`);

  // ─── 19. Modal Dialog ─────────────────────────────────────────────
  console.log('\n\x1b[1;33m── ModalDialog ──\x1b[0m');
  const { ModalDialog, DialogManager } = await import('../apps/liora/src/tui/utils/modal-dialog.ts');
  // Confirm dialog
  const confirmDlg = new ModalDialog({ type: 'confirm', title: 'Delete File', message: 'Are you sure you want to delete src/old-module.ts? This action cannot be undone.' });
  const confirmLines = confirmDlg.render({ termWidth: 70, termHeight: 24, fg, boldFg, dimFg });
  console.log('  [Confirm Dialog]');
  for (const line of confirmLines) console.log(`  ${line}`);
  // Select dialog
  const selectDlg = new ModalDialog({
    type: 'select', title: 'Choose Theme',
    items: [
      { id: 'dark', label: 'Dark', description: 'Default dark', icon: '🌙' },
      { id: 'nord', label: 'Nord', description: 'Arctic blue', icon: '❄️' },
      { id: 'tokyo', label: 'Tokyo Night', description: 'City lights', icon: '🌃' },
      { id: 'cat', label: 'Catppuccin', description: 'Pastel', icon: '🐱' },
    ],
  });
  const selectLines = selectDlg.render({ termWidth: 70, termHeight: 24, fg, boldFg, dimFg });
  console.log('  [Select Dialog]');
  for (const line of selectLines) console.log(`  ${line}`);
  // Input dialog
  const inputDlg = new ModalDialog({ type: 'input', title: 'Rename Branch', placeholder: 'feature/new-branch', initialValue: 'feature/' });
  const inputLines = inputDlg.render({ termWidth: 70, termHeight: 24, fg, boldFg, dimFg });
  console.log('  [Input Dialog]');
  for (const line of inputLines) console.log(`  ${line}`);

  // ─── 20. Syntax Highlighter ───────────────────────────────────────
  console.log('\n\x1b[1;33m── SyntaxHighlighter ──\x1b[0m');
  const { SyntaxHighlighter } = await import('../apps/liora/src/tui/utils/syntax-highlighter.ts');
  const highlighter = new SyntaxHighlighter();
  const tsCode = `// Theme engine\nconst theme: Theme = {\n  id: 'dark',\n  name: "Dark Mode",\n  palette: { primary: 0x61afef },\n};\nexport function apply(t: Theme): void {\n  console.log(\`Applying \${t.name}\`);\n}`;
  const highlighted = highlighter.highlight(tsCode, { language: 'typescript', showLineNumbers: true, highlightLine: 3, fg, boldFg, dimFg });
  console.log('  TypeScript:');
  for (const line of highlighted) console.log(`  ${line}`);
  // Python
  const pyCode = `def fibonacci(n: int) -> list[int]:\n    """Generate Fibonacci sequence."""\n    fib = [0, 1]\n    for i in range(2, n):\n        fib.append(fib[i-1] + fib[i-2])\n    return fib[:n]`;
  const pyHighlighted = highlighter.highlight(pyCode, { language: 'python', showLineNumbers: true, fg, boldFg, dimFg });
  console.log('  Python:');
  for (const line of pyHighlighted) console.log(`  ${line}`);
  // Language detection
  console.log(`  Detect "main.rs": ${highlighter.detectLanguage('main.rs')?.name ?? 'null'}`);
  console.log(`  Detect "app.tsx": ${highlighter.detectLanguage('app.tsx')?.name ?? 'null'}`);

  // ─── 21. Scroll Viewport ──────────────────────────────────────────
  console.log('\n\x1b[1;33m── ScrollViewport ──\x1b[0m');
  const { ScrollViewport } = await import('../apps/liora/src/tui/utils/scroll-viewport.ts');
  const viewport = new ScrollViewport();
  viewport.setViewportSize(50, 8);
  // Generate 30 lines of content
  const content = Array.from({ length: 30 }, (_, i) => `Line ${String(i + 1).padStart(2)}: ${'█'.repeat((i * 7) % 30)}${'░'.repeat(30 - (i * 7) % 30)}`);
  viewport.setContentHeight(content.length);
  viewport.setRenderOpts({ fg, dimFg });
  // Render at top
  const topLines = viewport.render(content, { width: 50, height: 8, fg, dimFg });
  console.log('  At top:');
  for (const line of topLines) console.log(`  ${line}`);
  // Scroll down
  viewport.scrollTo(10);
  viewport.tick();
  viewport.tick();
  viewport.tick();
  const midLines = viewport.render(content, { width: 50, height: 8, fg, dimFg });
  console.log('  Scrolled to ~10:');
  for (const line of midLines) console.log(`  ${line}`);
  console.log(`  Position: ${viewport.renderPositionIndicator({ width: 50, height: 8, fg, dimFg })}`);
  console.log(`  State: scrollY=${viewport.getState().scrollY.toFixed(1)} max=${viewport.maxScroll} atBottom=${viewport.isAtBottom}`);

  // ─── 22. Tree View ────────────────────────────────────────────────
  console.log('\n\x1b[1;33m── TreeView ──\x1b[0m');
  const { TreeView } = await import('../apps/liora/src/tui/utils/tree-view.ts');
  const tree = new TreeView();
  tree.setNodes([
    { id: 'src', label: 'src', type: 'directory', expanded: true, children: [
      { id: 'tui', label: 'tui', type: 'directory', expanded: true, children: [
        { id: 'utils', label: 'utils', type: 'directory', expanded: false, badge: 'modified', children: [] },
        { id: 'liora-tui', label: 'liora-tui.ts', type: 'file', modified: true },
        { id: 'components', label: 'components', type: 'directory', expanded: false, children: [] },
      ]},
      { id: 'config', label: 'config.ts', type: 'file' },
      { id: 'index', label: 'index.ts', type: 'file', badge: 'staged' },
    ]},
    { id: 'pkg', label: 'package.json', type: 'file', icon: '📦' },
    { id: 'readme', label: 'README.md', type: 'file' },
    { id: 'node_modules', label: 'node_modules', type: 'directory', expanded: false, disabled: true, children: [] },
  ]);
  const treeLines = tree.render({ width: 50, height: 12, fg, boldFg, dimFg });
  for (const line of treeLines) console.log(`  ${line}`);
  console.log(`  Visible: ${tree.visibleCount} nodes | Focused: ${tree.focusedNode?.label}`);
  // Navigate
  tree.moveDown();
  tree.moveDown();
  console.log(`  After 2x down: ${tree.focusedNode?.label}`);

  // ─── 23. Tab Bar ──────────────────────────────────────────────────
  console.log('\n\x1b[1;33m── TabBar ──\x1b[0m');
  const { TabBar } = await import('../apps/liora/src/tui/utils/tab-bar.ts');
  const tabBar = new TabBar();
  tabBar.addTab({ title: 'main.ts', icon: '🟦', status: 'active' });
  tabBar.addTab({ title: 'theme-engine.ts', icon: '🟦', modified: true, status: 'working' });
  tabBar.addTab({ title: 'README.md', icon: '📝' });
  tabBar.addTab({ title: 'Terminal Session 1', icon: '⬛', sessionId: 'sess-1', status: 'idle' });
  tabBar.addTab({ title: 'Terminal Session 2', icon: '⬛', sessionId: 'sess-2', status: 'error' });
  tabBar.addTab({ title: 'Settings', icon: '⚙️', pinned: true });
  const tabLines = tabBar.render({ width: 70, fg, boldFg, dimFg });
  for (const line of tabLines) console.log(`  ${line}`);
  console.log(`  Tabs: ${tabBar.tabCount} | Active: ${tabBar.activeTab?.title}`);
  tabBar.nextTab();
  console.log(`  After next: ${tabBar.activeTab?.title}`);
  console.log(`  Badge: ${tabBar.renderBadge({ width: 70, fg, boldFg, dimFg })}`);

  // ─── 24. Sparkline Charts ─────────────────────────────────────────
  console.log('\n\x1b[1;33m── SparklineCharts ──\x1b[0m');
  const { renderSparkline: renderSpark2, renderBarChart, renderGauge, renderHeatmap, renderTrend, renderMiniStat } = await import('../apps/liora/src/tui/utils/sparkline-charts.ts');
  const fpsData = [58, 60, 59, 55, 42, 38, 52, 58, 60, 60, 59, 57, 60, 58, 55, 50, 45, 55, 58, 60];
  console.log(`  FPS sparkline: ${renderSpark2(fpsData, { width: 20, threshold: 50, criticalThreshold: 40, fg, dimFg })}`);
  const memData = [45, 48, 52, 55, 60, 65, 70, 72, 75, 80, 82, 85];
  console.log(`  Memory trend:  ${renderSpark2(memData, { width: 12, fg, dimFg })} ${renderTrend(85, 45, fg, dimFg)}`);
  // Bar chart
  const barItems = [
    { value: 45000, label: 'system' },
    { value: 85000, label: 'messages' },
    { value: 32000, label: 'tools' },
    { value: 28000, label: 'files' },
    { value: 8000, label: 'memory' },
  ];
  console.log('  Token breakdown:');
  const barLines = renderBarChart(barItems, { width: 50, fg, boldFg, dimFg });
  for (const line of barLines) console.log(`    ${line}`);
  // Gauge
  console.log('  Context gauge:');
  const gaugeLines = renderGauge(0.72, { width: 40, label: 'Context Usage', thresholds: { warning: 0.7, critical: 0.9 }, fg, boldFg, dimFg });
  for (const line of gaugeLines) console.log(`    ${line}`);
  // Heatmap (activity over 7 days x 6 hours)
  const heatData = [
    [0, 1, 3, 5, 2, 0],
    [1, 2, 4, 8, 6, 1],
    [0, 3, 6, 9, 7, 2],
    [2, 4, 7, 10, 8, 3],
    [1, 3, 5, 7, 4, 1],
    [0, 1, 2, 4, 3, 0],
    [0, 0, 1, 2, 1, 0],
  ];
  console.log('  Activity heatmap:');
  const heatLines = renderHeatmap(heatData, { cols: 6, rows: 7, fg, dimFg });
  for (const line of heatLines) console.log(`    ${line}`);
  // Mini stat
  console.log(`  Mini stat: ${renderMiniStat('FPS', '58', fpsData.slice(-12), { width: 12, fg, dimFg })}`);

  // ─── 25. Kitty Graphics ───────────────────────────────────────────
  console.log('\n\x1b[1;33m── KittyGraphics ──\x1b[0m');
  const { KittyGraphics } = await import('../apps/liora/src/tui/utils/kitty-graphics.ts');
  const kitty = new KittyGraphics({ protocol: 'kitty', cellSize: { width: 8, height: 16 } });
  console.log(`  Protocol: ${kitty.describeProtocol()}`);
  console.log(`  Supports sixel: ${kitty.supports('sixel')}`);
  console.log(`  Supports halfblock: ${kitty.supports('halfblock')}`);
  // Register and render
  const imgId = kitty.registerImage(320, 240, 'png', 'iVBORw0KGgoAAAANSUhEUg...(base64)', 'screenshot.png');
  console.log(`  Registered image ID: ${imgId}`);
  const dims = kitty.calculateDimensions(320, 240, 40, 15);
  console.log(`  Display size: ${dims.cols}x${dims.rows} cells`);
  const renderResult = kitty.renderImage({ id: imgId, width: 320, height: 240, format: 'png', data: 'AAAA' }, { width: 20, height: 10 });
  console.log(`  Render: protocol=${renderResult.protocol} rows=${renderResult.rowsUsed} cols=${renderResult.colsUsed}`);
  // Kitty commands
  console.log(`  Query cmd: ${JSON.stringify(kitty.generateQuery())}`);
  console.log(`  Delete all: ${JSON.stringify(kitty.generateDelete('all'))}`);
  // ASCII fallback
  const asciiKitty = new KittyGraphics({ protocol: 'ascii' });
  const asciiResult = asciiKitty.renderImage({ id: 1, width: 640, height: 480, format: 'png', data: '' }, { width: 20, height: 5 });
  console.log('  ASCII fallback:');
  for (const line of asciiResult.escapeSequence.split('\n')) console.log(`    ${line}`);

  // ─── 26. Agent Timeline ───────────────────────────────────────────
  console.log('\n\x1b[1;33m── AgentTimeline ──\x1b[0m');
  const { AgentTimeline } = await import('../apps/liora/src/tui/utils/agent-timeline.ts');
  const timeline = new AgentTimeline();
  const e1 = timeline.addEvent({ type: 'think', title: 'Analyzing requirements', detail: 'Breaking down the task into subtasks' });
  timeline.complete(e1, { tokensUsed: 2500 });
  const e2 = timeline.addEvent({ type: 'tool-call', title: 'Read file: src/main.ts', tokensUsed: 800 });
  timeline.complete(e2);
  const e3 = timeline.addEvent({ type: 'file-edit', title: 'Edit: src/utils.ts', detail: '+15 -3 lines', tokensUsed: 1200 });
  const e3a = timeline.addEvent({ type: 'bash', title: 'npx tsc --noEmit', parentId: e3 });
  timeline.complete(e3a);
  timeline.complete(e3, { tokensUsed: 1200 });
  const e4 = timeline.addEvent({ type: 'bash', title: 'Running tests...', detail: 'vitest run' });
  const e5 = timeline.addEvent({ type: 'error', title: 'Test failed: auth.spec.ts', detail: 'Expected 200, got 401' });
  timeline.fail(e5, 'AssertionError: Expected 200, got 401');
  timeline.complete(e4);
  const e6 = timeline.addEvent({ type: 'approval', title: 'Deploy to staging', detail: 'Awaiting user confirmation' });
  const tlLines = timeline.render({ width: 60, height: 16, mode: 'expanded', showTimestamps: true, showTokens: true, fg, boldFg, dimFg });
  for (const line of tlLines) console.log(`  ${line}`);
  console.log(`  Summary: ${timeline.renderSummary({ width: 60, height: 16, mode: 'expanded', fg, boldFg, dimFg })}`);
  console.log(`  Total tokens: ${timeline.getTotalTokens()} | Events: ${timeline.getAllEvents().length}`);

  // ─── 27. Context Menu ─────────────────────────────────────────────
  console.log('\n\x1b[1;33m── ContextMenu ──\x1b[0m');
  const { ContextMenu, MenuBar } = await import('../apps/liora/src/tui/utils/context-menu.ts');
  const ctxMenu = new ContextMenu();
  ctxMenu.open([
    { id: 'cut', label: 'Cut', icon: '✂️', shortcut: '⌃X' },
    { id: 'copy', label: 'Copy', icon: '📋', shortcut: '⌃C' },
    { id: 'paste', label: 'Paste', icon: '📌', shortcut: '⌃V' },
    { id: 'sep1', label: '', separator: true },
    { id: 'rename', label: 'Rename', icon: '✏️', shortcut: 'F2' },
    { id: 'delete', label: 'Delete', icon: '🗑️', shortcut: '⌫' },
    { id: 'sep2', label: '', separator: true },
    { id: 'git', label: 'Git Actions', icon: '🔀', submenu: [
      { id: 'commit', label: 'Commit', shortcut: '⌃↵' },
      { id: 'push', label: 'Push' },
      { id: 'pull', label: 'Pull' },
    ]},
    { id: 'disabled', label: 'Admin (locked)', disabled: true },
  ], 5, 3);
  const menuLines = ctxMenu.render({ termWidth: 70, termHeight: 24, fg, boldFg, dimFg });
  for (const line of menuLines) console.log(`  ${line}`);
  // Menu bar
  const menuBar = new MenuBar();
  menuBar.setMenus([
    { label: 'File', items: [{ id: 'new', label: 'New' }, { id: 'open', label: 'Open' }] },
    { label: 'Edit', items: [{ id: 'undo', label: 'Undo' }] },
    { label: 'View', items: [{ id: 'zoom', label: 'Zoom' }] },
  ]);
  console.log(`  MenuBar: ${menuBar.render({ termWidth: 70, termHeight: 24, fg, boldFg, dimFg })}`);

  // ═══ Iteration 18 ═══════════════════════════════════════════════════
  console.log('\n\x1b[1;36m═══ VISUAL VERIFICATION: Iteration 18 Modules ═══\x1b[0m');

  // ─── 28. Toast Notification ───────────────────────────────────────
  console.log('\n\x1b[1;33m── ToastNotification ──\x1b[0m');
  const { ToastManager } = await import('../apps/liora/src/tui/utils/toast-notification.ts');
  const toastMgr = new ToastManager({ position: 'top-right' });
  toastMgr.success('File saved', 'src/components/Button.tsx');
  toastMgr.error('Build failed', 'TypeScript: 3 errors found');
  toastMgr.warning('Low disk space', 'Only 2GB remaining');
  toastMgr.show({
    severity: 'info',
    title: 'Downloading dependencies...',
    progress: 0.65,
    actions: [{ label: 'Cancel', action: () => {} }],
  });
  const toastLines2 = toastMgr.render({ width: 42, fg, boldFg, dimFg });
  for (const line of toastLines2) console.log(`  ${line}`);
  console.log(`  Position: ${toastMgr.getPosition()} | Visible: ${toastMgr.count}`);

  // ─── 29. Progress Indicator ───────────────────────────────────────
  console.log('\n\x1b[1;33m── ProgressIndicator ──\x1b[0m');
  const { ProgressTracker, Spinner, renderStepIndicator } = await import('../apps/liora/src/tui/utils/progress-indicator.ts');
  const progTracker = new ProgressTracker();
  progTracker.create({ id: 'build', label: 'Building project', total: 100, unit: 'files' });
  progTracker.update('build', 73);
  progTracker.create({ id: 'test', label: 'Running tests', total: 45, unit: 'tests' });
  progTracker.update('test', 45);
  progTracker.complete('test');
  progTracker.create({ id: 'deploy', label: 'Deploying', total: 0 }); // indeterminate
  const progLines2 = progTracker.render({ width: 50, barStyle: 'classic', showPercentage: true, showEta: true, fg, boldFg, dimFg });
  for (const line of progLines2) console.log(`  ${line}`);
  // Spinner styles
  const spinner2 = new Spinner('Loading modules', 'dots');
  spinner2.tick(); spinner2.tick(); spinner2.tick();
  console.log(`  Spinner: ${spinner2.render(fg)}`);
  console.log(`  Frames: ${spinner2.getFrames().join(' ')}`);
  // Step indicator
  const stepLines2 = renderStepIndicator({
    steps: ['Install', 'Configure', 'Build', 'Test', 'Deploy'],
    current: 2,
    width: 50,
    fg, boldFg, dimFg,
  });
  for (const line of stepLines2) console.log(`  ${line}`);

  // ─── 30. Quick Launcher ───────────────────────────────────────────
  console.log('\n\x1b[1;33m── QuickLauncher ──\x1b[0m');
  const { QuickLauncher } = await import('../apps/liora/src/tui/utils/quick-launcher.ts');
  const launcher = new QuickLauncher();
  launcher.registerAll([
    { id: 'git-commit', title: 'Git: Commit Changes', category: 'Git', icon: '🔀', shortcut: '⌃⇧G', action: () => {} },
    { id: 'git-push', title: 'Git: Push to Remote', category: 'Git', icon: '📤', action: () => {} },
    { id: 'file-save', title: 'File: Save All', category: 'File', icon: '💾', shortcut: '⌃S', pinned: true, action: () => {} },
    { id: 'term-toggle', title: 'Terminal: Toggle Panel', category: 'View', icon: '⬛', action: () => {} },
    { id: 'theme-dark', title: 'Theme: Switch to Dark', category: 'Preferences', icon: '🌙', action: () => {} },
    { id: 'search-all', title: 'Search: Find in Files', category: 'Search', icon: '🔍', shortcut: '⌃⇧F', action: () => {} },
  ]);
  launcher.open();
  launcher.setQuery('git');
  const launcherLines = launcher.render({ width: 52, height: 12, fg, boldFg, dimFg });
  for (const line of launcherLines) console.log(`  ${line}`);
  console.log(`  Results: ${launcher.resultCount} | Query: "${launcher.query}"`);

  // ═══ Iteration 19 ═══════════════════════════════════════════════════
  console.log('\n\x1b[1;36m═══ VISUAL VERIFICATION: Iteration 19 Modules ═══\x1b[0m');

  // ─── 31. Breadcrumb Navigation ────────────────────────────────────
  console.log('\n\x1b[1;33m── BreadcrumbNav ──\x1b[0m');
  const { BreadcrumbNav, createGitCrumbs } = await import('../apps/liora/src/tui/utils/breadcrumb-nav.ts');
  const breadcrumb = new BreadcrumbNav();
  breadcrumb.setFilePath('src/components/ui/Button.tsx');
  console.log(`  Classic:  ${breadcrumb.render({ width: 60, style: 'classic', fg, boldFg, dimFg })}`);
  console.log(`  Arrows:   ${breadcrumb.render({ width: 60, style: 'arrows', fg, boldFg, dimFg })}`);
  console.log(`  Chevrons: ${breadcrumb.render({ width: 60, style: 'chevrons', fg, boldFg, dimFg })}`);
  console.log(`  Pills:    ${breadcrumb.render({ width: 60, style: 'pills', fg, boldFg, dimFg })}`);
  // Git crumbs
  const gitCrumbs = createGitCrumbs('main', 'packages/agent-core/src/agent.ts');
  const gitBreadcrumb = new BreadcrumbNav();
  gitBreadcrumb.setPath(gitCrumbs);
  console.log(`  Git path: ${gitBreadcrumb.render({ width: 60, style: 'arrows', fg, boldFg, dimFg })}`);
  // Overflow
  const longBreadcrumb = new BreadcrumbNav();
  longBreadcrumb.setFilePath('a/b/c/d/e/f/g/h/i/j/file.ts');
  console.log(`  Overflow: ${longBreadcrumb.render({ width: 50, maxSegments: 4, fg, boldFg, dimFg })}`);

  // ─── 32. Data Table ───────────────────────────────────────────────
  console.log('\n\x1b[1;33m── DataTable ──\x1b[0m');
  const { DataTable } = await import('../apps/liora/src/tui/utils/data-table.ts');
  const table = new DataTable();
  table.setColumns([
    { id: 'name', header: 'File', type: 'string', width: 18 },
    { id: 'size', header: 'Size', type: 'number', align: 'right', width: 10 },
    { id: 'status', header: 'Status', type: 'string', width: 10 },
    { id: 'modified', header: 'Modified', type: 'string', width: 12 },
  ]);
  table.setRows([
    { id: '1', data: { name: 'main.ts', size: 2456, status: '✓', modified: '2h ago' } },
    { id: '2', data: { name: 'utils.ts', size: 1123, status: '✓', modified: '1d ago' } },
    { id: '3', data: { name: 'index.ts', size: 812, status: '◉', modified: '5m ago' } },
    { id: '4', data: { name: 'types.ts', size: 3891, status: '✗', modified: '3d ago' } },
    { id: '5', data: { name: 'config.ts', size: 567, status: '✓', modified: '1w ago' } },
  ]);
  table.toggleSelect('3');
  const tableLines = table.render({ width: 60, height: 10, zebra: true, fg, boldFg, dimFg });
  for (const line of tableLines) console.log(`  ${line}`);
  table.sortBy('size');
  console.log(`  Sorted by size: ${table.rowCount} rows`);

  // ─── 33. Color Picker ─────────────────────────────────────────────
  console.log('\n\x1b[1;33m── ColorPicker ──\x1b[0m');
  const { ColorPicker, getNamedColors } = await import('../apps/liora/src/tui/utils/color-picker.ts');
  const colorPicker = new ColorPicker('#FF6B6B');
  const colorLines = colorPicker.render({ width: 48, showPalette: false, showRecent: false, showHarmony: true, fg, boldFg, dimFg });
  for (const line of colorLines) console.log(`  ${line}`);
  // Contrast check
  const white = new ColorPicker('#FFFFFF');
  const ratio = colorPicker.getContrastRatio(white.getCurrent());
  console.log(`  Contrast with white: ${ratio.toFixed(2)}:1 (AA: ${colorPicker.passesAA(white.getCurrent())})`);
  // Gradient
  const blue = new ColorPicker('#4ECDC4');
  console.log(`  Gradient: ${colorPicker.renderGradient(colorPicker.getCurrent(), blue.getCurrent(), 20)}`);
  // Named colors count
  console.log(`  Named colors: ${Object.keys(getNamedColors()).length}`);

  // ═══ Iteration 20 ═══════════════════════════════════════════════════
  console.log('\n\x1b[1;36m═══ VISUAL VERIFICATION: Iteration 20 Modules ═══\x1b[0m');

  // ─── 34. Kanban Board ─────────────────────────────────────────────
  console.log('\n\x1b[1;33m── KanbanBoard ──\x1b[0m');
  const { KanbanBoard, createDefaultBoard } = await import('../apps/liora/src/tui/utils/kanban-board.ts');
  const kanban = createDefaultBoard();
  kanban.addCard('todo', {
    id: 'card-1', title: 'Fix login bug', priority: 'high',
    labels: [{ id: 'bug', name: 'bug', color: '#FF0000' }],
    assignees: ['alice'], createdAt: Date.now(),
  });
  kanban.addCard('todo', {
    id: 'card-2', title: 'Update docs', priority: 'low',
    labels: [], assignees: [], createdAt: Date.now(),
  });
  kanban.addCard('progress', {
    id: 'card-3', title: 'Add tests', priority: 'medium',
    labels: [{ id: 'test', name: 'testing', color: '#00FF00' }],
    assignees: ['bob'], createdAt: Date.now(),
  });
  kanban.addCard('done', {
    id: 'card-4', title: 'Setup CI', priority: 'medium',
    labels: [], assignees: ['alice'], createdAt: Date.now(), completedAt: Date.now(),
  });
  const kanbanLines = kanban.render({ width: 70, height: 12, compact: true, fg, boldFg, dimFg });
  for (const line of kanbanLines) console.log(`  ${line}`);
  console.log(`  Total cards: ${kanban.totalCards} | Columns: ${kanban.getColumns().length}`);

  // ─── 35. Calendar View ────────────────────────────────────────────
  console.log('\n\x1b[1;33m── CalendarView ──\x1b[0m');
  const { CalendarView } = await import('../apps/liora/src/tui/utils/calendar-view.ts');
  const calendar = new CalendarView(new Date(2026, 6, 22)); // July 22, 2026
  calendar.addEvent({ id: 'evt-1', title: 'Team meeting', date: new Date(2026, 6, 22), icon: '📅' });
  calendar.addEvent({ id: 'evt-2', title: 'Release v2.0', date: new Date(2026, 6, 25), icon: '🚀' });
  calendar.addEvent({ id: 'evt-3', title: 'Code review', date: new Date(2026, 6, 22), icon: '👀' });
  const calLines = calendar.render({ width: 28, mode: 'month', showEvents: true, fg, boldFg, dimFg });
  for (const line of calLines) console.log(`  ${line}`);
  console.log(`  Today: ${calendar.isToday(new Date()) ? 'yes' : 'no'} | Mode: ${calendar.getMode()}`);

  // ─── 36. Terminal Multiplexer ─────────────────────────────────────
  console.log('\n\x1b[1;33m── TerminalMultiplexer ──\x1b[0m');
  const { TerminalMultiplexer } = await import('../apps/liora/src/tui/utils/terminal-multiplexer.ts');
  const mux = new TerminalMultiplexer('dev-session');
  const win1 = mux.createWindow('editor');
  mux.splitPane('horizontal', 'terminal');
  mux.splitPane('vertical', 'output');
  const win2 = mux.createWindow('logs');
  mux.switchWindow(win1);
  const muxLines = mux.render({ width: 60, height: 10, showStatusBar: true, fg, boldFg, dimFg });
  for (const line of muxLines) console.log(`  ${line}`);
  console.log(`  Windows: ${mux.windowCount} | Panes: ${mux.paneCount}`);

  // ═══ Iteration 21 ═══════════════════════════════════════════════════
  console.log('\n\x1b[1;36m═══ VISUAL VERIFICATION: Iteration 21 Modules ═══\x1b[0m');

  // ─── 37. Chat Interface ───────────────────────────────────────────
  console.log('\n\x1b[1;33m── ChatInterface ──\x1b[0m');
  const { ChatInterface } = await import('../apps/liora/src/tui/utils/chat-interface.ts');
  const chat = new ChatInterface();
  chat.addUser({ id: 'alice', name: 'Alice', avatar: '👩' });
  chat.addUser({ id: 'me', name: 'Me', isSelf: true });
  chat.addMessage({
    id: 'msg-1', user: { id: 'alice', name: 'Alice', avatar: '👩' },
    content: "Hey! How's the TUI project going?", timestamp: Date.now() - 300000,
    reactions: [], readStatus: 'read',
  });
  chat.addMessage({
    id: 'msg-2', user: { id: 'me', name: 'Me', isSelf: true },
    content: 'Great! Just finished iteration 20 with kanban and calendar.',
    timestamp: Date.now() - 240000, reactions: [{ emoji: '🎉', count: 3 }, { emoji: '👍', count: 2 }],
    readStatus: 'read',
  });
  chat.addMessage({
    id: 'msg-3', user: { id: 'alice', name: 'Alice', avatar: '👩' },
    content: 'Awesome! Can you show me the graph visualization?',
    timestamp: Date.now() - 60000, reactions: [], readStatus: 'delivered',
  });
  chat.setTyping('alice', true);
  const chatLines = chat.render({ width: 55, height: 14, density: 'comfortable', fg, boldFg, dimFg });
  for (const line of chatLines) console.log(`  ${line}`);

  // ─── 38. File Upload ──────────────────────────────────────────────
  console.log('\n\x1b[1;33m── FileUpload ──\x1b[0m');
  const { FileUploadQueue } = await import('../apps/liora/src/tui/utils/file-upload.ts');
  const uploadQueue = new FileUploadQueue({ maxSize: 50 * 1024 * 1024 });
  uploadQueue.addFile({ name: 'report.pdf', size: 2.4 * 1024 * 1024, type: 'application/pdf' });
  uploadQueue.addFile({ name: 'screenshot.png', size: 1.1 * 1024 * 1024, type: 'image/png' });
  uploadQueue.addFile({ name: 'archive.zip', size: 15.2 * 1024 * 1024, type: 'application/zip' });
  // Simulate progress
  const files = uploadQueue.getFiles();
  uploadQueue.startUpload(files[0]!.id);
  uploadQueue.updateProgress(files[0]!.id, 0.78, 1024 * 512);
  uploadQueue.startUpload(files[1]!.id);
  uploadQueue.updateProgress(files[1]!.id, 0.45, 1024 * 256);
  const uploadLines = uploadQueue.renderQueue({ width: 55, showSpeed: true, showEta: true, fg, boldFg, dimFg });
  for (const line of uploadLines) console.log(`  ${line}`);
  // Drop zone
  const dropZone = uploadQueue.renderDropZone({ width: 40, height: 5, active: false, fg, boldFg, dimFg });
  for (const line of dropZone) console.log(`  ${line}`);

  // ─── 39. Graph Visualization ──────────────────────────────────────
  console.log('\n\x1b[1;33m── GraphViz ──\x1b[0m');
  const { GraphViz, createFlowchart } = await import('../apps/liora/src/tui/utils/graph-viz.ts');
  const flowchart = createFlowchart([
    { id: 'start', label: 'Start', type: 'start' },
    { id: 'input', label: 'Get Input', type: 'process' },
    { id: 'check', label: 'Valid?', type: 'decision' },
    { id: 'process', label: 'Process', type: 'process' },
    { id: 'end', label: 'End', type: 'end' },
  ]);
  const graphLines = flowchart.render({ width: 50, height: 20, fg, boldFg, dimFg });
  for (const line of graphLines) console.log(`  ${line}`);
  console.log(`  Nodes: ${flowchart.nodeCount} | Edges: ${flowchart.edgeCount}`);
  const path = flowchart.findPath('start', 'end');
  console.log(`  Path start→end: ${path?.join(' → ') ?? 'none'}`);

  // ═══ Iteration 22 ═══════════════════════════════════════════════════
  console.log('\n\x1b[1;36m═══ VISUAL VERIFICATION: Iteration 22 Modules ═══\x1b[0m');

  // ─── 40. Code Editor ──────────────────────────────────────────────
  console.log('\n\x1b[1;33m── CodeEditor ──\x1b[0m');
  const { CodeEditor } = await import('../apps/liora/src/tui/utils/code-editor.ts');
  const editor = new CodeEditor();
  editor.setFileName('main.ts');
  editor.setContent(`import { Agent } from './agent';\n\nfunction main() {\n  const agent = new Agent();\n  agent.run();\n}`);
  editor.moveDown(); editor.moveDown(); editor.moveDown();
  editor.moveRight(); editor.moveRight();
  const editorLines = editor.render({ width: 50, height: 10, fg, boldFg, dimFg });
  for (const line of editorLines) console.log(`  ${line}`);

  // ─── 41. Terminal Recorder ────────────────────────────────────────
  console.log('\n\x1b[1;33m── TerminalRecorder ──\x1b[0m');
  const { TerminalRecorder } = await import('../apps/liora/src/tui/utils/terminal-recorder.ts');
  const recorder = new TerminalRecorder();
  const recId = recorder.startRecording('Build Session');
  recorder.recordOutput('$ npm run build');
  recorder.recordOutput('> tsc && vite build');
  recorder.recordOutput('✓ Built in 2.3s');
  recorder.stopRecording();
  recorder.play(recId);
  recorder.seek(500);
  const recorderLines = recorder.render({ width: 50, height: 8, fg, boldFg, dimFg });
  for (const line of recorderLines) console.log(`  ${line}`);

  // ─── 42. Widget Dashboard ─────────────────────────────────────────
  console.log('\n\x1b[1;33m── WidgetDashboard ──\x1b[0m');
  const { WidgetDashboard, createDefaultDashboard } = await import('../apps/liora/src/tui/utils/widget-dashboard.ts');
  const dashboard = createDefaultDashboard();
  dashboard.updateWidgetData('widget-1', { time: new Date(2026, 6, 22, 14, 32, 5), format: '24h', showDate: true });
  dashboard.updateWidgetData('widget-2', { value: 0.78, label: '8 cores', thresholds: { warning: 0.7, critical: 0.9 } });
  const dashLines = dashboard.render({ width: 55, height: 14, fg, boldFg, dimFg });
  for (const line of dashLines) console.log(`  ${line}`);
  console.log(`  Widgets: ${dashboard.getWidgets().length}`);

  console.log('\n\x1b[1;36m═══ VERIFICATION COMPLETE ═══\x1b[0m\n');
}

main().catch(console.error);
