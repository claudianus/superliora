/**
 * TUI-facing localized strings.
 *
 * The TUI shares the CLI locale (set once at startup via
 * `setCliLocale(detectCliLocale(...))`), so these catalogs are spread into
 * {@link STRINGS_EN} / {@link STRINGS_KO} and resolved through the shared
 * `t()` lookup. TUI keys live under the `tui.*` namespace so they never
 * collide with CLI keys. Lookups go through the `ttui()` wrapper in
 * `src/tui/utils/tui-i18n.ts`.
 *
 * English values stay the product-default strings. Korean values cover the
 * same key set 1:1; any missing key still falls back to English inside `t()`.
 */

export const STRINGS_TUI_EN: Readonly<Record<string, string>> = {
  // ── Generic dialog vocabulary ────────────────────────────────────────────
  'tui.common.cancel': 'Esc cancel',
  'tui.common.cancelCtrlC': 'Ctrl-C cancel',
  'tui.common.select': 'Enter select',
  'tui.common.navigate': '↑↓ navigate',
  'tui.common.page': '←→ page',
  'tui.common.noMatches': 'No matches',
  'tui.common.typeToSearch': '  (type to search)',

  // ── History search (Ctrl-R) ──────────────────────────────────────────────
  'tui.history.title': 'Search history',
  'tui.history.hint': '↑↓ navigate · Enter use · Esc cancel',
  'tui.history.empty': 'No history yet',

  // ── Command palette (Ctrl-Space) ─────────────────────────────────────────
  'tui.palette.title': 'Command palette',
  'tui.palette.hint': '↑↓ navigate · Enter run · Esc cancel',
  'tui.palette.category.commands': 'Commands',
  'tui.palette.category.skills': 'Skills',
  'tui.palette.category.actions': 'Actions',

  // ── Transcript search (Ctrl-F) ───────────────────────────────────────────
  'tui.search.title': 'Search transcript',
  'tui.search.hint': 'Enter next · Shift-Enter prev · Esc close',
  'tui.search.matches': '{count} matches',
  'tui.search.noMatches': 'No matches',
  'tui.search.placeholder': 'Type to search the conversation',

  // ── Retry last failed turn (Ctrl-Y / /retry) ─────────────────────────────
  'tui.retry.hint': 'Press Ctrl-Y (or /retry) to resend your last message',
  'tui.retry.resending': 'Resending last message…',
  'tui.retry.none': 'Nothing to retry yet.',

  // ── Prompt draft stash (Ctrl-X) ──────────────────────────────────────────
  'tui.stash.stashed': 'Draft stashed ({count} in stash)',
  'tui.stash.restored': 'Draft restored ({count} remaining)',
  'tui.stash.empty': 'No stashed drafts',

  // ── Session error navigator (/errors) ────────────────────────────────────
  'tui.errors.title': 'Session errors',
  'tui.errors.count': '{count} errors',
  'tui.errors.empty': 'No errors in this session transcript.',
  'tui.errors.noMatches': 'No matching errors',
  'tui.errors.footer.move': 'move',
  'tui.errors.footer.jump': 'jump',
  'tui.errors.footer.close': 'close',
  'tui.errors.footer.filter': 'type to filter',

  // ── Web content viewer (/web) ────────────────────────────────────────────
  'tui.web.usage': 'Usage: /web <url>',
  'tui.web.fetching': 'Fetching {url} …',

  // ── Git blame viewer (/blame) ────────────────────────────────────────────
  'tui.blame.usage': 'Usage: /blame <path>',
  'tui.blame.loading': 'Loading blame for {path} …',

  // ── Welcome ──────────────────────────────────────────────────────────────
  'tui.welcome.prompt.loggedIn':
    'Type a task · /status web·office·media·ZDR · /bench · Shift-Tab Ultrawork',
  'tui.welcome.prompt.loggedOut':
    'Run /login or paste an API key — media/web/office ready after that, no MCP.',
  'tui.welcome.modelUnset': 'not set, run /login',
  'tui.welcome.label.directory': 'Directory: ',
  'tui.welcome.label.session': 'Session:   ',
  'tui.welcome.label.model': 'Model:     ',
  'tui.welcome.label.version': 'Version:   ',
  'tui.welcome.label.mcp': 'MCP:       ',
  'tui.welcome.modelPrefix': 'Model: ',

  // ── Empty-transcript idle stage ──────────────────────────────────────────
  'tui.idle.title': 'jewel tank',
  'tui.idle.tipPrefix': 'tip · ',
  'tui.idle.mood.bubbles': 'a silver plume climbs the glass',
  'tui.idle.mood.swim': 'the lead fish draws a slow arc',
  'tui.idle.mood.ready': 'clear water · prompt open',
  'tui.idle.mood.tank': 'coral hush, waiting for a line',
  'tui.idle.mood.quiet': 'caustic light, soft current',

  // ── Footer hints / next-actions ──────────────────────────────────────────
  'tui.footer.next.login': 'next: /login to add a provider, then /model',
  'tui.footer.next.compact': 'next: /compact before long work',
  'tui.footer.next.review': 'next: review changes',
  'tui.footer.next.media': 'next: set OPENAI_API_KEY or GOOGLE_API_KEY for image/video, or /status',
  'tui.footer.next.history': 'next: ctrl-o toggles clean chat vs tool history',
  'tui.footer.next.default': 'next: Shift-Tab toggles Ultrawork/off · /bench for LioraBench',
  'tui.footer.compacting': 'compacting context',
  'tui.footer.compacting.background': 'compacting in background · turn continues',
  'tui.footer.replaying': 'replaying session',
  'tui.footer.ultrawork': 'Workflow: research → interview → goal → swarm → integrate → verify → learn',
  'tui.ultrawork.autoResume.title': 'Ultrawork auto-resumed',
  'tui.ultrawork.autoResume.detail': 'Resuming the interrupted run at stage {stage}.',
  'tui.footer.premium': 'Premium Quality ON — art direction, anti-slop, screenshot proof',
  'tui.footer.exitConfirmCtrlC': 'Press Ctrl+C again to exit',
  'tui.footer.exitConfirmCtrlD': 'Press Ctrl+D again to exit',
  'tui.footer.detachHint': 'Detached. Output continues in background (/tasks).',

  // ── Permission mode notices ──────────────────────────────────────────────
  'tui.permission.yolo.on.title': 'YOLO mode: ON',
  'tui.permission.yolo.on.detail':
    'Most tools auto-approved. Structured questions auto-answered; still asks for delete/secrets.',
  'tui.permission.yolo.off.title': 'YOLO mode: OFF',
  'tui.permission.yolo.alreadyOn': 'YOLO mode is already on',
  'tui.permission.yolo.alreadyOff': 'YOLO mode is already off',
  'tui.permission.auto.on.title': 'Auto mode: ON',
  'tui.permission.auto.on.detail':
    'Tools auto-approved. Structured questions are auto-answered.',
  'tui.permission.auto.off.title': 'Auto mode: OFF',
  'tui.permission.auto.alreadyOn': 'Auto mode is already on',
  'tui.permission.auto.alreadyOff': 'Auto mode is already off',
  'tui.permission.mode.set': 'Permission mode: {mode}',
  'tui.permission.mode.unchanged': 'Permission mode unchanged: {mode}.',
  'tui.permission.selector.title': 'Select permission mode',
  'tui.permission.manual.label': 'Manual',
  'tui.permission.manual.desc':
    'Ask before commands, edits, and other risky actions. Read/search tools run directly; session approval rules are respected.',
  'tui.permission.auto.label': 'Auto',
  'tui.permission.auto.desc':
    'Run fully non-interactively. Tool actions are approved automatically, and structured agent questions are auto-answered so it can decide on its own.',
  'tui.permission.yolo.label': 'YOLO',
  'tui.permission.yolo.desc':
    'Automatically approve most tool actions and plan transitions. Structured questions are auto-answered; SuperLiora still asks you for delete/destructive or credential/secret access.',
  'tui.permission.replay.yoloOn.detail':
    'All actions will be approved automatically. Use with caution.',
  'tui.permission.setFailed': 'Failed to set permission mode: {message}',

  // ── Premium / Ultrawork ──────────────────────────────────────────────────
  'tui.premium.alreadyOn': 'Premium Quality mode is already on',
  'tui.premium.alreadyOff': 'Premium Quality mode is already off',
  'tui.premium.on.title': 'Premium Quality mode: ON',
  'tui.premium.off.title': 'Premium Quality mode: OFF',
  'tui.premium.on.detail':
    'Visual-first premium harness active — art direction, anti-slop visuals, skill routing, screenshot proof.',
  'tui.premium.on.detail.apply':
    'Visual-first premium harness active — art direction, skill routing, rubric, screenshot verification.',
  'tui.premium.usage': 'Usage: /premium [on|off|status]',
  'tui.premium.setFailed': 'Failed to set Premium Quality mode: {message}',
  'tui.premium.enableFailed': 'Failed to enable Premium Quality mode: {message}',
  'tui.aquarium.restored':
    'Jewel Tank overlay on — click to feed; send a message to return to your chat.',
  'tui.aquarium.replaying': 'Cannot show the aquarium while session history is replaying.',
  'tui.ultrawork.on.title': 'Ultrawork mode: ON',
  'tui.ultrawork.off.title': 'Ultrawork mode: OFF',
  'tui.ultrawork.on.detail':
    'Shift-Tab routes the next task through UltraPlan before any UltraGoal or Swarm work.',
  'tui.ultrawork.enableFailed': 'Failed to enable Ultrawork mode: {message}',
  'tui.ultrawork.disableFailed': 'Failed to disable Ultrawork mode: {message}',

  // ── Goal / swarm start prompts ───────────────────────────────────────────
  'tui.goal.start.title.manual': 'Start a goal with approvals on?',
  'tui.goal.start.title.yolo': 'Start a goal in YOLO mode?',
  'tui.goal.start.option.auto': 'Switch to Auto and start',
  'tui.goal.start.option.auto.desc':
    'Best if you want SuperLiora to keep working while you are away. Tools are approved automatically, and structured questions are auto-answered.',
  'tui.goal.start.option.yolo': 'Switch to YOLO and start',
  'tui.goal.start.option.yolo.desc':
    'Tools and plan changes are approved automatically. Structured questions are auto-answered; SuperLiora still asks for delete/destructive or credential/secret access.',
  'tui.goal.start.option.keepYolo': 'Keep YOLO and start',
  'tui.goal.start.option.keepYolo.desc':
    'Tools and plan changes stay approved automatically. Structured questions are auto-answered; SuperLiora still asks for delete/destructive or credential/secret access.',
  'tui.goal.start.option.manual': 'Start in Manual',
  'tui.goal.start.option.manual.desc':
    'Keep approvals on. SuperLiora will ask before risky actions, so the goal may stop and wait for you.',
  'tui.goal.start.option.cancel': 'Do not start',
  'tui.goal.start.option.cancel.desc': 'Return to the input box with your goal command.',
  'tui.goal.start.notice.manual.1':
    'Manual mode asks you before SuperLiora runs commands, edits files, or takes other risky actions.',
  'tui.goal.start.notice.manual.2': 'Manual mode is not suitable for unattended goal work.',
  'tui.goal.start.notice.manual.3': 'You can go back without losing your command.',
  'tui.goal.start.notice.yolo.1': 'YOLO mode approves most tools and plan changes automatically.',
  'tui.goal.start.notice.yolo.2':
    'Structured questions are auto-answered; YOLO still asks for delete/destructive or credential/secret access.',
  'tui.goal.start.notice.yolo.3':
    'Switch to Auto for fully unattended work including structured questions.',
  'tui.swarm.start.title': 'Start a swarm task with approvals on?',
  'tui.swarm.start.option.auto': 'Switch to Auto and start',
  'tui.swarm.start.option.auto.desc':
    'Best for swarm tasks. Tools are approved automatically, and structured questions are auto-answered.',
  'tui.swarm.start.option.yolo': 'Switch to YOLO and start',
  'tui.swarm.start.option.yolo.desc':
    'Tools and plan changes are approved automatically. Structured questions are auto-answered; SuperLiora still asks for delete/destructive or credential/secret access.',
  'tui.swarm.start.option.manual': 'Start in Manual',
  'tui.swarm.start.option.manual.desc':
    'Keep approvals on. SuperLiora may stop and wait for you during the swarm task.',
  'tui.swarm.start.notice.1':
    'Manual mode asks you before SuperLiora runs commands, edits files, or takes other risky actions.',
  'tui.swarm.start.notice.2': 'Manual mode can block swarm work while agents are running.',
  'tui.swarm.start.notice.3': 'You can go back without losing your command.',
  'tui.ultrawork.start.title': 'How should Ultrawork interview and approvals run?',
  'tui.ultrawork.start.option.manual': 'Manual (default)',
  'tui.ultrawork.start.option.manual.desc':
    'You answer every AskUserQuestion and approve tools, edits, and high-risk gates. Best when you want full control during the Ultrawork interview.',
  'tui.ultrawork.start.option.auto': 'Auto',
  'tui.ultrawork.start.option.auto.desc':
    'SuperLiora auto-answers AskUserQuestion and auto-approves tools. Same interview questions as Manual; only the responder changes.',
  'tui.ultrawork.start.option.yolo': 'YOLO',
  'tui.ultrawork.start.option.yolo.desc':
    'SuperLiora auto-answers AskUserQuestion and most tools. Humans still gate delete/destructive actions and credential/secret access.',
  'tui.ultrawork.start.notice.1':
    'Choose who answers the Ultrawork interview and high-risk gates.',
  'tui.ultrawork.start.notice.2':
    'The interview script is the same in every mode — only the responder and tool approvals change.',
  'tui.ultrawork.start.notice.3': 'This choice is not remembered; Manual is selected by default on every new Ultrawork start.',

  // ── Device code / OAuth box ──────────────────────────────────────────────
  'tui.device.visitUrl': 'Visit the URL below in your browser to authorize:',
  'tui.device.codeLabel': 'Verification code:  ',

  // ── Help ─────────────────────────────────────────────────────────────────
  'tui.help.intro.default':
    'Shift-Tab toggles Ultrawork and off.\n/status shows media, web/Context7, ZDR, LioraBench readiness.\nNormal messages stay lightweight unless Ultrawork is on.',
  'tui.help.intro.advanced':
    'Ultrawork is one workflow: UltraPlan, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn.\nShift-Tab toggles Ultrawork/off; /plan and Ctrl-Shift-Tab are explicit steering controls below.\n/status shows media, web/Context7, ZDR, LioraBench readiness.',
  'tui.help.shortcut.shiftTab': 'Toggle Ultrawork / off',
  'tui.help.shortcut.ctrlG': 'Edit in external editor ($VISUAL / $EDITOR)',
  'tui.help.shortcut.ctrlO': 'Toggle tool output expansion (recent turns)',
  'tui.help.shortcut.ctrlB': 'Background a long-running shell task · /tasks',
  'tui.help.shortcut.ctrlT': 'Expand / collapse the todo list (when truncated)',
  'tui.help.shortcut.ctrlS': 'Steer — inject a follow-up during streaming',
  'tui.help.shortcut.ctrlX': 'Stash or restore prompt draft',
  'tui.help.shortcut.newline': 'Insert newline',
  'tui.help.shortcut.ctrlC': 'Interrupt stream / clear input',
  'tui.help.shortcut.ctrlD': 'Exit (on empty input)',
  'tui.help.shortcut.esc': 'Close dialogs / interrupt streaming',
  'tui.help.shortcut.escEsc': 'Open undo selector (idle prompt)',
  'tui.help.shortcut.history': 'Browse input history',
  'tui.help.shortcut.enter': 'Submit',
  'tui.help.shortcut.ctrlShiftTab': 'Steer UltraPlan',

  // ── Provider / login flows ───────────────────────────────────────────────
  'tui.provider.catalogLoading': 'Loading provider catalog',
  'tui.provider.catalogLoaded': 'Catalog loaded.',
  'tui.provider.catalogAborted': 'Aborted.',
  'tui.provider.catalogFailed': 'Failed to load catalog.',
  'tui.provider.catalogFailedDetail': 'Failed to load provider catalog: {message}',
  'tui.provider.notInCatalog': 'Provider "{provider}" is not in the catalog.',
  'tui.provider.noModels': 'Provider "{provider}" has no usable models in this catalog.',
  'tui.provider.unsupportedWire': 'Provider "{provider}" has an unsupported wire type.',
  'tui.provider.added': 'Provider added: {name}',
  'tui.provider.mediaHint':
    'Tip: OPENAI_API_KEY / GOOGLE_API_KEY enable image/video · /status checks media/web readiness',
  'tui.provider.apiKeyPrompt': 'Enter API key for {name}',
  'tui.provider.openingBrowser': 'Opening browser to authorize…\nIf it did not open, visit:\n{url}',
  'tui.provider.waitingAuthorization': 'Waiting for authorization…',
  'tui.provider.pasteCallbackTitle': 'Paste OAuth callback',
  'tui.provider.pasteCallbackHint1':
    'If the browser could not redirect back automatically, paste the',
  'tui.provider.pasteCallbackHint2': 'callback URL or authorization code shown after sign-in.',
  'tui.provider.authorizing': 'Authorizing with {name}',
  'tui.provider.connected': 'Connected: {name}',
  'tui.provider.alreadyLoggedIn': 'Already logged in. Model configuration refreshed.',
  'tui.provider.addAccountTitle': 'Managed SuperLiora account',
  'tui.provider.addAccountProviderTitle': '{name} account',
  'tui.provider.addAccountRefresh': 'Refresh current account',
  'tui.provider.addAccountRefreshDesc':
    'Re-authorize the current primary account and refresh models.',
  'tui.provider.addAccountAdd': 'Add another account',
  'tui.provider.addAccountAddDesc':
    'Log in with a different account for automatic quota/rate-limit fallback.',
  'tui.provider.accountAdded':
    'Added OAuth account (slot {fingerprint}). Quota failures auto-switch across the account pool.',
  'tui.provider.loggedOut': 'Logged out.',
  'tui.provider.defaultModelSet': 'Default model set to {model} with thinking {state}.',
  'tui.provider.customEndpointAdded': 'Custom endpoint added: {model}',
  'tui.provider.registryNoProviders': 'Registry contained no providers.',
  'tui.provider.registryImported': 'Imported {count} providers from registry.',
  'tui.provider.registryImportedOne': 'Imported 1 provider from registry.',
  'tui.provider.customEndpointFailed': 'Failed to add custom endpoint: {message}',
  'tui.provider.registryFetchFailed': 'Failed to import registry: {message}',
  'tui.provider.registryApplyFailed': 'Failed to apply registry: {message}',
  'tui.provider.setModelFailed': 'Set default model failed: {message}',
  'tui.provider.loginFailed': 'Login failed: {message}',
  'tui.provider.loginFailedLabel': 'Login failed.',
  'tui.provider.loginCancelled': 'Login cancelled.',
  'tui.provider.refreshFailed':
    'Authentication successful, but failed to refresh config: {message}',

  // ── Sessions ─────────────────────────────────────────────────────────────
  'tui.sessions.fetchFailed': 'Failed to load sessions. Check the server connection.',
  'tui.sessions.noActive': 'No active session.',

  // ── Shell command ────────────────────────────────────────────────────────
  'tui.shell.running': 'Running: {command}',

  // ── Status / errors ──────────────────────────────────────────────────────
  'tui.status.noEditor':
    'No editor configured. Set $VISUAL / $EDITOR, or run /editor <command>.',
  'tui.status.compactCancelFailed': 'Failed to cancel compaction: {message}',
  'tui.status.externalEditorFailed': 'External editor failed: {message}',
  'tui.status.startupFailed': 'Startup session was not initialized.',

  // ── Tips (footer / working spinner) ──────────────────────────────────────
  'tui.tip.ctrlS': 'ctrl-s adds guidance without waiting for the turn to finish',
  'tui.tip.tasks': '/tasks to check progress for background tasks',
  'tui.tip.init': '/init: generate AGENTS.md',
  'tui.tip.pluginsSuperpowers': '/plugins: manage plugins — try the "superpowers" plugin',
  'tui.tip.pluginsDatasource':
    '/plugins: manage plugins — try the "Liora Datasource" for reliable financial, economic, and academic data',
  'tui.tip.schedule': 'ask Liora to schedule tasks, e.g. "remind me at 5pm"',
  'tui.tip.sessions': '/sessions to browse and resume earlier sessions',
  'tui.tip.outcome': 'describe the outcome and Liora will keep the work organized',
  'tui.tip.goalNext': '/goal next to queue follow-up work while the current goal keeps running',
  'tui.tip.shiftTab': 'shift-tab toggles Ultrawork and off',
  'tui.tip.mention': '@: mention files',
  'tui.tip.shell': '! to run a shell command',
  'tui.tip.ctrlO': 'ctrl-o toggles clean chat vs full tool history to audit what Liora did',
  'tui.tip.ctrlB': 'ctrl-b backgrounds a long shell task; /tasks shows progress',
  'tui.tip.shiftEnter': 'shift+enter: newline',
  'tui.tip.ctrlC': 'ctrl+c: cancel',
  'tui.tip.theme': '/theme to switch the terminal UI theme',
  'tui.tip.aquarium': '/aquarium overlays a Welcome-sized Jewel Tank; send a message to leave',
  'tui.tip.auto': '/auto lets Liora handle approvals and keep going unattended',
  'tui.tip.yolo': '/yolo skips most approvals for trusted batch work — only in repos you trust',
  'tui.tip.help': '/help: show commands',
  'tui.tip.compact': '/compact compresses context when it gets long',
  'tui.tip.status': '/status: context · ZDR · web/Context7 · media · office · LioraBench',
  'tui.tip.context': '/context: memory continuity + privacy (ZDR)',
  'tui.tip.mediaKeys': 'media: OPENAI/GOOGLE key → GenerateImage/Video — no MCP',
  'tui.tip.research': 'research: Context7 + WebSearch/FetchURL — no MCP',
  'tui.tip.office':
    'office: SearchSkill → docx / pptx / xlsx — Word, slides, sheets with zero MCP setup',
  'tui.tip.websearch': 'WebSearch defaults to 3 hits — sharpen the query before raising limit',
  'tui.tip.bench': '/bench: LioraBench score · loop · next rerun',
  'tui.tip.browser': 'browser/computer tools are built-in for screenshot proof — no MCP',
  'tui.tip.firstRun': 'first run: /login then type a task — no complex config needed',
  'tui.tip.footerBadges':
    'footer badges warn on high context or missing durable evidence after compact',
  'tui.tip.contextLadder':
    'context ladder: micro40 · async55 · soft70 · hard90 · recompact5 · reserved16k · maxRecent12 · no abs floor',
  'tui.tip.toolTrim':
    'tool outputs auto-trim at 4000 with 80-char previews — /compact if still high',
  'tui.tip.reasoningGlance':
    'live reasoning shows a 4-line tail glance — ctrl+o expands full reasoning',
  'tui.tip.contextBar':
    'footer context bar is 10-cell with eighths partial fill — denser pressure glance',
  'tui.tip.particleRails':
    'premium rails drift soft comets + quiet star dust — no marquee thrash',
  'tui.tip.toolDescs':
    'tool descs stay dense — Grep over shell rg; Read parallelizes multi-file pulls',
  'tui.tip.autoDream':
    '/status Memory shows auto-dream on/×N (default on, ≥4h/8 records) — long-horizon recall hygiene',
  'tui.tip.microBadges': 'footer μ badges show micro clears (cache-miss/swarm) without config',
  'tui.tip.mediaZeroConfig':
    'media: GenerateImage/Video zero-config when OPENAI/GOOGLE keys are present',
  'tui.tip.mediaFooter':
    'media: footer img/vid badges appear only when OPENAI/GOOGLE keys make GenerateImage/Video ready',
  'tui.tip.backgroundAgent':
    'background Agent only for independent work — never TaskOutput-wait after bg launch',
  'tui.tip.shiftTabOff': 'shift-tab again turns Ultrawork back off',
  'tui.tip.model': '/model: switch model',
  'tui.tip.loginMedia':
    '/login connects providers; OPENAI_API_KEY or GOOGLE_API_KEY for image/video',
  'tui.tip.glances': 'TUI glances: thinking 4 · command 4 · result 3 (not densify 1/1/2)',
  'tui.tip.recall':
    'Liora Recall injects ≤6 memories · 480 chars each; Bash soft-caps 4k; LioraExpand pages 120 lines',

  // ── Appearance settings ─────────────────────────────────────────────────
  'tui.appearance.timestamps': 'Timestamps',
};

