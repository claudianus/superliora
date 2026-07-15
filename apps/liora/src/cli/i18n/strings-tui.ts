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
 * English values are byte-identical to the previously-hardcoded strings so the
 * default (`en`) locale is unchanged. Korean values are provided in full; any
 * key missing from the Korean catalog still falls back to English inside `t()`.
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

  // ── Footer hints / next-actions ──────────────────────────────────────────
  'tui.footer.next.login': 'next: /login to add a provider, then /model',
  'tui.footer.next.compact': 'next: /compact before long work',
  'tui.footer.next.review': 'next: review changes',
  'tui.footer.next.media': 'next: set OPENAI_API_KEY or GOOGLE_API_KEY for image/video, or /status',
  'tui.footer.next.history': 'next: ctrl-o toggles clean chat vs full tool history',
  'tui.footer.next.default': 'next: Shift-Tab toggles Ultrawork/off · /status for media/web',
  'tui.footer.compacting': 'compacting context',
  'tui.footer.replaying': 'replaying session',
  'tui.footer.ultrawork': 'Workflow research -> interview -> goal -> swarm decision -> integrate -> verify -> learn',
  'tui.ultrawork.autoResume.title': 'Ultrawork auto-resumed',
  'tui.ultrawork.autoResume.detail': 'Resuming the interrupted run at stage {stage}.',
  'tui.footer.premium': 'Premium Quality ON — visual-first harness: art direction, anti-slop, screenshot proof',
  'tui.footer.exitConfirmCtrlC': 'Press Ctrl+C again to exit',
  'tui.footer.exitConfirmCtrlD': 'Press Ctrl+D again to exit',
  'tui.footer.detachHint': 'Detached. Output continues in the background (/tasks).',

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
  'tui.provider.apiKeyPrompt': 'Enter API key for {name}',
  'tui.provider.openingBrowser': 'Opening browser to authorize…\nIf it did not open, visit:\n{url}',
  'tui.provider.waitingAuthorization': 'Waiting for authorization…',
  'tui.provider.pasteCallbackTitle': 'Paste OAuth callback',
  'tui.provider.pasteCallbackHint1': 'If the browser could not redirect back automatically, paste the',
  'tui.provider.pasteCallbackHint2': 'callback URL or authorization code shown after sign-in.',
  'tui.provider.authorizing': 'Authorizing with {name}',
  'tui.provider.connected': 'Connected: {name}',
  'tui.provider.alreadyLoggedIn': 'Already logged in. Model configuration refreshed.',
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
  'tui.provider.refreshFailed': 'Authentication successful, but failed to refresh config: {message}',

  // ── Sessions ─────────────────────────────────────────────────────────────
  'tui.sessions.fetchFailed': 'Failed to load sessions. Check the server connection.',
  'tui.sessions.noActive': 'No active session.',

  // ── Shell command ────────────────────────────────────────────────────────
  'tui.shell.running': 'Running: {command}',

  // ── Status / errors ──────────────────────────────────────────────────────
  'tui.status.noEditor': 'No editor configured. Set $VISUAL / $EDITOR, or run /editor <command>.',
  'tui.status.compactCancelFailed': 'Failed to cancel compaction: {message}',
  'tui.status.externalEditorFailed': 'External editor failed: {message}',
  'tui.status.startupFailed': 'Startup session was not initialized.',
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

  // ── Footer hints / next-actions ──────────────────────────────────────────
  'tui.footer.next.login': '다음: /login으로 프로바이더 추가, 그리고 /model',
  'tui.footer.next.compact': '다음: 긴 작업 전 /compact',
  'tui.footer.next.review': '다음: 변경사항 검토',
  'tui.footer.next.media': '다음: 이미지/영상용 OPENAI_API_KEY 또는 GOOGLE_API_KEY 설정, 또는 /status',
  'tui.footer.next.history': '다음: ctrl-o로 깔끔한 채팅 ↔ 전체 도구 히스토리',
  'tui.footer.next.default': '다음: Shift-Tab로 Ultrawork 켜기/끄기 · 미디어/웹은 /status',
  'tui.footer.compacting': '컨텍스트 압축 중',
  'tui.footer.replaying': '세션 재생 중',
  'tui.footer.ultrawork': '워크플로: 조사 -> 인터뷰 -> 목표 -> 팀 결정 -> 통합 -> 검증 -> 학습',
  'tui.ultrawork.autoResume.title': 'Ultrawork 자동 재개',
  'tui.ultrawork.autoResume.detail': '중단된 실행을 stage {stage}에서 이어갑니다.',
  'tui.footer.premium': '프리미엄 품질 ON — 시각 중심: 아트 디렉션, 안티 슬롭, 스크린샷 증명',
  'tui.footer.exitConfirmCtrlC': '종료하려면 Ctrl+C를 다시 누르세요',
  'tui.footer.exitConfirmCtrlD': '종료하려면 Ctrl+D를 다시 누르세요',
  'tui.footer.detachHint': '분리됨. 출력은 백그라운드에서 계속됩니다 (/tasks).',

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
  'tui.provider.apiKeyPrompt': '{name}의 API 키를 입력하세요',
  'tui.provider.openingBrowser': '인증을 위해 브라우저를 여는 중…\n열리지 않으면 방문하세요:\n{url}',
  'tui.provider.waitingAuthorization': '인증 완료를 기다리는 중…',
  'tui.provider.pasteCallbackTitle': 'OAuth 콜백 붙여넣기',
  'tui.provider.pasteCallbackHint1': '브라우저가 자동으로 돌아오지 않으면 로그인 후 표시된',
  'tui.provider.pasteCallbackHint2': '콜백 URL 또는 인증 코드를 붙여넣으세요.',
  'tui.provider.authorizing': '{name}(으)로 인증 중',
  'tui.provider.connected': '연결됨: {name}',
  'tui.provider.alreadyLoggedIn': '이미 로그인되어 있습니다. 모델 설정을 새로고침했습니다.',
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
  'tui.status.noEditor': '에디터가 설정되지 않았습니다. $VISUAL / $EDITOR를 설정하거나 /editor <명령>을 실행하세요.',
  'tui.status.compactCancelFailed': '압축 취소 실패: {message}',
  'tui.status.externalEditorFailed': '외부 에디터 실패: {message}',
  'tui.status.startupFailed': '시작 세션을 초기화하지 못했습니다.',
};
