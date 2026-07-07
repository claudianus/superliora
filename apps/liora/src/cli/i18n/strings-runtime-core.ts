/**
 * Localized runtime output for CLI modules outside `provider`.
 * English values are byte-identical to the previous hardcoded strings.
 */

export const STRINGS_RUNTIME_CORE_EN: Readonly<Record<string, string>> = {
  // options
  'cli.runtime.options.promptEmpty': 'Prompt cannot be empty.',
  'cli.runtime.options.modelEmpty': 'Model cannot be empty.',
  'cli.runtime.options.outputFormatPromptOnly':
    'Output format is only supported in prompt mode.',
  'cli.runtime.options.showThinkingPromptOnly':
    'Show thinking is only supported in prompt mode.',
  'cli.runtime.options.promptWithYolo': 'Cannot combine --prompt with --yolo.',
  'cli.runtime.options.promptWithAuto': 'Cannot combine --prompt with --auto.',
  'cli.runtime.options.promptWithPlan': 'Cannot combine --prompt with --plan.',
  'cli.runtime.options.sessionNoIdPrompt':
    'Cannot use --session without an id in prompt mode.',
  'cli.runtime.options.continueWithSession': 'Cannot combine --continue, --session.',
  'cli.runtime.options.yoloWithAuto': 'Cannot combine --yolo with --auto.',

  // main / startup
  'cli.runtime.main.errorPrefix': 'error: {message}',
  'cli.runtime.main.seeLog': 'See log: {path}',
  'cli.runtime.startup.failedOperation': 'error: failed to {operation}: {message}',
  'cli.runtime.startup.errorTitle': 'error: {title}',
  'cli.runtime.startup.messageLabel': 'message:',
  'cli.runtime.startup.nextStepsLabel': 'next steps:',
  'cli.runtime.startup.authLoginStep1':
    'Run `liora login` to refresh your SuperLiora login.',
  'cli.runtime.startup.authLoginStep2': 'Then rerun the same command.',
  'cli.runtime.startup.providerAuthStep1':
    'Run `liora provider` to inspect configured providers and the default model.',
  'cli.runtime.startup.providerAuthStep2':
    'Run `liora provider use <model-alias>` to switch defaults, or update the API key; then rerun the same command.',
  'cli.runtime.startup.operation.runPrompt': 'run prompt',
  'cli.runtime.startup.operation.startShell': 'start shell',
  'cli.runtime.startup.operation.upgrade': 'upgrade',
  'cli.runtime.startup.operation.pluginNode': 'run plugin node entry',

  // export
  'cli.runtime.export.noPreviousSession': 'No previous session found to export.',
  'cli.runtime.export.cancelled': 'Export cancelled.',
  'cli.runtime.export.confirmPrevious': 'Export previous session "{title}"? [Y/n] ',

  // vis
  'cli.runtime.vis.startFailed': 'Failed to start liora vis: {message}',
  'cli.runtime.vis.runningAt': 'liora vis is running at {url}',
  'cli.runtime.vis.pressCtrlC': 'Press Ctrl-C to stop.',
  'cli.runtime.vis.browserOpenFailed':
    'Could not open a browser; visit {target} manually.',

  // doctor
  'cli.runtime.doctor.title': 'Liora doctor',
  'cli.runtime.doctor.allValid': 'All checked config files are valid.',
  'cli.runtime.doctor.foundIssues':
    'Liora doctor found {count} {issueWord}.',
  'cli.runtime.doctor.issue': 'issue',
  'cli.runtime.doctor.issues': 'issues',
  'cli.runtime.doctor.fileMissing': 'File does not exist.',
  'cli.runtime.doctor.fileMissingDefaults':
    'File does not exist; built-in defaults will apply.',
  'cli.runtime.doctor.invalidConfig': 'Invalid configuration in {path}.',
  'cli.runtime.doctor.validationIssues': 'Validation issues:',

  // login
  'cli.runtime.login.openingBrowser':
    'Opening browser for managed API device login: {url}',
  'cli.runtime.login.manualFallback':
    'If the browser did not open, paste the URL above and enter code: {code}',
  'cli.runtime.login.codeExpires': 'Code expires in {seconds}s.',
  'cli.runtime.login.waiting': 'Waiting for authorization to complete...',
  'cli.runtime.login.success': 'Logged in to {provider}.',
  'cli.runtime.login.cancelled': 'Login cancelled.',
  'cli.runtime.login.failed': 'Login failed: {message}',

  // acp
  'cli.runtime.acp.fatalError': 'acp server: fatal error: {message}',

  // browser-use
  'cli.runtime.browserUse.doctorPassed': 'Browser-use doctor passed.',
  'cli.runtime.browserUse.actionFailed':
    'Browser-use {action} failed. Retry with `{command}`.',

  // computer-use
  'cli.runtime.computerUse.autoInstallFailed':
    'Computer-use auto-install failed. Retry with `liora computer-use install`.',
  'cli.runtime.computerUse.actionFailed':
    'Computer-use {action} failed. Retry with `liora computer-use {action}`.',
  'cli.runtime.computerUse.permissions.darwin.title':
    'Computer-use permissions for macOS:',
  'cli.runtime.computerUse.permissions.darwin.line1':
    '- Grant Accessibility to the terminal or app that launches SuperLiora.',
  'cli.runtime.computerUse.permissions.darwin.line2':
    '- Grant Screen Recording to the same launcher, and to CuaDriver.app if macOS prompts for it.',
  'cli.runtime.computerUse.permissions.darwin.line3':
    '- Re-run `liora computer-use doctor` after changing permissions.',
  'cli.runtime.computerUse.permissions.win32.title':
    'Computer-use permissions for Windows:',
  'cli.runtime.computerUse.permissions.win32.line1':
    '- cua-driver can drive normal desktop apps without extra setup.',
  'cli.runtime.computerUse.permissions.win32.line2':
    '- Apps running elevated may require launching SuperLiora from an elevated terminal.',
  'cli.runtime.computerUse.permissions.win32.line3':
    '- Re-run `liora computer-use doctor` after changing permissions.',
  'cli.runtime.computerUse.permissions.linux.title':
    'Computer-use permissions for Linux:',
  'cli.runtime.computerUse.permissions.linux.line1':
    '- Run under a graphical session with DISPLAY or the compositor support required by cua-driver.',
  'cli.runtime.computerUse.permissions.linux.line2':
    '- Install the platform accessibility stack requested by `cua-driver` if doctor reports it missing.',
  'cli.runtime.computerUse.permissions.linux.line3':
    '- Re-run `liora computer-use doctor` after changing permissions.',

  // server
  'cli.runtime.server.noRunning': 'No running SuperLiora server.',
  'cli.runtime.server.stopped': 'SuperLiora server (pid {pid}) stopped.',
  'cli.runtime.server.killed': 'SuperLiora server (pid {pid}) killed.',
  'cli.runtime.server.killFailed':
    'Failed to stop SuperLiora server (pid {pid}); insufficient permissions?',
  'cli.runtime.server.noRunningStartHint':
    'No running SuperLiora server. Start one with `liora server run`.',
  'cli.runtime.server.notResponding': 'SuperLiora server at {origin} is not responding.',
  'cli.runtime.server.listClientsHttpFailed':
    'Failed to list clients: HTTP {status} from {origin}.',
  'cli.runtime.server.listClientsFailed': 'Failed to list clients: {message}',
  'cli.runtime.server.listClientsTimeout': 'Timed out listing clients from {origin}.',
  'cli.runtime.server.noActiveClients': 'No active clients.',
  'cli.runtime.server.readyLine': 'SuperLiora server: {origin}',
  'cli.runtime.server.reuseNoticePrefix': 'A server is already running',
  'cli.runtime.server.reuseNoticeMiddle':
    'the options from this command were not applied.',
  'cli.runtime.server.reuseNoticeSuffix': 'first to bind a new host/port.',
  'cli.runtime.server.bannerTitle': 'SuperLiora server ready',
  'cli.runtime.server.bannerSubtitle':
    'Local REST and WebSocket API is available from this machine.',
  'cli.runtime.server.bannerNetworkOff': 'off',
  'cli.runtime.server.bannerNetworkHint': '  use --host to enable',
  'cli.runtime.server.bannerLogsOff': 'off',
  'cli.runtime.server.bannerLogsHint': '  use --log-level info to enable',
  'cli.runtime.server.bannerStopCmd': 'liora server kill',
  'cli.runtime.server.labelLocal': 'Local:    ',
  'cli.runtime.server.labelNetwork': 'Network:  ',
  'cli.runtime.server.labelUrl': 'URL:      ',
  'cli.runtime.server.labelNetworkBanner': 'Network:  ',
  'cli.runtime.server.labelToken': 'Token:    ',
  'cli.runtime.server.labelLogs': 'Logs:     ',
  'cli.runtime.server.labelStop': 'Stop:     ',
  'cli.runtime.server.rotateTokenInvalid':
    'The previous token is now invalid. A running server picks up the new token automatically.',
  'cli.runtime.server.rotateTokenNew': 'New server token:',

  // upgrade / update
  'cli.runtime.upgrade.checkFailed': 'error: failed to check for updates: {reason}',
  'cli.runtime.upgrade.alreadyUpToDate':
    '{product} is already up to date ({version}).',
  'cli.runtime.upgrade.githubCheckFailed':
    'error: failed to check the GitHub checkout for updates: {reason}',
  'cli.runtime.upgrade.githubAlreadyUpToDate':
    '{product} GitHub checkout is already up to date.',
  'cli.runtime.upgrade.githubUpdated':
    'Updated {product} from GitHub ({version}). Restart the CLI to use the new build.',
  'cli.runtime.upgrade.installFailed':
    'warning: failed to install {package}@{version}: {reason}',
  'cli.runtime.upgrade.githubInstallFailed':
    'warning: failed to update {product} from GitHub: {reason}',
  'cli.runtime.upgrade.browserUseUpToDate':
    'Browser-use runtimes are up to date (Lightpanda primary, CloakBrowser fallback).',
  'cli.runtime.upgrade.browserUseUpdateFailed':
    'warning: failed to update browser-use runtimes. Run `liora browser-use update` to retry.',
  'cli.runtime.upgrade.browserUseUpdateFailedDetail':
    'warning: failed to update browser-use runtimes. Run `liora browser-use update` to retry. {reason}',
  'cli.runtime.upgrade.cloakBrowserUpToDate': 'CloakBrowser binary cache is up to date.',
  'cli.runtime.upgrade.cloakBrowserUpdateFailed':
    'warning: failed to update the CloakBrowser binary cache. Run `liora browser-use update` to retry.',
  'cli.runtime.upgrade.cloakBrowserUpdateFailedDetail':
    'warning: failed to update the CloakBrowser binary cache. Run `liora browser-use update` to retry. {reason}',
  'cli.runtime.upgrade.cuaUpToDate': 'cua-driver computer-use runtime is up to date.',
  'cli.runtime.upgrade.cuaUpdateFailed':
    'warning: failed to update the cua-driver computer-use runtime. Run `liora computer-use update` to retry.',
  'cli.runtime.upgrade.cuaUpdateFailedDetail':
    'warning: failed to update the cua-driver computer-use runtime. Run `liora computer-use update` to retry. {reason}',
  'cli.runtime.update.manualHeader':
    'A newer version of {package} is available ({current} -> {target}).',
  'cli.runtime.update.manualSource': 'Detected install source: {source}',
  'cli.runtime.update.manualCommand': 'To update manually, run: {command}',
  'cli.runtime.update.installSuccess':
    'Updated {package} to {version}. Restart the CLI to use the new version.',
  'cli.runtime.update.githubInstallSuccess':
    'Updated {product} from GitHub ({version}). Restart the CLI to use the new build.',
  'cli.runtime.update.backgroundGithub':
    '{product} updated from GitHub ({version})',
  'cli.runtime.update.backgroundSuccess':
    '{product} updated to {version}\nChangelog: {changelog}',
  'cli.runtime.update.source.native':
    'native (windows). Auto-update is not supported on this platform.',
  'cli.runtime.update.source.unsupported':
    'unsupported package manager or layout.',
  'cli.runtime.update.source.githubCheckout': 'GitHub checkout',
  'cli.runtime.update.prompt.title': '{product} Update Available',
  'cli.runtime.update.prompt.subtitle': '{product} has a newer release ready.',
  'cli.runtime.update.prompt.changelog': 'View changelog: {url}',
  'cli.runtime.update.prompt.labelCurrent': 'Current',
  'cli.runtime.update.prompt.labelTarget': 'Target ',
  'cli.runtime.update.prompt.labelSource': 'Source ',
  'cli.runtime.update.prompt.labelCommand': 'Command',
  'cli.runtime.update.prompt.hints': '\u2191\u2193 choose \u00b7 Enter confirm \u00b7 Esc continue',
  'cli.runtime.update.prompt.installHint': 'Install update now',
  'cli.runtime.update.prompt.skipHint': 'Continue with current version',

  // run-prompt / run-shell
  'cli.runtime.prompt.noSessionsContinue':
    'No sessions to continue under "{workDir}"; starting a fresh session.',
  'cli.runtime.prompt.working': 'Working...',
  'cli.runtime.shell.bye': 'Bye!',
};