/**
 * Korean TUI strings. Keys absent here fall back to English inside `t()`.
 */
export const STRINGS_TUI_KO: Readonly<Record<string, string>> = {
  // ── Generic dialog vocabulary ────────────────────────────────────────────
  'tui.common.cancel': 'Esc 취소',
  'tui.common.cancelCtrlC': 'Ctrl-C 취소',
  'tui.common.select': 'Enter 선택',
  'tui.common.navigate': '↑↓ 이동',
  'tui.common.page': '←→ 페이지',
  'tui.common.noMatches': '결과 없음',
  'tui.common.typeToSearch': '  (검색하려면 입력)',

  // ── History search (Ctrl-R) ──────────────────────────────────────────────
  'tui.history.title': '히스토리 검색',
  'tui.history.hint': '↑↓ 이동 · Enter 사용 · Esc 취소',
  'tui.history.empty': '히스토리가 없습니다',

  // ── Command palette (Ctrl-Space) ─────────────────────────────────────────
  'tui.palette.title': '명령 팔레트',
  'tui.palette.hint': '↑↓ 이동 · Enter 실행 · Esc 취소',
  'tui.palette.category.commands': '명령',
  'tui.palette.category.skills': '스킬',
  'tui.palette.category.actions': '동작',

  // ── Transcript search (Ctrl-F) ───────────────────────────────────────────
  'tui.search.title': '대화 검색',
  'tui.search.hint': 'Enter 다음 · Shift-Enter 이전 · Esc 닫기',
  'tui.search.matches': '{count}개 일치',
  'tui.search.noMatches': '일치 항목 없음',
  'tui.search.placeholder': '대화 내용을 검색하려면 입력',

  // ── Retry last failed turn (Ctrl-Y / /retry) ─────────────────────────────
  'tui.retry.hint': 'Ctrl-Y(또는 /retry)를 눌러 마지막 메시지를 다시 보내세요',
  'tui.retry.resending': '마지막 메시지를 다시 보내는 중…',
  'tui.retry.none': '다시 보낼 메시지가 없습니다.',

  // ── Prompt draft stash (Ctrl-X) ──────────────────────────────────────────
  'tui.stash.stashed': '초안 보관 (보관함 {count}개)',
  'tui.stash.restored': '초안 복원 (남은 보관 {count}개)',
  'tui.stash.empty': '보관된 초안이 없습니다',

  // ── Session error navigator (/errors) ────────────────────────────────────
  'tui.errors.title': '세션 오류',
  'tui.errors.count': '오류 {count}개',
  'tui.errors.empty': '이 세션 기록에 오류가 없습니다.',
  'tui.errors.noMatches': '일치하는 오류가 없습니다',
  'tui.errors.footer.move': '이동',
  'tui.errors.footer.jump': '점프',
  'tui.errors.footer.close': '닫기',
  'tui.errors.footer.filter': '입력하면 필터링',

  // ── Web content viewer (/web) ────────────────────────────────────────────
  'tui.web.usage': '사용법: /web <url>',
  'tui.web.fetching': '{url} 가져오는 중…',

  // ── Git blame viewer (/blame) ────────────────────────────────────────────
  'tui.blame.usage': '사용법: /blame <path>',
  'tui.blame.loading': '{path} blame 불러오는 중…',

  // ── Welcome ──────────────────────────────────────────────────────────────
  'tui.welcome.prompt.loggedIn':
    '작업을 입력하세요 · /status web·office·media·ZDR · /bench · Shift-Tab Ultrawork',
  'tui.welcome.prompt.loggedOut':
    '/login 또는 API 키를 붙여넣으세요 — 이후 media/web/office 사용 가능, MCP 불필요.',
  'tui.welcome.modelUnset': '미설정, /login 실행',
  'tui.welcome.label.directory': '디렉터리: ',
  'tui.welcome.label.session': '세션:     ',
  'tui.welcome.label.model': '모델:     ',
  'tui.welcome.label.version': '버전:     ',
  'tui.welcome.label.mcp': 'MCP:      ',
  'tui.welcome.modelPrefix': '모델: ',

  // ── Empty-transcript idle stage ──────────────────────────────────────────
  'tui.idle.title': '보석 수조',
  'tui.idle.tipPrefix': '팁 · ',
  'tui.idle.mood.bubbles': '은빛 기포가 유리를 타고 오른다',
  'tui.idle.mood.swim': '주연 물고기가 느린 호를 그린다',
  'tui.idle.mood.ready': '맑은 물 · 프롬프트 열림',
  'tui.idle.mood.tank': '산호가 고요하다, 한 줄을 기다린다',
  'tui.idle.mood.quiet': '캐우스틱 빛, 잔잔한 흐름',

  // ── Footer hints / next-actions ──────────────────────────────────────────
  'tui.footer.next.login': '다음: /login으로 프로바이더 추가, 그리고 /model',
  'tui.footer.next.compact': '다음: 긴 작업 전 /compact',
  'tui.footer.next.review': '다음: 변경사항 검토',
  'tui.footer.next.media': '다음: OPENAI_API_KEY 또는 GOOGLE_API_KEY로 이미지/영상, 또는 /status',
  'tui.footer.next.history': '다음: ctrl-o로 깔끔한 채팅 ↔ 전체 도구 기록',
  'tui.footer.next.default': '다음: Shift-Tab로 Ultrawork 켜기/끄기 · /bench로 LioraBench',
  'tui.footer.compacting': '컨텍스트 압축 중',
  'tui.footer.compacting.background': '백그라운드 압축 중 · 턴 계속 진행',
  'tui.footer.replaying': '세션 재생 중',
  'tui.footer.ultrawork': '워크플로: 조사 → 인터뷰 → 목표 → 스웜 → 통합 → 검증 → 학습',
  'tui.ultrawork.autoResume.title': 'Ultrawork 자동 재개',
  'tui.ultrawork.autoResume.detail': '중단된 실행을 stage {stage}에서 이어갑니다.',
  'tui.footer.premium': '프리미엄 품질 ON — 아트 디렉션, 안티 슬롭, 스크린샷 증명',
  'tui.footer.exitConfirmCtrlC': '종료하려면 Ctrl+C를 다시 누르세요',
  'tui.footer.exitConfirmCtrlD': '종료하려면 Ctrl+D를 다시 누르세요',
  'tui.footer.detachHint': '분리됨. 백그라운드 출력 계속 (/tasks).',

  // ── Permission mode notices ──────────────────────────────────────────────
  'tui.permission.yolo.on.title': 'YOLO 모드: ON',
  'tui.permission.yolo.on.detail':
    '대부분 도구 자동 승인. 구조화 질문은 자동 응답; 삭제/시크릿은 여전히 확인.',
  'tui.permission.yolo.off.title': 'YOLO 모드: OFF',
  'tui.permission.yolo.alreadyOn': 'YOLO 모드가 이미 켜져 있습니다',
  'tui.permission.yolo.alreadyOff': 'YOLO 모드가 이미 꺼져 있습니다',
  'tui.permission.auto.on.title': 'Auto 모드: ON',
  'tui.permission.auto.on.detail': '도구 자동 승인. 구조화 질문은 자동 응답됩니다.',
  'tui.permission.auto.off.title': 'Auto 모드: OFF',
  'tui.permission.auto.alreadyOn': 'Auto 모드가 이미 켜져 있습니다',
  'tui.permission.auto.alreadyOff': 'Auto 모드가 이미 꺼져 있습니다',
  'tui.permission.mode.set': '권한 모드: {mode}',
  'tui.permission.mode.unchanged': '권한 모드 변경 없음: {mode}.',
  'tui.permission.selector.title': '권한 모드 선택',
  'tui.permission.manual.label': 'Manual',
  'tui.permission.manual.desc':
    '명령·편집·위험 작업 전에 묻습니다. 읽기/검색 도구는 바로 실행되며 세션 승인 규칙을 따릅니다.',
  'tui.permission.auto.label': 'Auto',
  'tui.permission.auto.desc':
    '완전 비대화형. 도구는 자동 승인되고 구조화 질문도 자동 응답되어 스스로 진행합니다.',
  'tui.permission.yolo.label': 'YOLO',
  'tui.permission.yolo.desc':
    '대부분 도구와 플랜 전환을 자동 승인. 구조화 질문은 자동 응답; 삭제/파괴적 작업·자격증명/시크릿은 여전히 묻습니다.',
  'tui.permission.replay.yoloOn.detail': '모든 작업이 자동 승인됩니다. 주의해서 사용하세요.',
  'tui.permission.setFailed': '권한 모드 설정 실패: {message}',

  // ── Premium / Ultrawork ──────────────────────────────────────────────────
  'tui.premium.alreadyOn': '프리미엄 품질 모드가 이미 켜져 있습니다',
  'tui.premium.alreadyOff': '프리미엄 품질 모드가 이미 꺼져 있습니다',
  'tui.premium.on.title': '프리미엄 품질 모드: ON',
  'tui.premium.off.title': '프리미엄 품질 모드: OFF',
  'tui.premium.on.detail':
    '시각 우선 프리미엄 하네스 활성 — 아트 디렉션, 안티 슬롭, 스킬 라우팅, 스크린샷 증명.',
  'tui.premium.on.detail.apply':
    '시각 우선 프리미엄 하네스 활성 — 아트 디렉션, 스킬 라우팅, 루브릭, 스크린샷 검증.',
  'tui.premium.usage': '사용법: /premium [on|off|status]',
  'tui.premium.setFailed': '프리미엄 품질 모드 설정 실패: {message}',
  'tui.premium.enableFailed': '프리미엄 품질 모드 활성화 실패: {message}',
  'tui.aquarium.restored':
    'Jewel Tank 오버레이 — 클릭으로 밥 주기, 메시지를 보내면 채팅으로 돌아갑니다.',
  'tui.aquarium.replaying': '세션 기록 재생 중에는 어항을 표시할 수 없습니다.',
  'tui.ultrawork.on.title': 'Ultrawork 모드: ON',
  'tui.ultrawork.off.title': 'Ultrawork 모드: OFF',
  'tui.ultrawork.on.detail':
    'Shift-Tab은 다음 작업을 UltraGoal/Swarm 전에 UltraPlan으로 보냅니다.',
  'tui.ultrawork.enableFailed': 'Ultrawork 모드 활성화 실패: {message}',
  'tui.ultrawork.disableFailed': 'Ultrawork 모드 비활성화 실패: {message}',

  // ── Goal / swarm start prompts ───────────────────────────────────────────
  'tui.goal.start.title.manual': '승인 확인을 켠 채로 목표를 시작할까요?',
  'tui.goal.start.title.yolo': 'YOLO 모드로 목표를 시작할까요?',
  'tui.goal.start.option.auto': 'Auto로 전환하고 시작',
  'tui.goal.start.option.auto.desc':
    '자리를 비워도 계속 작업하게 하려면 최적. 도구는 자동 승인, 구조화 질문은 자동 응답.',
  'tui.goal.start.option.yolo': 'YOLO로 전환하고 시작',
  'tui.goal.start.option.yolo.desc':
    '도구와 플랜 변경 자동 승인. 구조화 질문은 자동 응답; 삭제/파괴적 작업·자격증명/시크릿은 여전히 묻습니다.',
  'tui.goal.start.option.keepYolo': 'YOLO 유지하고 시작',
  'tui.goal.start.option.keepYolo.desc':
    '도구와 플랜 변경은 계속 자동 승인. 구조화 질문은 자동 응답; 삭제/파괴적 작업·자격증명/시크릿은 여전히 묻습니다.',
  'tui.goal.start.option.manual': 'Manual로 시작',
  'tui.goal.start.option.manual.desc':
    '승인 확인 유지. 위험 작업 전에 물어 목표가 대기할 수 있습니다.',
  'tui.goal.start.option.cancel': '시작하지 않음',
  'tui.goal.start.option.cancel.desc': '목표 명령을 유지한 채 입력창으로 돌아갑니다.',
  'tui.goal.start.notice.manual.1':
    'Manual 모드는 명령 실행·파일 편집 등 위험 작업 전에 확인합니다.',
  'tui.goal.start.notice.manual.2': '무인 목표 실행에는 Manual이 적합하지 않습니다.',
  'tui.goal.start.notice.manual.3': '명령을 잃지 않고 돌아갈 수 있습니다.',
  'tui.goal.start.notice.yolo.1': 'YOLO 모드는 대부분 도구와 플랜 변경을 자동 승인합니다.',
  'tui.goal.start.notice.yolo.2':
    '구조화 질문은 자동 응답; 삭제/파괴적 작업·자격증명/시크릿은 여전히 묻습니다.',
  'tui.goal.start.notice.yolo.3': '구조화 질문까지 완전 무인으로 가려면 Auto로 전환하세요.',
  'tui.swarm.start.title': '스웜 작업을 승인 확인과 함께 시작할까요?',
  'tui.swarm.start.option.auto': 'Auto로 전환하고 시작',
  'tui.swarm.start.option.auto.desc':
    '스웜에 최적. 도구 자동 승인, 구조화 질문은 자동 응답.',
  'tui.swarm.start.option.yolo': 'YOLO로 전환하고 시작',
  'tui.swarm.start.option.yolo.desc':
    '도구와 플랜 변경 자동 승인. 구조화 질문은 자동 응답; 삭제/파괴적 작업·자격증명/시크릿은 여전히 묻습니다.',
  'tui.swarm.start.option.manual': 'Manual로 시작',
  'tui.swarm.start.option.manual.desc':
    '승인 확인 유지. 스웜 작업 중 SuperLiora가 대기할 수 있습니다.',
  'tui.swarm.start.notice.1':
    'Manual 모드는 SuperLiora가 명령 실행·파일 편집 등 위험 작업 전에 확인합니다.',
  'tui.swarm.start.notice.2': 'Manual 모드는 에이전트 실행 중 스웜 작업을 막을 수 있습니다.',
  'tui.swarm.start.notice.3': '명령을 잃지 않고 돌아갈 수 있습니다.',
  'tui.ultrawork.start.title': 'Ultrawork 인터뷰와 승인을 어떻게 진행할까요?',
  'tui.ultrawork.start.option.manual': 'Manual (기본)',
  'tui.ultrawork.start.option.manual.desc':
    '모든 AskUserQuestion에 직접 답하고 도구·편집·고위험 게이트를 승인합니다. Ultrawork 인터뷰를 완전히 제어하고 싶을 때 최적입니다.',
  'tui.ultrawork.start.option.auto': 'Auto',
  'tui.ultrawork.start.option.auto.desc':
    'AskUserQuestion 자동 응답 + 도구 자동 승인. 인터뷰 질문은 Manual과 같고 응답자만 다릅니다.',
  'tui.ultrawork.start.option.yolo': 'YOLO',
  'tui.ultrawork.start.option.yolo.desc':
    'AskUserQuestion과 대부분 도구를 자동 처리합니다. 삭제/파괴적 작업·자격증명/시크릿은 사람이 게이트합니다.',
  'tui.ultrawork.start.notice.1':
    'Ultrawork 인터뷰와 고위험 게이트에 누가 답할지 선택하세요.',
  'tui.ultrawork.start.notice.2':
    '인터뷰 스크립트는 모든 모드에서 동일합니다 — 응답자와 도구 승인만 바뀝니다.',
  'tui.ultrawork.start.notice.3': '이 선택은 기억되지 않으며, 새 Ultrawork 시작마다 Manual이 기본 선택됩니다.',

  // ── Device code / OAuth box ──────────────────────────────────────────────
  'tui.device.visitUrl': '아래 URL을 브라우저에서 열어 인증하세요:',
  'tui.device.codeLabel': '인증 코드:  ',

  // ── Help ─────────────────────────────────────────────────────────────────
  'tui.help.intro.default':
    'Shift-Tab으로 Ultrawork 켜기/끄기.\n/status로 media, web/Context7, ZDR, LioraBench 준비 상태 확인.\n일반 메시지는 Ultrawork가 꺼져 있으면 가볍게 유지됩니다.',
  'tui.help.intro.advanced':
    'Ultrawork는 하나의 워크플로: UltraPlan, UltraGoal, Research, Swarm 결정, Integrate, Verify, Learn.\nShift-Tab으로 Ultrawork 켜기/끄기; /plan과 Ctrl-Shift-Tab은 아래 명시적 조향 컨트롤.\n/status로 media, web/Context7, ZDR, LioraBench 준비 상태 확인.',
  'tui.help.shortcut.shiftTab': 'Ultrawork 켜기/끄기',
  'tui.help.shortcut.ctrlG': '외부 에디터에서 편집 ($VISUAL / $EDITOR)',
  'tui.help.shortcut.ctrlO': '도구 출력 확장 토글 (최근 턴)',
  'tui.help.shortcut.ctrlB': '긴 셸 작업을 백그라운드로 · /tasks',
  'tui.help.shortcut.ctrlT': '할 일 목록 펼치기/접기 (잘린 경우)',
  'tui.help.shortcut.ctrlS': '스티어 — 스트리밍 중 후속 지시 주입',
  'tui.help.shortcut.ctrlX': '프롬프트 초안 보관 또는 복원',
  'tui.help.shortcut.newline': '줄바꿈 삽입',
  'tui.help.shortcut.ctrlC': '스트림 중단 / 입력 지우기',
  'tui.help.shortcut.ctrlD': '종료 (입력이 비어 있을 때)',
  'tui.help.shortcut.esc': '대화상자 닫기 / 스트리밍 중단',
  'tui.help.shortcut.escEsc': '실행 취소 선택기 열기 (유휴 프롬프트)',
  'tui.help.shortcut.history': '입력 히스토리 탐색',
  'tui.help.shortcut.enter': '제출',
  'tui.help.shortcut.ctrlShiftTab': 'UltraPlan 조향',

  // ── Provider / login flows ───────────────────────────────────────────────
  'tui.provider.catalogLoading': '프로바이더 카탈로그 로드 중',
  'tui.provider.catalogLoaded': '카탈로그 로드됨.',
  'tui.provider.catalogAborted': '중단됨.',
  'tui.provider.catalogFailed': '카탈로그 로드 실패.',
  'tui.provider.catalogFailedDetail': '프로바이더 카탈로그 로드 실패: {message}',
  'tui.provider.notInCatalog': '프로바이더 "{provider}"이(가) 카탈로그에 없습니다.',
  'tui.provider.noModels': '프로바이더 "{provider}"에 사용 가능한 모델이 없습니다.',
  'tui.provider.unsupportedWire': '프로바이더 "{provider}"은(는) 지원하지 않는 통신 방식입니다.',
  'tui.provider.added': '프로바이더 추가됨: {name}',
  'tui.provider.mediaHint':
    '팁: OPENAI_API_KEY / GOOGLE_API_KEY로 이미지·영상 · /status로 미디어/웹 준비 상태 확인',
  'tui.provider.apiKeyPrompt': '{name}의 API 키를 입력하세요',
  'tui.provider.openingBrowser': '인증을 위해 브라우저를 여는 중…\n열리지 않으면 방문하세요:\n{url}',
  'tui.provider.waitingAuthorization': '인증 완료를 기다리는 중…',
  'tui.provider.pasteCallbackTitle': 'OAuth 콜백 붙여넣기',
  'tui.provider.pasteCallbackHint1': '브라우저가 자동으로 돌아오지 않으면 로그인 후 표시된',
  'tui.provider.pasteCallbackHint2': '콜백 URL 또는 인증 코드를 붙여넣으세요.',
  'tui.provider.authorizing': '{name}(으)로 인증 중',
  'tui.provider.connected': '연결됨: {name}',
  'tui.provider.alreadyLoggedIn': '이미 로그인되어 있습니다. 모델 설정을 새로고침했습니다.',
  'tui.provider.addAccountTitle': '관리 SuperLiora 계정',
  'tui.provider.addAccountProviderTitle': '{name} 계정',
  'tui.provider.addAccountRefresh': '현재 계정 새로고침',
  'tui.provider.addAccountRefreshDesc':
    '현재 primary 계정을 다시 인증하고 모델을 새로고침합니다.',
  'tui.provider.addAccountAdd': '다른 계정 추가',
  'tui.provider.addAccountAddDesc':
    '쿼타/레이트리밋 자동 폴백을 위해 다른 계정으로 로그인합니다.',
  'tui.provider.accountAdded':
    'OAuth 계정을 추가했습니다(슬롯 {fingerprint}). 쿼타 실패 시 계정 풀에서 자동 전환됩니다.',
  'tui.provider.loggedOut': '로그아웃됨.',
  'tui.provider.defaultModelSet': '기본 모델이 {model}(으)로 설정됨 (사고 {state}).',
  'tui.provider.customEndpointAdded': '커스텀 엔드포인트 추가됨: {model}',
  'tui.provider.registryNoProviders': '레지스트리에 프로바이더가 없습니다.',
  'tui.provider.registryImported': '레지스트리에서 {count}개 프로바이더를 가져왔습니다.',
  'tui.provider.registryImportedOne': '레지스트리에서 1개 프로바이더를 가져왔습니다.',
  'tui.provider.customEndpointFailed': '커스텀 엔드포인트 추가 실패: {message}',
  'tui.provider.registryFetchFailed': '레지스트리 가져오기 실패: {message}',
  'tui.provider.registryApplyFailed': '레지스트리 적용 실패: {message}',
  'tui.provider.setModelFailed': '기본 모델 설정 실패: {message}',
  'tui.provider.loginFailed': '로그인 실패: {message}',
  'tui.provider.loginFailedLabel': '로그인 실패.',
  'tui.provider.loginCancelled': '로그인 취소됨.',
  'tui.provider.refreshFailed': '인증 성공, 하지만 설정 새로고침 실패: {message}',

  // ── Sessions ─────────────────────────────────────────────────────────────
  'tui.sessions.fetchFailed': '세션 로드 실패. 서버 연결을 확인하세요.',
  'tui.sessions.noActive': '활성 세션이 없습니다.',

  // ── Shell command ────────────────────────────────────────────────────────
  'tui.shell.running': '실행 중: {command}',

  // ── Status / errors ──────────────────────────────────────────────────────
  'tui.status.noEditor':
    '에디터가 설정되지 않았습니다. $VISUAL / $EDITOR를 설정하거나 /editor <명령>을 실행하세요.',
  'tui.status.compactCancelFailed': '압축 취소 실패: {message}',
  'tui.status.externalEditorFailed': '외부 에디터 실패: {message}',
  'tui.status.startupFailed': '시작 세션을 초기화하지 못했습니다.',

  // ── Tips ─────────────────────────────────────────────────────────────────
  'tui.tip.ctrlS': 'ctrl-s로 턴이 끝나기 전에 추가 지시를 넣을 수 있습니다',
  'tui.tip.tasks': '/tasks로 백그라운드 작업 진행을 확인하세요',
  'tui.tip.init': '/init: AGENTS.md 생성',
  'tui.tip.pluginsSuperpowers': '/plugins: 플러그인 관리 — "superpowers" 플러그인을 써 보세요',
  'tui.tip.pluginsDatasource':
    '/plugins: 플러그인 관리 — 금융·경제·학술 데이터용 "Liora Datasource"를 써 보세요',
  'tui.tip.schedule': 'Liora에게 스케줄을 맡기세요, 예: "오후 5시에 알려줘"',
  'tui.tip.sessions': '/sessions로 이전 세션을 찾아 이어가세요',
  'tui.tip.outcome': '원하는 결과를 설명하면 Liora가 작업을 정리합니다',
  'tui.tip.goalNext': '/goal next로 현재 목표를 유지한 채 후속 작업을 대기열에 넣습니다',
  'tui.tip.shiftTab': 'shift-tab으로 Ultrawork 켜기/끄기',
  'tui.tip.mention': '@: 파일 멘션',
  'tui.tip.shell': '!: 셸 명령 실행',
  'tui.tip.ctrlO': 'ctrl-o로 깔끔한 채팅 ↔ 전체 도구 기록 전환',
  'tui.tip.ctrlB': 'ctrl-b로 긴 셸 작업을 백그라운드; /tasks로 진행 확인',
  'tui.tip.shiftEnter': 'shift+enter: 줄바꿈',
  'tui.tip.ctrlC': 'ctrl+c: 취소',
  'tui.tip.theme': '/theme으로 터미널 UI 테마 전환',
  'tui.tip.aquarium': '/aquarium은 Welcome 크기 Jewel Tank 오버레이 — 메시지 보내면 복귀',
  'tui.tip.auto': '/auto로 승인을 맡기고 무인 진행',
  'tui.tip.yolo': '/yolo는 신뢰하는 저장소에서 대부분 승인을 건너뜁니다',
  'tui.tip.help': '/help: 명령 목록',
  'tui.tip.compact': '/compact로 길어지면 컨텍스트 압축',
  'tui.tip.status': '/status: context · ZDR · web/Context7 · media · office · LioraBench',
  'tui.tip.context': '/context: 메모리 연속성 + 프라이버시 (ZDR)',
  'tui.tip.mediaKeys': 'media: OPENAI/GOOGLE 키 → GenerateImage/Video — MCP 불필요',
  'tui.tip.research': 'research: Context7 + WebSearch/FetchURL — MCP 불필요',
  'tui.tip.office':
    'office: SearchSkill → docx / pptx / xlsx — Word, 슬라이드, 시트, MCP 설정 없음',
  'tui.tip.websearch': 'WebSearch 기본 3건 — limit 올리기 전에 쿼리를 날카롭게',
  'tui.tip.bench': '/bench: LioraBench 점수 · 루프 · 다음 재실행',
  'tui.tip.browser': 'browser/computer 도구는 스크린샷 증명용 내장 — MCP 불필요',
  'tui.tip.firstRun': '첫 실행: /login 후 작업 입력 — 복잡한 설정 불필요',
  'tui.tip.footerBadges':
    'footer 배지는 높은 컨텍스트나 압축 후 누락된 증거에 경고합니다',
  'tui.tip.contextLadder':
    'context ladder: micro40 · async55 · soft70 · hard90 · recompact5 · reserved16k · maxRecent12 · abs floor 없음',
  'tui.tip.toolTrim':
    '도구 출력은 4000자 자동 트림, 80자 미리보기 — 여전히 높으면 /compact',
  'tui.tip.reasoningGlance':
    '실시간 reasoning은 4줄 tail glance — ctrl+o로 전체 확장',
  'tui.tip.contextBar':
    'footer context bar는 10칸 + 1/8 부분 채움 — 더 조밀한 압력 표시',
  'tui.tip.particleRails':
    '프리미엄 레일은 부드러운 혜성 + 조용한 별먼지 — 마퀴 thrash 없음',
  'tui.tip.toolDescs':
    '도구 설명은 조밀하게 — shell rg 대신 Grep; Read는 다중 파일 병렬',
  'tui.tip.autoDream':
    '/status Memory는 auto-dream on/×N (기본 on, ≥4h/8 records) — 장기 회상 위생',
  'tui.tip.microBadges': 'footer μ 배지는 설정 없이 micro clear(cache-miss/swarm)를 표시',
  'tui.tip.mediaZeroConfig':
    'media: OPENAI/GOOGLE 키가 있으면 GenerateImage/Video 제로컨피그',
  'tui.tip.mediaFooter':
    'media: OPENAI/GOOGLE 키가 GenerateImage/Video를 준비할 때만 footer img/vid 배지',
  'tui.tip.backgroundAgent':
    'background Agent는 독립 작업에만 — bg 실행 후 TaskOutput-wait 금지',
  'tui.tip.shiftTabOff': 'shift-tab을 다시 누르면 Ultrawork가 꺼집니다',
  'tui.tip.model': '/model: 모델 전환',
  'tui.tip.loginMedia':
    '/login으로 프로바이더 연결; 이미지/영상은 OPENAI_API_KEY 또는 GOOGLE_API_KEY',
  'tui.tip.glances': 'TUI glance: thinking 4 · command 4 · result 3 (densify 1/1/2 아님)',
  'tui.tip.recall':
    'Liora Recall은 메모리 ≤6개 · 각 480자; Bash soft-cap 4k; LioraExpand 120줄 페이지',

  // ── Appearance settings ─────────────────────────────────────────────────
  'tui.appearance.timestamps': '타임스탬프',
};
