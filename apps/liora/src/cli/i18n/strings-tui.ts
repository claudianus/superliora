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

import { STRINGS_TUI_APPROVAL_EN, STRINGS_TUI_APPROVAL_KO } from './strings-tui-approval';
import { STRINGS_TUI_HANDLERS_EN, STRINGS_TUI_HANDLERS_KO } from './strings-tui-handlers';
import { STRINGS_TUI_HUB_EN, STRINGS_TUI_HUB_KO } from './strings-tui-hub';
import { STRINGS_TUI_NOTICES_EN, STRINGS_TUI_NOTICES_KO } from './strings-tui-notices';
import { STRINGS_TUI_UI_EN, STRINGS_TUI_UI_KO } from './strings-tui-ui';
import { STRINGS_TUI_REMAINDER_EN, STRINGS_TUI_REMAINDER_KO } from './strings-tui-remainder';

export const STRINGS_TUI_EN: Readonly<Record<string, string>> = {
  ...STRINGS_TUI_HUB_EN,
  ...STRINGS_TUI_HANDLERS_EN,
  ...STRINGS_TUI_NOTICES_EN,
  ...STRINGS_TUI_APPROVAL_EN,
  ...STRINGS_TUI_UI_EN,
  ...STRINGS_TUI_REMAINDER_EN,
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

  // ── Transcript search (Ctrl-F) ───────────────────────────────────────────
  'tui.search.title': 'Search transcript',
  'tui.search.hint': 'Enter next · Shift-Enter prev · Esc close',
  'tui.search.matches': '{count} matches',
  'tui.search.noMatches': 'No matches',
  'tui.search.placeholder': 'Type to search the conversation',

  // ── Retry last failed turn (Hub → Chat / /retry) ─────────────────────────
  'tui.retry.hint': 'Use Hub → Chat → Retry (or /retry) to resend your last message',
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
    'Type a task · /status web·office·media·ZDR · Shift-Tab Ask',
  'tui.welcome.prompt.loggedOut':
    'Run /login or paste an API key — media/web/office ready after that, no MCP.',
  'tui.welcome.modelUnset': 'not set, run /login',
  'tui.welcome.label.directory': 'Directory: ',
  'tui.welcome.label.session': 'Session:   ',
  'tui.welcome.label.model': 'Model:     ',
  'tui.welcome.label.version': 'Version:   ',
  'tui.welcome.label.mcp': 'MCP:       ',
  'tui.welcome.modelPrefix': 'Model: ',
  'tui.welcome.conductorCoach.line1': 'Describe a task — Conductor takes intake only',
  'tui.welcome.conductorCoach.line2': 'Jobs run workers in the background',
  'tui.welcome.conductorCoach.line3': 'Alt+J watches the Job Deck',

  // ── Empty-transcript idle stage ──────────────────────────────────────────
  'tui.idle.title': 'aquarium',
  'tui.idle.tipPrefix': 'tip · ',
  'tui.idle.mood.bubbles': 'idle',
  'tui.idle.mood.swim': 'listening',
  'tui.idle.mood.ready': 'ready',
  'tui.idle.mood.tank': 'waiting',
  'tui.idle.mood.quiet': 'idle',

  // ── Footer hints / next-actions ──────────────────────────────────────────
  'tui.footer.next.login': 'next: /login to add a provider, then /model',
  'tui.footer.next.compact': 'next: /compact before long work',
  'tui.footer.next.review': 'next: review changes',
  'tui.footer.next.media': 'next: set OPENAI_API_KEY or GOOGLE_API_KEY for image/video, or /status',
  'tui.footer.next.history': 'next: ctrl-o cycles transcript density (minimal→full)',
  'tui.footer.next.default': 'next: Shift-Tab switches Build/Ask · /plan to plan first',
  'tui.footer.compacting': 'compacting context',
  'tui.footer.compacting.background': 'compacting in background · turn continues',
  'tui.footer.replaying': 'replaying session',
  'tui.sessionLoading.title': 'Opening session',
  'tui.sessionLoading.phase.opening': 'Preparing session…',
  'tui.sessionLoading.phase.loading': 'Loading session from disk…',
  'tui.sessionLoading.phase.building': 'Building transcript…',
  'tui.sessionLoading.phase.finishing': 'Almost ready…',
  'tui.sessionLoading.phase.ready': 'Ready',
  'tui.sessionLoading.phase.working': 'Working…',
  'tui.sessionLoading.session': 'Session {id}',
  'tui.sessionLoading.elapsed': '{seconds}s elapsed',
  'tui.sessionLoading.hint': 'Restoring recent turns. Large histories can take a moment.',
  'tui.sessionLoading.locked': 'Input locked — wait for history to finish loading',
  'tui.sessionLoading.busy': 'Session history is still loading. Wait for it to finish.',
  'tui.sessionLoading.inputHeld':
    'Session still loading — your input is held in the editor. Press Enter again once it finishes.',
  'tui.sessionLoading.progress': 'History {current}/{total}',
  'tui.sessionLoading.forking': 'Forking session…',
  'tui.sessionLoading.creating': 'Starting a new session…',
  'tui.sessionLoading.scanning': 'Scanning project…',
  'tui.sessionLoading.diffing': 'Reading git diff…',
  'tui.sessionLoading.searching': 'Searching project…',
  'tui.sessionLoading.extensions': 'Loading extensions…',
  'tui.sessionLoading.exporting': 'Exporting session…',
  'tui.footer.premium': 'Visual Quality ON — motion/density, anti-slop, screenshot proof',
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

  // ── Premium ────────────────────────────────────────────────────
  'tui.premium.alreadyOn': 'Visual Quality mode is already on',
  'tui.premium.alreadyOff': 'Visual Quality mode is already off',
  'tui.premium.on.title': 'Visual Quality mode: ON',
  'tui.premium.off.title': 'Visual Quality mode: OFF',
  'tui.premium.on.detail':
    'Visual Quality active — art direction, anti-slop visuals, skill routing, screenshot proof.',
  'tui.premium.on.detail.apply':
    'Visual Quality active — art direction, skill routing, rubric, screenshot verification.',
  'tui.premium.usage': 'Usage: /premium [on|off|status]',
  'tui.premium.setFailed': 'Failed to set Visual Quality mode: {message}',
  'tui.premium.enableFailed': 'Failed to enable Visual Quality mode: {message}',
  'tui.aquarium.restored':
    'Jewel Tank overlay on — click to feed; send a message to return to your chat.',
  'tui.aquarium.replaying': 'Cannot show the aquarium while session history is replaying.',
  'tui.feed.noTank': 'No Jewel Tank is visible — open /aquarium or wait for the idle tank.',
  'tui.feed.full': 'The tank is full of food already.',
  'tui.feed.dropped': 'Food dropped — watch the fish go.',
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
  'tui.device.visitUrl': 'Visit the URL below in your browser to authorize:',
  'tui.device.codeLabel': 'Verification code:  ',

  // ── Help ─────────────────────────────────────────────────────────────────
  'tui.help.intro.default':
    'Shift-Tab switches between Build and Ask mode.\nAsk mode reads, searches, and looks things up without editing or delegating.\n/status shows media, web/Context7, ZDR, and office readiness.',
  'tui.help.intro.advanced':
    'Build runs the work; Ask investigates it first. Shift-Tab or /ask switches.\n/plan writes a plan file, /goal runs an objective, /jobs tracks delegated work.\n/status shows media, web/Context7, ZDR, and office readiness.',
  'tui.help.shortcut.hub': 'Open the Command Hub menu',
  'tui.help.shortcut.hubQuestion': 'Open Command Hub (empty prompt)',
  'tui.help.shortcut.shiftTab': 'Switch Build / Ask mode',
  'tui.help.shortcut.ctrlG': 'Open the external editor',
  'tui.help.shortcut.ctrlO': 'Cycle transcript density (minimal → compact → standard → full)',
  'tui.help.shortcut.ctrlB': 'Background the current work',
  'tui.help.shortcut.ctrlT': 'Expand or collapse the todo list',
  'tui.help.shortcut.ctrlS': 'Steer while a turn is running',
  'tui.help.shortcut.ctrlX': 'Stash or restore the draft prompt',
  'tui.help.shortcut.newline': 'Insert a newline (Ctrl-J also works)',
  'tui.help.shortcut.ctrlC': 'Stop the current turn (or confirm exit when idle)',
  'tui.help.shortcut.ctrlD': 'Exit (on empty input)',
  'tui.help.shortcut.esc': 'Cancel or close; press twice for session undo',
  'tui.help.shortcut.escEsc': 'Open undo selector (idle prompt)',
  'tui.help.shortcut.history': 'Search input history (empty prompt)',
  'tui.help.shortcut.transcriptSearch': 'Search the transcript',
  'tui.help.shortcut.enter': 'Send the prompt',
  'tui.help.shortcut.jobDeck': 'Open the Conductor Job Deck monitor',
  'tui.help.shortcut.jobInbox': 'Open the Conductor Job Inbox drawer',
  'tui.help.shortcut.intentComposer': 'Edit Conductor Intent brief slots',
  'tui.help.shortcut.ctrlShiftTab': 'Steer Plan',
  'tui.help.section.shortcuts': 'Keyboard shortcuts',
  'tui.help.section.slash': 'Slash commands',
  'tui.help.footer': 'Esc / Enter / Q cancel · ↑↓ scroll',

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
  'tui.provider.xaiRouteTitle': 'xAI Grok billing route',
  'tui.provider.xaiRouteBuild': 'Grok Build (subscription)',
  'tui.provider.xaiRouteBuildDesc':
    'cli-chat-proxy — same quota as the official grok CLI.',
  'tui.provider.xaiRouteApi': 'Grok API (credits)',
  'tui.provider.xaiRouteApiDesc': 'api.x.ai — prepaid / API usage metering.',
  'tui.provider.xaiRouteSelected': 'xAI route: {route}',
  'tui.provider.xaiRouteSwitchTitle': 'Switch xAI Grok route',
  'tui.provider.xaiRouteSwitchDesc':
    'Toggle Build subscription vs API credits without signing in again.',
  'tui.provider.xaiRouteNotConfigured': 'Connect xAI Grok first (/login → xAI Grok).',

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
  'tui.status.llmNotSet':
    'Model not set. Run /login to add a provider, then /model to pick one.',
  'tui.status.noActiveSession': 'No active session. Send /login to login.',
  'tui.status.oauthLoginRequired': 'OAuth login expired. Send /login to login.',

  // ── Language / locale ────────────────────────────────────────────────────
  'tui.locale.title': 'Language',
  'tui.locale.hint': '↑↓ navigate · Enter select · Esc cancel',
  'tui.locale.usage': 'Usage: /locale [auto|en|ko]',
  'tui.locale.unchanged': 'Language already set to {value}.',
  'tui.locale.applied': 'Language set to {value}.',
  'tui.locale.saveFailed': 'Failed to save language: {message}',
  'tui.locale.option.auto': 'Auto',
  'tui.locale.option.autoDesc': 'Follow SUPERLIORA_LOCALE / LANG (Korean when ko*).',
  'tui.locale.option.en': 'English',
  'tui.locale.option.enDesc': 'Always use English UI copy.',
  'tui.locale.option.ko': '한국어',
  'tui.locale.option.koDesc': 'Always use Korean UI copy.',

  // ── ChoicePicker default chrome ──────────────────────────────────────────
  'tui.common.hint.list': '↑↓ navigate · Enter select · wheel scroll · click select · Esc cancel',
  'tui.common.hint.grid':
    '↑↓←→ navigate · Enter select · wheel scroll · click select · Esc cancel',
  'tui.common.hint.page': 'PgUp/PgDn page',
  'tui.common.searchLabel': 'Search: ',

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
  'tui.tip.shiftTab': 'shift-tab switches between Build and Ask mode',
  'tui.tip.mention': '@: mention files',
  'tui.tip.shell': '! to run a shell command',
  'tui.tip.ctrlO': 'Ctrl+O cycles transcript density: minimal → compact → standard → full',
  'tui.tip.ctrlB': 'ctrl-b backgrounds a long shell task; /tasks shows progress',
  'tui.tip.conductorJobs': '/jobs lists Conductor jobs · /jobs deck watches workers',
  'tui.tip.altJ': 'Alt+J opens the Conductor Job Deck',
  'tui.tip.shiftEnter': 'shift+enter: newline',
  'tui.tip.ctrlC': 'ctrl+c: cancel',
  'tui.tip.theme': '/theme to switch the terminal UI theme',
  'tui.tip.aquarium': '/aquarium overlays a Welcome-sized Jewel Tank; send a message to leave',
  'tui.tip.feed': '/feed drops food into the visible Jewel Tank (or click it)',
  'tui.tip.auto': '/auto lets Liora handle approvals and keep going unattended',
  'tui.tip.yolo': '/yolo skips most approvals for trusted batch work — only in repos you trust',
  'tui.tip.menuHub': 'Menu ?: Command Hub (empty prompt) — Space toggles modes',
  'tui.tip.ctrlK': 'Ctrl-K: open Command Hub — modes, model, sessions',
  'tui.tip.help': 'Ctrl-K or ?: Command Hub (slash commands still work)',
  'tui.tip.compact': '/compact compresses context when it gets long',
  'tui.tip.status': '/status: context · ZDR · web/Context7 · media · office',
  'tui.tip.context': '/context: memory continuity + privacy (ZDR)',
  'tui.tip.mediaKeys': 'media: OPENAI/GOOGLE key → GenerateImage/Video — no MCP',
  'tui.tip.research': 'research: Context7 + WebSearch/FetchURL — no MCP',
  'tui.tip.office':
    'office: SearchSkill → docx / pptx / xlsx — Word, slides, sheets with zero MCP setup',
  'tui.tip.websearch': 'WebSearch defaults to 3 hits — sharpen the query before raising limit',
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
    '/status Memory shows reflection on/×N (default on, ≥4h/8 candidates) — long-horizon memory hygiene',
  'tui.tip.microBadges': 'footer μ badges show micro clears (cache-miss/swarm) without config',
  'tui.tip.mediaZeroConfig':
    'media: GenerateImage/Video zero-config when OPENAI/GOOGLE keys are present',
  'tui.tip.mediaFooter':
    'media: footer img/vid badges appear only when OPENAI/GOOGLE keys make GenerateImage/Video ready',
  'tui.tip.backgroundAgent':
    'background Agent only for independent work — never TaskOutput-wait after bg launch',
  'tui.tip.shiftTabOff': 'Ask mode investigates only — shift-tab again to build',
  'tui.tip.model': '/model: switch model',
  'tui.tip.loginMedia':
    '/login connects providers; OPENAI_API_KEY or GOOGLE_API_KEY for image/video',
  'tui.tip.glances': 'TUI glances: thinking 4 · command 4 · result 3 (not densify 1/1/2)',
  'tui.tip.recall':
    'Liora Memory injects ≤6 memories · 480 chars each; Bash soft-caps 4k; Expand pages 120 lines',


  // ── Appearance settings ─────────────────────────────────────────────────
  'tui.appearance.timestamps': 'Timestamps',
};

