export interface ToolbarTip {
  readonly text: string;
  /**
   * Long/important tips render on their own. They never pair with a
   * neighbour and never appear as the second half of someone else's pair.
   */
  readonly solo?: boolean;
  /**
   * Rotation weight: a higher value makes the tip recur more often. Defaults
   * to 1. Used to give newer/important features more airtime.
   */
  readonly priority?: number;
}

/**
 * Subset of toolbar tips shown behind the composing spinner.
 */
export const WORKING_TIPS: readonly ToolbarTip[] = [
  { text: 'ctrl-s adds guidance without waiting for the turn to finish', priority: 2, solo: true },
  { text: '/tasks to check progress for background tasks', priority: 2 },
  { text: '/init: generate AGENTS.md', priority: 2 },
  { text: '/plugins: manage plugins — try the "superpowers" plugin', solo: true, priority: 3 },
  {
    text: '/plugins: manage plugins — try the "Liora Datasource" for reliable financial, economic, and academic data',
    solo: true,
    priority: 3,
  },
  { text: 'ask Liora to schedule tasks, e.g. "remind me at 5pm"', solo: true, priority: 3 },
  { text: '/sessions to browse and resume earlier sessions', solo: true },
  { text: 'describe the outcome and Liora will keep the work organized', priority: 2, solo: true },
  { text: '/goal next to queue follow-up work while the current goal keeps running', solo: true },
  { text: 'shift-tab toggles Ultrawork and off', solo: true, priority: 3 },
  { text: '@: mention files', priority: 2 },
  { text: '! to run a shell command', priority: 2 },
  { text: 'ctrl-o toggles clean chat vs full tool history to audit what Liora did', priority: 2 },
  { text: 'ctrl-b backgrounds a long shell task; /tasks shows progress', priority: 2 },
];

export const ALL_TIPS: readonly ToolbarTip[] = [
  ...WORKING_TIPS,
  { text: 'shift+enter: newline' },
  { text: 'ctrl+c: cancel' },
  { text: '/theme to switch the terminal UI theme' },
  { text: '/auto lets Liora handle approvals and keep going unattended' },
  { text: '/yolo skips most approvals for trusted batch work — only in repos you trust' },
  { text: '/help: show commands' },
  { text: '/compact compresses context when it gets long', priority: 2 },
  { text: '/status: context · ZDR · web/Context7 · media · office · LioraBench', priority: 3, solo: true },
  { text: '/context: memory continuity + privacy (ZDR)', priority: 3, solo: true },
  { text: 'media: OPENAI/GOOGLE key → GenerateImage/Video — no MCP', priority: 2, solo: true },
  { text: 'research: Context7 + WebSearch/FetchURL — no MCP', priority: 2, solo: true },
  { text: 'office: SearchSkill → docx / pptx / xlsx — Word, slides, sheets with zero MCP setup', priority: 2, solo: true },
  { text: 'WebSearch defaults to 2 hits — sharpen the query before raising limit', priority: 1, solo: true },
  { text: '/bench: LioraBench score · loop · next rerun', priority: 2, solo: true },
  { text: 'browser/computer tools are built-in for screenshot proof — no MCP', priority: 2, solo: true },
  { text: 'first run: /login then type a task — no complex config needed', priority: 3, solo: true },
  { text: 'footer badges warn on high context or missing durable evidence after compact', priority: 2, solo: true },
  { text: 'context ladder: micro30/keep2/min2 · async1 · handoff3 · soft1.1 · maxRecent3 · reserved1k · spec400 · recompact0.5 · swarm70/2k/inline14 · pblock4/1.8 · hard45 · abs22k · tool35/2 · cmdPreview3 · resultPreview1 · thinking1', priority: 3, solo: true },
  { text: 'tool outputs auto-trim at 35 with 2-char previews — /compact if still high', priority: 2, solo: true },
  { text: 'live reasoning shows a 4-line tail glance — ctrl+o expands full reasoning', priority: 2, solo: true },
  { text: 'footer context bar is 10-cell with eighths partial fill — denser pressure glance', priority: 1, solo: true },
  { text: 'premium particle rails push denser comets + 7-cell trails — zero config spectacle', priority: 1, solo: true },
  { text: 'tool descs stay dense — Grep over shell rg; Read parallelizes multi-file pulls', priority: 1, solo: true },
  { text: 'footer μ badges show micro clears (cache-miss/swarm) without config', priority: 1, solo: true },
  { text: 'media: GenerateImage/Video zero-config when OPENAI/GOOGLE keys are present', priority: 1, solo: true },
  { text: 'footer web + office + img·vid + zdr badges show research/office/media/privacy readiness without MCP or config', priority: 1, solo: true },
  { text: 'background Agent only for independent work — never TaskOutput-wait after bg launch', priority: 1, solo: true },
  { text: 'shift-tab again turns Ultrawork back off', priority: 2 },
  { text: '/model: switch model', priority: 2 },
  { text: '/login connects providers; OPENAI_API_KEY or GOOGLE_API_KEY for image/video', priority: 2, solo: true },
];