export const STRINGS_RUNTIME_CORE_KO: Readonly<Record<string, string>> = {
  'cli.runtime.options.promptEmpty': '프롬프트는 비울 수 없습니다.',
  'cli.runtime.options.modelEmpty': '모델은 비울 수 없습니다.',
  'cli.runtime.options.outputFormatPromptOnly':
    '출력 형식은 프롬프트 모드에서만 지원됩니다.',
  'cli.runtime.options.showThinkingPromptOnly':
    '사고 출력은 프롬프트 모드에서만 지원됩니다.',
  'cli.runtime.options.promptWithYolo': '--prompt와 --yolo는 함께 사용할 수 없습니다.',
  'cli.runtime.options.promptWithAuto': '--prompt와 --auto는 함께 사용할 수 없습니다.',
  'cli.runtime.options.promptWithPlan': '--prompt와 --plan은 함께 사용할 수 없습니다.',
  'cli.runtime.options.sessionNoIdPrompt':
    '프롬프트 모드에서는 ID 없이 --session을 사용할 수 없습니다.',
  'cli.runtime.options.continueWithSession':
    '--continue와 --session은 함께 사용할 수 없습니다.',
  'cli.runtime.options.yoloWithAuto': '--yolo와 --auto는 함께 사용할 수 없습니다.',

  'cli.runtime.main.errorPrefix': '오류: {message}',
  'cli.runtime.main.seeLog': '로그: {path}',
  'cli.runtime.startup.failedOperation': '오류: {operation} 실패: {message}',
  'cli.runtime.startup.errorTitle': '오류: {title}',
  'cli.runtime.startup.messageLabel': '메시지:',
  'cli.runtime.startup.nextStepsLabel': '다음 단계:',
  'cli.runtime.startup.authLoginStep1':
    '`liora login`으로 SuperLiora 로그인을 갱신하세요.',
  'cli.runtime.startup.authLoginStep2': '같은 명령을 다시 실행하세요.',
  'cli.runtime.startup.providerAuthStep1':
    '`liora provider`로 구성된 프로바이더와 기본 모델을 확인하세요.',
  'cli.runtime.startup.providerAuthStep2':
    '`liora provider use <model-alias>`로 기본값을 바꾸거나 API 키를 업데이트한 뒤 같은 명령을 다시 실행하세요.',
  'cli.runtime.startup.operation.runPrompt': '프롬프트 실행',
  'cli.runtime.startup.operation.startShell': '셸 시작',
  'cli.runtime.startup.operation.upgrade': '업그레이드',
  'cli.runtime.startup.operation.pluginNode': '플러그인 node 진입점 실행',

  'cli.runtime.export.noPreviousSession': '내보낼 이전 세션이 없습니다.',
  'cli.runtime.export.cancelled': '내보내기를 취소했습니다.',
  'cli.runtime.export.confirmPrevious': '이전 세션 "{title}"을(를) 내보낼까요? [Y/n] ',

  'cli.runtime.vis.startFailed': 'liora vis 시작 실패: {message}',
  'cli.runtime.vis.runningAt': 'liora vis 실행 중: {url}',
  'cli.runtime.vis.pressCtrlC': '종료하려면 Ctrl-C를 누르세요.',
  'cli.runtime.vis.browserOpenFailed':
    '브라우저를 열 수 없습니다. {target}을(를) 직접 방문하세요.',

  'cli.runtime.doctor.title': 'Liora doctor',
  'cli.runtime.doctor.allValid': '검사한 모든 설정 파일이 유효합니다.',
  'cli.runtime.doctor.foundIssues':
    'Liora doctor가 {count}개 {issueWord}을(를) 발견했습니다.',
  'cli.runtime.doctor.issue': '문제',
  'cli.runtime.doctor.issues': '문제',
  'cli.runtime.doctor.fileMissing': '파일이 존재하지 않습니다.',
  'cli.runtime.doctor.fileMissingDefaults':
    '파일이 존재하지 않습니다. 내장 기본값이 적용됩니다.',
  'cli.runtime.doctor.invalidConfig': '{path}의 구성이 잘못되었습니다.',
  'cli.runtime.doctor.validationIssues': '검증 문제:',

  'cli.runtime.login.openingBrowser':
    '관리 API 디바이스 로그인용 브라우저를 여는 중: {url}',
  'cli.runtime.login.manualFallback':
    '브라우저가 열리지 않으면 위 URL을 붙여넣고 코드를 입력하세요: {code}',
  'cli.runtime.login.codeExpires': '코드 만료: {seconds}초.',
  'cli.runtime.login.waiting': '인증 완료를 기다리는 중...',
  'cli.runtime.login.success': '{provider}에 로그인했습니다.',
  'cli.runtime.login.cancelled': '로그인을 취소했습니다.',
  'cli.runtime.login.failed': '로그인 실패: {message}',

  'cli.runtime.acp.fatalError': 'acp 서버 치명적 오류: {message}',

  'cli.runtime.browserUse.doctorPassed': 'Browser-use doctor 통과.',
  'cli.runtime.browserUse.actionFailed':
    'Browser-use {action} 실패. `{command}`(으)로 다시 시도하세요.',

  'cli.runtime.computerUse.autoInstallFailed':
    'Computer-use 자동 설치 실패. `liora computer-use install`로 다시 시도하세요.',
  'cli.runtime.computerUse.actionFailed':
    'Computer-use {action} 실패. `liora computer-use {action}`(으)로 다시 시도하세요.',
  'cli.runtime.computerUse.permissions.darwin.title':
    'macOS computer-use 권한:',
  'cli.runtime.computerUse.permissions.darwin.line1':
    '- SuperLiora를 실행하는 터미널/앱에 손쉬운 사용(Accessibility)을 허용하세요.',
  'cli.runtime.computerUse.permissions.darwin.line2':
    '- 같은 실행 주체와 macOS가 요청하면 CuaDriver.app에 화면 기록(Screen Recording)을 허용하세요.',
  'cli.runtime.computerUse.permissions.darwin.line3':
    '- 권한 변경 후 `liora computer-use doctor`를 다시 실행하세요.',
  'cli.runtime.computerUse.permissions.win32.title':
    'Windows computer-use 권한:',
  'cli.runtime.computerUse.permissions.win32.line1':
    '- cua-driver는 추가 설정 없이 일반 데스크톱 앱을 제어할 수 있습니다.',
  'cli.runtime.computerUse.permissions.win32.line2':
    '- 상승된 권한 앱은 SuperLiora를 상승된 터미널에서 실행해야 할 수 있습니다.',
  'cli.runtime.computerUse.permissions.win32.line3':
    '- 권한 변경 후 `liora computer-use doctor`를 다시 실행하세요.',
  'cli.runtime.computerUse.permissions.linux.title':
    'Linux computer-use 권한:',
  'cli.runtime.computerUse.permissions.linux.line1':
    '- cua-driver가 요구하는 DISPLAY/컴positor가 있는 그래픽 세션에서 실행하세요.',
  'cli.runtime.computerUse.permissions.linux.line2':
    '- doctor가 누락을 보고하면 cua-driver가 요청하는 접근성 스택을 설치하세요.',
  'cli.runtime.computerUse.permissions.linux.line3':
    '- 권한 변경 후 `liora computer-use doctor`를 다시 실행하세요.',

  'cli.runtime.server.noRunning': '실행 중인 SuperLiora 서버가 없습니다.',
  'cli.runtime.server.stopped': 'SuperLiora 서버(pid {pid})를 중지했습니다.',
  'cli.runtime.server.killed': 'SuperLiora 서버(pid {pid})를 강제 종료했습니다.',
  'cli.runtime.server.killFailed':
    'SuperLiora 서버(pid {pid}) 중지 실패; 권한이 부족한가요?',
  'cli.runtime.server.noRunningStartHint':
    '실행 중인 SuperLiora 서버가 없습니다. `liora server run`으로 시작하세요.',
  'cli.runtime.server.notResponding':
    '{origin}의 SuperLiora 서버가 응답하지 않습니다.',
  'cli.runtime.server.listClientsHttpFailed':
    '클라이언트 목록 실패: {origin}에서 HTTP {status}.',
  'cli.runtime.server.listClientsFailed': '클라이언트 목록 실패: {message}',
  'cli.runtime.server.listClientsTimeout':
    '{origin}에서 클라이언트 목록 시간 초과.',
  'cli.runtime.server.noActiveClients': '활성 클라이언트가 없습니다.',
  'cli.runtime.server.readyLine': 'SuperLiora 서버: {origin}',
  'cli.runtime.server.reuseNoticePrefix': '서버가 이미 실행 중입니다',
  'cli.runtime.server.reuseNoticeMiddle':
    '이 명령의 옵션은 적용되지 않았습니다.',
  'cli.runtime.server.reuseNoticeSuffix':
    '새 호스트/포트를 바인드하려면 먼저 실행하세요.',
  'cli.runtime.server.bannerTitle': 'SuperLiora 서버 준비 완료',
  'cli.runtime.server.bannerSubtitle':
    '로컬 REST 및 WebSocket API를 이 머신에서 사용할 수 있습니다.',
  'cli.runtime.server.bannerNetworkOff': '끔',
  'cli.runtime.server.bannerNetworkHint': '  --host로 활성화',
  'cli.runtime.server.bannerLogsOff': '끔',
  'cli.runtime.server.bannerLogsHint': '  --log-level info로 활성화',
  'cli.runtime.server.bannerStopCmd': 'liora server kill',
  'cli.runtime.server.labelLocal': '로컬:    ',
  'cli.runtime.server.labelNetwork': '네트워크:  ',
  'cli.runtime.server.labelUrl': 'URL:      ',
  'cli.runtime.server.labelNetworkBanner': '네트워크:  ',
  'cli.runtime.server.labelToken': '토큰:    ',
  'cli.runtime.server.labelLogs': '로그:     ',
  'cli.runtime.server.labelStop': '중지:     ',
  'cli.runtime.server.rotateTokenInvalid':
    '이전 토큰은 이제 무효입니다. 실행 중인 서버는 새 토큰을 자동으로 반영합니다.',
  'cli.runtime.server.rotateTokenNew': '새 서버 토큰:',

  'cli.runtime.upgrade.checkFailed': '오류: 업데이트 확인 실패: {reason}',
  'cli.runtime.upgrade.alreadyUpToDate':
    '{product}은(는) 이미 최신입니다 ({version}).',
  'cli.runtime.upgrade.githubCheckFailed':
    '오류: GitHub checkout 업데이트 확인 실패: {reason}',
  'cli.runtime.upgrade.githubAlreadyUpToDate':
    '{product} GitHub checkout은(는) 이미 최신입니다.',
  'cli.runtime.upgrade.githubUpdated':
    'GitHub에서 {product}을(를) 업데이트했습니다 ({version}). 새 빌드를 사용하려면 CLI를 재시작하세요.',
  'cli.runtime.upgrade.installFailed':
    '경고: {package}@{version} 설치 실패: {reason}',
  'cli.runtime.upgrade.githubInstallFailed':
    '경고: GitHub에서 {product} 업데이트 실패: {reason}',
  'cli.runtime.upgrade.browserUseUpToDate':
    'Browser-use 런타임이 최신입니다 (Lightpanda 1순위, CloakBrowser 폴백).',
  'cli.runtime.upgrade.browserUseUpdateFailed':
    '경고: browser-use 런타임 업데이트 실패. `liora browser-use update`로 다시 시도하세요.',
  'cli.runtime.upgrade.browserUseUpdateFailedDetail':
    '경고: browser-use 런타임 업데이트 실패. `liora browser-use update`로 다시 시도하세요. {reason}',
  'cli.runtime.upgrade.cloakBrowserUpToDate':
    'CloakBrowser 바이너리 캐시가 최신입니다.',
  'cli.runtime.upgrade.cloakBrowserUpdateFailed':
    '경고: CloakBrowser 바이너리 캐시 업데이트 실패. `liora browser-use update`로 다시 시도하세요.',
  'cli.runtime.upgrade.cloakBrowserUpdateFailedDetail':
    '경고: CloakBrowser 바이너리 캐시 업데이트 실패. `liora browser-use update`로 다시 시도하세요. {reason}',
  'cli.runtime.upgrade.cuaUpToDate':
    'cua-driver computer-use 런타임이 최신입니다.',
  'cli.runtime.upgrade.cuaUpdateFailed':
    '경고: cua-driver computer-use 런타임 업데이트 실패. `liora computer-use update`로 다시 시도하세요.',
  'cli.runtime.upgrade.cuaUpdateFailedDetail':
    '경고: cua-driver computer-use 런타임 업데이트 실패. `liora computer-use update`로 다시 시도하세요. {reason}',
  'cli.runtime.update.manualHeader':
    '{package}의 새 버전을 사용할 수 있습니다 ({current} -> {target}).',
  'cli.runtime.update.manualSource': '감지된 설치 소스: {source}',
  'cli.runtime.update.manualCommand': '수동 업데이트: {command}',
  'cli.runtime.update.installSuccess':
    '{package}을(를) {version}(으)로 업데이트했습니다. 새 버전을 사용하려면 CLI를 재시작하세요.',
  'cli.runtime.update.githubInstallSuccess':
    'GitHub에서 {product}을(를) 업데이트했습니다 ({version}). 새 빌드를 사용하려면 CLI를 재시작하세요.',
  'cli.runtime.update.backgroundGithub':
    'GitHub에서 {product} 업데이트됨 ({version})',
  'cli.runtime.update.backgroundSuccess':
    '{product} {version}(으)로 업데이트됨\n변경 로그: {changelog}',
  'cli.runtime.update.source.native':
    'native (windows). 이 플랫폼에서는 자동 업데이트를 지원하지 않습니다.',
  'cli.runtime.update.source.unsupported':
    '지원되지 않는 패키지 관리자 또는 레이아웃.',
  'cli.runtime.update.source.githubCheckout': 'GitHub checkout',
  'cli.runtime.update.prompt.title': '{product} 업데이트 사용 가능',
  'cli.runtime.update.prompt.subtitle': '{product}의 새 릴리스가 준비되었습니다.',
  'cli.runtime.update.prompt.changelog': '변경 로그 보기: {url}',
  'cli.runtime.update.prompt.labelCurrent': '현재',
  'cli.runtime.update.prompt.labelTarget': '대상 ',
  'cli.runtime.update.prompt.labelSource': '소스 ',
  'cli.runtime.update.prompt.labelCommand': '명령',
  'cli.runtime.update.prompt.hints': '↑↓ 선택 · Enter 확인 · Esc 계속',
  'cli.runtime.update.prompt.installHint': '지금 업데이트 설치',
  'cli.runtime.update.prompt.skipHint': '현재 버전으로 계속',

  'cli.runtime.prompt.noSessionsContinue':
    '"{workDir}" 아래에 이어갈 세션이 없습니다. 새 세션을 시작합니다.',
  'cli.runtime.prompt.working': '작업 중...',
  'cli.runtime.shell.bye': '안녕!',
};