/**
 * Korean TUI strings. Keys absent here fall back to English inside `t()`.
 */
export const STRINGS_TUI_KO: Readonly<Record<string, string>> = {
  ...STRINGS_TUI_HUB_KO,
  ...STRINGS_TUI_HANDLERS_KO,
  ...STRINGS_TUI_NOTICES_KO,
  ...STRINGS_TUI_APPROVAL_KO,
  ...STRINGS_TUI_UI_KO,
  ...STRINGS_TUI_REMAINDER_KO,
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

  // ── Transcript search (Ctrl-F) ───────────────────────────────────────────
  'tui.search.title': '대화 검색',
  'tui.search.hint': 'Enter 다음 · Shift-Enter 이전 · Esc 닫기',
  'tui.search.matches': '{count}개 일치',
  'tui.search.noMatches': '일치 항목 없음',
  'tui.search.placeholder': '대화 내용을 검색하려면 입력',

  // ── Retry last failed turn (Hub → Chat / /retry) ─────────────────────────
  'tui.retry.hint': 'Hub → Chat → Retry(또는 /retry)로 마지막 메시지를 다시 보내세요',
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
    '작업을 입력하세요 · /status web·office·media·ZDR · Shift-Tab Ask',
  'tui.welcome.prompt.loggedOut':
    '/login 또는 API 키를 붙여넣으세요 — 이후 media/web/office 사용 가능, MCP 불필요.',
  'tui.welcome.modelUnset': '미설정, /login 실행',
  'tui.welcome.label.directory': '디렉터리: ',
  'tui.welcome.label.session': '세션:     ',
  'tui.welcome.label.model': '모델:     ',
  'tui.welcome.label.version': '버전:     ',
  'tui.welcome.label.mcp': 'MCP:      ',
  'tui.welcome.modelPrefix': '모델: ',
  'tui.welcome.conductorCoach.line1': '작업만 적으면 됩니다 — Conductor가 접수합니다',
  'tui.welcome.conductorCoach.line2': 'Job이 백그라운드에서 워커를 실행합니다',
  'tui.welcome.conductorCoach.line3': 'Alt+J로 Job Deck를 감시합니다',

  // ── Empty-transcript idle stage ──────────────────────────────────────────
  'tui.idle.title': 'aquarium',
  'tui.idle.tipPrefix': '팁 · ',
  'tui.idle.mood.bubbles': 'idle',
  'tui.idle.mood.swim': 'listening',
  'tui.idle.mood.ready': 'ready',
  'tui.idle.mood.tank': 'waiting',
  'tui.idle.mood.quiet': 'idle',

  // ── Footer hints / next-actions ──────────────────────────────────────────
  'tui.footer.next.login': '다음: /login으로 프로바이더 추가, 그리고 /model',
  'tui.footer.next.compact': '다음: 긴 작업 전 /compact',
  'tui.footer.next.review': '다음: 변경사항 검토',
  'tui.footer.next.media': '다음: OPENAI_API_KEY 또는 GOOGLE_API_KEY로 이미지/영상, 또는 /status',
  'tui.footer.next.history': '다음: ctrl-o로 트랜스크립트 밀도 순환 (minimal→full)',
  'tui.footer.next.default': '다음: Shift-Tab로 Build/Ask 전환 · /plan으로 먼저 계획',
  'tui.footer.compacting': '컨텍스트 압축 중',
  'tui.footer.compacting.background': '백그라운드 압축 중 · 턴 계속 진행',
  'tui.footer.replaying': '세션 재생 중',
  'tui.sessionLoading.title': '세션 여는 중',
  'tui.sessionLoading.phase.opening': '세션 준비 중…',
  'tui.sessionLoading.phase.loading': '디스크에서 세션 불러오는 중…',
  'tui.sessionLoading.phase.building': '대화 기록 그리는 중…',
  'tui.sessionLoading.phase.finishing': '거의 완료…',
  'tui.sessionLoading.phase.ready': '준비됨',
  'tui.sessionLoading.phase.working': '작업 중…',
  'tui.sessionLoading.session': '세션 {id}',
  'tui.sessionLoading.elapsed': '{seconds}초 경과',
  'tui.sessionLoading.hint': '최근 턴을 복원합니다. 큰 기록은 잠시 걸릴 수 있습니다.',
  'tui.sessionLoading.locked': '입력 잠금 — 기록 로딩이 끝날 때까지 기다려 주세요',
  'tui.sessionLoading.busy': '세션 기록을 아직 불러오는 중입니다. 끝날 때까지 기다려 주세요.',
  'tui.sessionLoading.inputHeld':
    '세션을 불러오는 중입니다 — 입력은 에디터에 보존됩니다. 로딩이 끝나면 Enter로 다시 전송하세요.',
  'tui.sessionLoading.progress': '기록 {current}/{total}',
  'tui.sessionLoading.forking': '세션 포크 중…',
  'tui.sessionLoading.creating': '새 세션 시작 중…',
  'tui.sessionLoading.scanning': '프로젝트 스캔 중…',
  'tui.sessionLoading.diffing': 'git diff 읽는 중…',
  'tui.sessionLoading.searching': '프로젝트 검색 중…',
  'tui.sessionLoading.extensions': '확장 목록 불러오는 중…',
  'tui.sessionLoading.exporting': '세션 내보내는 중…',
  'tui.footer.premium': '시각 품질 ON — 모션/밀도, 안티 슬롭, 스크린샷 증명',
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
  'tui.permission.auto.on.detail': '도구 자동 승인. 구조화 질문은 자동 응답.',
  'tui.permission.auto.off.title': 'Auto 모드: OFF',
  'tui.permission.auto.alreadyOn': 'Auto 모드가 이미 켜져 있습니다',
  'tui.permission.auto.alreadyOff': 'Auto 모드가 이미 꺼져 있습니다',
  'tui.permission.mode.set': '권한 모드: {mode}',
  'tui.permission.mode.unchanged': '권한 모드 변경 없음: {mode}.',
  'tui.permission.selector.title': '권한 모드 선택',
  'tui.permission.manual.label': "수동",
  'tui.permission.manual.desc':
    '명령·편집·위험 작업 전에 묻습니다. 읽기/검색 도구는 바로 실행되며 세션 승인 규칙을 따릅니다.',
  'tui.permission.auto.label': "자동",
  'tui.permission.auto.desc':
    '완전 비대화형. 도구 승인·구조화 질문 응답을 자동으로 처리해 스스로 진행합니다.',
  'tui.permission.yolo.label': 'YOLO',
  'tui.permission.yolo.desc':
    '대부분 도구와 플랜 전환을 자동 승인. 구조화 질문은 자동 응답; 삭제/파괴적 작업·자격증명/시크릿은 여전히 묻습니다.',
  'tui.permission.replay.yoloOn.detail': '모든 작업이 자동 승인됩니다. 주의해서 사용하세요.',
  'tui.permission.setFailed': '권한 모드 설정 실패: {message}',

  // ── Premium ────────────────────────────────────────────────────
  'tui.premium.alreadyOn': '시각 품질 모드가 이미 켜져 있습니다',
  'tui.premium.alreadyOff': '시각 품질 모드가 이미 꺼져 있습니다',
  'tui.premium.on.title': '시각 품질 모드: ON',
  'tui.premium.off.title': '시각 품질 모드: OFF',
  'tui.premium.on.detail':
    '시각 품질 모드 활성 — 아트 디렉션, 안티 슬롭, 스킬 라우팅, 스크린샷 증명.',
  'tui.premium.on.detail.apply':
    '시각 품질 모드 활성 — 아트 디렉션, 스킬 라우팅, 루브릭, 스크린샷 검증.',
  'tui.premium.usage': '사용법: /premium [on|off|status]',
  'tui.premium.setFailed': '시각 품질 모드 설정 실패: {message}',
  'tui.premium.enableFailed': '시각 품질 모드 활성화 실패: {message}',
  'tui.aquarium.restored':
    'Jewel Tank 오버레이 — 클릭으로 밥 주기, 메시지를 보내면 채팅으로 돌아갑니다.',
  'tui.aquarium.replaying': '세션 기록 재생 중에는 어항을 표시할 수 없습니다.',
  'tui.feed.noTank': '보이는 Jewel Tank가 없습니다 — /aquarium을 열거나 대기 화면을 기다리세요.',
  'tui.feed.full': '이미 먹이가 가득합니다.',
  'tui.feed.dropped': '먹이를 넣었습니다 — 물고기를 지켜보세요.',
  'tui.goal.start.title.manual': '승인 확인을 켠 채로 목표를 시작할까요?',
  'tui.goal.start.title.yolo': 'YOLO 모드로 목표를 시작할까요?',
  'tui.goal.start.option.auto': 'Auto로 전환하고 시작',
  'tui.goal.start.option.auto.desc':
    '자리를 비워도 SuperLiora가 계속 작업하길 원할 때 최적. 도구는 자동 승인, 구조화 질문은 자동 응답.',
  'tui.goal.start.option.yolo': 'YOLO로 전환하고 시작',
  'tui.goal.start.option.yolo.desc':
    '도구와 플랜 변경 자동 승인. 구조화 질문은 자동 응답; 삭제/파괴적 작업·자격증명/시크릿은 여전히 묻습니다.',
  'tui.goal.start.option.keepYolo': 'YOLO 유지하고 시작',
  'tui.goal.start.option.keepYolo.desc':
    '도구와 플랜 변경은 계속 자동 승인. 구조화 질문은 자동 응답; 삭제/파괴적 작업·자격증명/시크릿은 여전히 묻습니다.',
  'tui.goal.start.option.manual': 'Manual로 시작',
  'tui.goal.start.option.manual.desc':
    '승인 확인 유지. 위험한 작업 전에 물어보고, 목표는 멈춰서 기다립니다.',
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
  'tui.device.visitUrl': '아래 URL을 브라우저에서 열어 인증하세요:',
  'tui.device.codeLabel': '인증 코드:  ',

  // ── Help ─────────────────────────────────────────────────────────────────
  'tui.help.intro.default':
    'Shift-Tab으로 Build / Ask 모드 전환.\nAsk 모드는 편집·위임 없이 읽기·검색·조사만 합니다.\n/status로 media, web/Context7, ZDR, office 준비 상태 확인.',
  'tui.help.intro.advanced':
    'Build는 작업을 실행하고 Ask는 먼저 조사합니다. Shift-Tab 또는 /ask로 전환.\n/plan은 계획 파일, /goal은 목표 실행, /jobs는 위임된 작업 추적.\n/status로 media, web/Context7, ZDR, office 준비 상태 확인.',
  'tui.help.shortcut.hub': 'Command Hub 메뉴 열기',
  'tui.help.shortcut.hubQuestion': 'Command Hub 열기 (빈 프롬프트)',
  'tui.help.shortcut.shiftTab': 'Build / Ask 모드 전환',
  'tui.help.shortcut.ctrlG': '외부 에디터 열기',
  'tui.help.shortcut.ctrlO': '트랜스크립트 밀도 순환 (minimal → compact → standard → full)',
  'tui.help.shortcut.ctrlB': '현재 작업을 백그라운드로',
  'tui.help.shortcut.ctrlT': '할 일 목록 펼치기/접기',
  'tui.help.shortcut.ctrlS': '턴 실행 중 스티어',
  'tui.help.shortcut.ctrlX': '프롬프트 초안 보관 또는 복원',
  'tui.help.shortcut.newline': '줄바꿈 삽입 (Ctrl-J도 가능)',
  'tui.help.shortcut.ctrlC': '현재 턴 중단 (유휴 시 종료 확인)',
  'tui.help.shortcut.ctrlD': '종료 (입력이 비어 있을 때)',
  'tui.help.shortcut.esc': '취소/닫기 · 두 번 누르면 세션 실행 취소',
  'tui.help.shortcut.escEsc': '실행 취소 선택기 열기 (유휴 프롬프트)',
  'tui.help.shortcut.history': '입력 히스토리 검색 (빈 프롬프트)',
  'tui.help.shortcut.transcriptSearch': '트랜스크립트 검색',
  'tui.help.shortcut.enter': '프롬프트 전송',
  'tui.help.shortcut.jobDeck': 'Conductor Job Deck 모니터 열기',
  'tui.help.shortcut.jobInbox': 'Conductor Job Inbox 서랍 열기',
  'tui.help.shortcut.intentComposer': 'Conductor Intent brief 슬롯 편집',
  'tui.help.shortcut.ctrlShiftTab': 'Plan 조향',
  'tui.help.section.shortcuts': '키보드 단축키',
  'tui.help.section.slash': '슬래시 명령',
  'tui.help.footer': 'Esc / Enter / Q 취소 · ↑↓ 스크롤',

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
  'tui.provider.refreshFailed': '인증은 성공했으나 설정 새로고침 실패: {message}',
  'tui.provider.xaiRouteTitle': 'xAI Grok 과금 경로',
  'tui.provider.xaiRouteBuild': 'Grok Build (구독)',
  'tui.provider.xaiRouteBuildDesc':
    'cli-chat-proxy — 공식 grok CLI와 같은 구독 쿼터.',
  'tui.provider.xaiRouteApi': 'Grok API (크레딧)',
  'tui.provider.xaiRouteApiDesc': 'api.x.ai — prepaid / API 사용량 과금.',
  'tui.provider.xaiRouteSelected': 'xAI 경로: {route}',
  'tui.provider.xaiRouteSwitchTitle': 'xAI Grok 경로 전환',
  'tui.provider.xaiRouteSwitchDesc':
    '재로그인 없이 Build 구독과 API 크레딧을 전환합니다.',
  'tui.provider.xaiRouteNotConfigured': '먼저 xAI Grok을 연결하세요 (/login → xAI Grok).',

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
  'tui.status.llmNotSet':
    '모델이 설정되지 않았습니다. /login으로 프로바이더를 추가한 뒤 /model로 선택하세요.',
  'tui.status.noActiveSession': '활성 세션이 없습니다. /login으로 로그인하세요.',
  'tui.status.oauthLoginRequired': 'OAuth 로그인이 만료되었습니다. /login으로 다시 로그인하세요.',

  // ── Language / locale ────────────────────────────────────────────────────
  'tui.locale.title': '언어',
  'tui.locale.hint': '↑↓ 이동 · Enter 선택 · Esc 취소',
  'tui.locale.usage': '사용법: /locale [auto|en|ko]',
  'tui.locale.unchanged': '언어가 이미 {value}입니다.',
  'tui.locale.applied': '언어를 {value}(으)로 설정했습니다.',
  'tui.locale.saveFailed': '언어 저장 실패: {message}',
  'tui.locale.option.auto': '자동',
  'tui.locale.option.autoDesc': 'SUPERLIORA_LOCALE / LANG을 따릅니다 (ko*면 한국어).',
  'tui.locale.option.en': 'English',
  'tui.locale.option.enDesc': '항상 영어 UI를 사용합니다.',
  'tui.locale.option.ko': '한국어',
  'tui.locale.option.koDesc': '항상 한국어 UI를 사용합니다.',

  // ── ChoicePicker default chrome ──────────────────────────────────────────
  'tui.common.hint.list': '↑↓ 이동 · Enter 선택 · 휠 스크롤 · 클릭 선택 · Esc 취소',
  'tui.common.hint.grid':
    '↑↓←→ 이동 · Enter 선택 · 휠 스크롤 · 클릭 선택 · Esc 취소',
  'tui.common.hint.page': 'PgUp/PgDn 페이지',
  'tui.common.searchLabel': '검색: ',

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
  'tui.tip.shiftTab': 'shift-tab으로 Build / Ask 모드 전환',
  'tui.tip.mention': '@: 파일 멘션',
  'tui.tip.shell': '!: 셸 명령 실행',
  'tui.tip.ctrlO': 'Ctrl+O로 트랜스크립트 밀도 순환: minimal → compact → standard → full',
  'tui.tip.ctrlB': 'ctrl-b로 긴 셸 작업을 백그라운드; /tasks로 진행 확인',
  'tui.tip.conductorJobs': '/jobs로 Conductor Job 목록 · /jobs deck으로 워커 감시',
  'tui.tip.altJ': 'Alt+J로 Conductor Job Deck 열기',
  'tui.tip.shiftEnter': 'shift+enter: 줄바꿈',
  'tui.tip.ctrlC': 'ctrl+c: 취소',
  'tui.tip.theme': '/theme으로 터미널 UI 테마 전환',
  'tui.tip.aquarium': '/aquarium은 Welcome 크기 Jewel Tank 오버레이 — 메시지 보내면 복귀',
  'tui.tip.feed': '/feed로 보이는 Jewel Tank에 먹이 투하 (클릭도 가능)',
  'tui.tip.auto': '/auto로 승인을 맡기고 무인 진행',
  'tui.tip.yolo': '/yolo는 신뢰하는 저장소에서 대부분 승인을 건너뜁니다',
  'tui.tip.menuHub': 'Menu ?: Command Hub (빈 프롬프트) — Space로 모드 토글',
  'tui.tip.ctrlK': 'Ctrl-K: Command Hub — 모드, 모델, 세션',
  'tui.tip.help': 'Ctrl-K 또는 ?: Command Hub (슬래시도 그대로 동작)',
  'tui.tip.compact': '/compact로 길어지면 컨텍스트 압축',
  'tui.tip.status': '/status: 컨텍스트 · ZDR · web/Context7 · media · office',
  'tui.tip.context': '/context: 메모리 연속성 + 프라이버시 (ZDR)',
  'tui.tip.mediaKeys': 'media: OPENAI/GOOGLE 키 → GenerateImage/Video — MCP 불필요',
  'tui.tip.research': 'research: Context7 + WebSearch/FetchURL — MCP 불필요',
  'tui.tip.office':
    'office: SearchSkill → docx / pptx / xlsx — Word, 슬라이드, 시트, MCP 설정 없음',
  'tui.tip.websearch': 'WebSearch 기본 3건 — limit 올리기 전에 쿼리를 구체적으로',
  'tui.tip.browser': 'browser/computer 도구는 스크린샷 증명용 내장 — MCP 불필요',
  'tui.tip.firstRun': '첫 실행: /login 후 작업 입력 — 복잡한 설정 불필요',
  'tui.tip.footerBadges':
    'footer 배지는 컨텍스트가 높거나 압축 후 증거가 누락되면 경고합니다',
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
    '/status Memory는 reflection on/×N (기본 on, ≥4h/8 candidates) — 장기 기억 위생',
  'tui.tip.microBadges': 'footer μ 배지는 설정 없이 micro clear(cache-miss/swarm)를 표시',
  'tui.tip.mediaZeroConfig':
    'media: OPENAI/GOOGLE 키가 있으면 GenerateImage/Video 제로컨피그',
  'tui.tip.mediaFooter':
    'media: OPENAI/GOOGLE 키가 GenerateImage/Video를 준비할 때만 footer img/vid 배지',
  'tui.tip.backgroundAgent':
    'background Agent는 독립 작업에만 — bg 실행 후 TaskOutput-wait 금지',
  'tui.tip.shiftTabOff': 'Ask 모드는 조사만 합니다 — shift-tab을 다시 누르면 Build로',
  'tui.tip.model': '/model: 모델 전환',
  'tui.tip.loginMedia':
    '/login으로 프로바이더 연결; 이미지/영상은 OPENAI_API_KEY 또는 GOOGLE_API_KEY',
  'tui.tip.glances': 'TUI glance: thinking 4 · command 4 · result 3 (densify 1/1/2 아님)',
  'tui.tip.recall':
    'Liora Memory는 메모리 ≤6개 · 각 480자; Bash soft-cap 4k; Expand 120줄 페이지',

  // ── Appearance settings ─────────────────────────────────────────────────
  'tui.appearance.timestamps': '타임스탬프',
};
