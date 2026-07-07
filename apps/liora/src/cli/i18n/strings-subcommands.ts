/**
 * Localized strings for CLI subcommand help text (descriptions, options, arguments).
 * Kept separate from the root help catalog so subcommand wiring stays easy to scan.
 */

export const SUBCOMMAND_STRINGS_EN: Readonly<Record<string, string>> = {
  // export
  'cli.sub.export.option.output': 'Output ZIP path.',
  'cli.sub.export.option.yes': 'Skip previous-session confirmation.',
  'cli.sub.export.option.noIncludeGlobalLog':
    'Skip bundling the active global diagnostic log (~/.superliora/logs/liora.log, not rotated .1 files). By default the global log is included.',
  'cli.sub.export.arg.sessionId':
    'Session id to export. Defaults to the most recent session.',

  // login
  'cli.sub.login.option.oauthKey':
    'Use a distinct OAuth storage key, preserving existing accounts as fallback refs.',
  'cli.sub.login.option.oauthHost': 'Override the OAuth host for this login.',

  // vis
  'cli.sub.vis.option.port': 'Port to bind. Default: auto-pick a free port.',
  'cli.sub.vis.option.host': 'Host to bind. Default: 127.0.0.1.',
  'cli.sub.vis.option.noOpen': 'Do not open the browser automatically.',
  'cli.sub.vis.arg.sessionId': 'Open directly to this session.',

  // doctor
  'cli.sub.doctor.cmd.config.desc': 'Validate config.toml.',
  'cli.sub.doctor.cmd.tui.desc': 'Validate tui.toml.',
  'cli.sub.doctor.arg.configPath':
    'Validate this file as config.toml instead of the default path.',
  'cli.sub.doctor.arg.tuiPath': 'Validate this file as tui.toml instead of the default path.',

  // acp
  'cli.sub.acp.option.login':
    'Run the device-code login flow then exit (entry point for ACP terminal-auth).',

  // browser-use
  'cli.sub.browserUse.cmd.install.desc': 'Pre-download CloakBrowser (primary), Camoufox (secondary), and Lightpanda (tertiary) runtimes.',
  'cli.sub.browserUse.cmd.update.desc': 'Update CloakBrowser, Camoufox, and Lightpanda browser-use runtimes.',
  'cli.sub.browserUse.cmd.status.desc': 'Print CloakBrowser, Camoufox, and Lightpanda runtime status.',
  'cli.sub.browserUse.cmd.doctor.desc': 'Diagnose the tiered browser-use runtime.',

  // computer-use
  'cli.sub.computerUse.cmd.install.desc': 'Install cua-driver using the upstream installer.',
  'cli.sub.computerUse.cmd.update.desc': 'Update cua-driver using the upstream installer.',
  'cli.sub.computerUse.cmd.status.desc':
    'Install cua-driver if needed, then print installation status.',
  'cli.sub.computerUse.cmd.doctor.desc': 'Run cua-driver MCP health diagnostics.',
  'cli.sub.computerUse.cmd.permissions.desc':
    'Print host permission guidance for computer-use.',

  // server
  'cli.sub.server.cmd.run.desc':
    'Start the SuperLiora server (background daemon; use --foreground to attach).',
  'cli.sub.server.option.port': 'Bind port (default {port})',
  'cli.sub.server.option.host':
    'Bind host. Omit to bind {defaultHost} (this machine only); pass --host to bind {lanHost} (all interfaces), or --host <host> for a specific host. The bearer token is printed at startup.',
  'cli.sub.server.option.allowedHost':
    'Extra Host header value to allow through the DNS-rebinding check. Repeat or comma-separate; a leading dot matches a domain suffix (e.g. .example.com).',
  'cli.sub.server.option.insecureNoTls':
    'Allow a non-loopback bind without a TLS-terminating reverse proxy. Defaults to true; only relevant for non-loopback binds.',
  'cli.sub.server.option.allowRemoteShutdown':
    'On a non-loopback bind, keep POST /api/v1/shutdown enabled (default: route is disabled → 404).',
  'cli.sub.server.option.allowRemoteTerminals':
    'On a non-loopback bind, keep the PTY /api/v1/terminals/* routes enabled (default: disabled → 404). Remote shell is high risk.',
  'cli.sub.server.option.logLevel': 'Server log level: {levels}. Omit to keep logs off.',
  'cli.sub.server.option.debugEndpoints':
    'Mount /api/v1/debug/* routes for test introspection. OFF by default; production callers leave this unset.',
  'cli.sub.server.option.foreground':
    'Run the server in the foreground and keep this terminal attached until SIGINT/SIGTERM (do not daemonize).',
  'cli.sub.server.cmd.ps.desc':
    'List clients currently connected to the running SuperLiora server.',
  'cli.sub.server.cmd.ps.option.json': 'Print the raw connection list as JSON.',
  'cli.sub.server.cmd.kill.desc':
    'Stop the running SuperLiora server (graceful API + forced PID kill).',
  'cli.sub.server.cmd.rotateToken.desc':
    'Generate a new persistent server token; the previous token stops working immediately.',

  // provider — top-level commands
  'cli.sub.provider.cmd.add.desc':
    'Import every provider listed in a custom registry (api.json).',
  'cli.sub.provider.cmd.add.option.apiKey':
    'Registry API key. Falls back to KIMI_REGISTRY_API_KEY.',
  'cli.sub.provider.cmd.remove.desc':
    'Remove a provider and every model alias that referenced it.',
  'cli.sub.provider.cmd.list.desc': 'Show configured providers and their model counts.',
  'cli.sub.provider.cmd.list.option.json':
    'Emit the raw providers/models config as JSON.',
  'cli.sub.provider.cmd.doctor.desc':
    'Validate provider auth, environment refs, and routes without exposing secrets.',
  'cli.sub.provider.cmd.doctor.option.json': 'Emit provider diagnostics as JSON.',
  'cli.sub.provider.cmd.use.desc': 'Set the default model alias for future runs.',
  'cli.sub.provider.cmd.custom.desc':
    'Add direct custom endpoints without an api.json registry.',
  'cli.sub.provider.cmd.customAdd.desc':
    'Add an OpenAI-compatible or supported direct custom endpoint.',
  'cli.sub.provider.cmd.customAdd.option.baseUrl':
    'Endpoint base URL, for example http://localhost:11434/v1.',
  'cli.sub.provider.cmd.customAdd.option.model':
    'Upstream model id to send to the endpoint.',
  'cli.sub.provider.cmd.customAdd.option.apiKey':
    'Provider API key. Falls back to KIMI_PROVIDER_API_KEY.',
  'cli.sub.provider.cmd.customAdd.option.apiKeyEnv':
    'Store {env:NAME} instead of a raw provider API key.',
  'cli.sub.provider.cmd.customAdd.option.keyless':
    'Use a placeholder key for local endpoints that do not require auth.',
  'cli.sub.provider.cmd.customAdd.option.alias':
    'Model alias to create. Defaults to <providerId>/<modelId>.',
  'cli.sub.provider.cmd.customAdd.option.type': 'Provider wire type. Defaults to openai.',
  'cli.sub.provider.cmd.customAdd.option.context':
    'Context window. Defaults to {size}.',
  'cli.sub.provider.cmd.customAdd.option.output': 'Max output tokens for this model.',
  'cli.sub.provider.cmd.customAdd.option.displayName':
    'Friendly model name shown in selectors.',
  'cli.sub.provider.cmd.customAdd.option.thinking':
    'Mark the model as thinking-capable.',
  'cli.sub.provider.cmd.customAdd.option.setDefault':
    'Make the added model the default model.',
  'cli.sub.provider.cmd.key.desc': 'Manage API keys for configured providers.',
  'cli.sub.provider.cmd.keyAdd.desc':
    'Add an API key to a configured provider for fallback/load balancing.',
  'cli.sub.provider.cmd.keyAdd.option.apiKey':
    'Provider API key. Falls back to KIMI_PROVIDER_API_KEY.',
  'cli.sub.provider.cmd.keyAdd.option.apiKeys':
    'Comma-separated provider API keys to add in one write.',
  'cli.sub.provider.cmd.keyAdd.option.apiKeyEnv':
    'Store {env:NAME} instead of a raw provider API key.',
  'cli.sub.provider.cmd.keyAdd.option.apiKeyEnvs':
    'Comma-separated env var names to store as {env:NAME} refs.',
  'cli.sub.provider.cmd.keyAdd.option.baseUrl':
    'Per-credential endpoint override for the added key(s).',
  'cli.sub.provider.cmd.keyAdd.option.label':
    'Friendly label for one added key, e.g. work or account-1.',
  'cli.sub.provider.cmd.keyAdd.option.labels':
    'Comma-separated labels for bulk key adds.',
  'cli.sub.provider.cmd.keyAdd.option.rpm':
    'Local requests-per-minute limit for the added key(s).',
  'cli.sub.provider.cmd.keyAdd.option.tpm':
    'Local tokens-per-minute limit for the added key(s).',
  'cli.sub.provider.cmd.keyAdd.option.autoRoute':
    'Enable auto routing for model aliases that use this provider.',
  'cli.sub.provider.cmd.keyList.desc':
    'List configured API key slots without printing secret values.',
  'cli.sub.provider.cmd.keyRemove.desc':
    'Remove one configured API key by its 1-based slot number.',
  'cli.sub.provider.cmd.keyPromote.desc':
    'Move one configured API key slot to primary without printing secret values.',
  'cli.sub.provider.cmd.keyLabel.desc':
    'Set a friendly label on one configured API key slot.',
  'cli.sub.provider.cmd.keyUnlabel.desc':
    'Remove the friendly label from one configured API key slot.',
  'cli.sub.provider.cmd.keyLimit.desc':
    'Set or clear local RPM/TPM limits on one API key slot.',
  'cli.sub.provider.cmd.keyLimit.option.rpm': 'Local requests-per-minute limit.',
  'cli.sub.provider.cmd.keyLimit.option.tpm': 'Local tokens-per-minute limit.',
  'cli.sub.provider.cmd.keyLimit.option.clear':
    'Remove local RPM/TPM limits from this key.',
  'cli.sub.provider.cmd.keyClear.desc': 'Remove every configured API key from a provider.',
  'cli.sub.provider.cmd.oauth.desc': 'Manage OAuth account refs for configured providers.',
  'cli.sub.provider.cmd.oauthAdd.desc':
    'Add an OAuth account ref to a configured provider for fallback/load balancing.',
  'cli.sub.provider.cmd.oauthAdd.option.key':
    'OAuth credential storage key to reference.',
  'cli.sub.provider.cmd.oauthAdd.option.storage':
    'OAuth storage backend: file or keyring. Defaults to file.',
  'cli.sub.provider.cmd.oauthAdd.option.oauthHost':
    'OAuth host override for providers with multiple auth hosts.',
  'cli.sub.provider.cmd.oauthAdd.option.label':
    'Friendly label for this OAuth account ref.',
  'cli.sub.provider.cmd.oauthAdd.option.autoRoute':
    'Enable auto routing for model aliases that use this provider.',
  'cli.sub.provider.cmd.oauthList.desc':
    'List configured OAuth account ref slots without printing storage keys.',
  'cli.sub.provider.cmd.oauthRemove.desc':
    'Remove one configured OAuth account ref by its 1-based slot number.',
  'cli.sub.provider.cmd.oauthPromote.desc':
    'Move one configured OAuth account ref slot to primary without printing storage keys.',
  'cli.sub.provider.cmd.oauthLabel.desc':
    'Set a friendly label on one OAuth account ref slot.',
  'cli.sub.provider.cmd.oauthUnlabel.desc':
    'Remove the friendly label from one OAuth account ref slot.',
  'cli.sub.provider.cmd.oauthClear.desc':
    'Remove every configured OAuth account ref from a provider.',
  'cli.sub.provider.cmd.route.desc':
    'Manage model fallback and load-balancing routes.',
  'cli.sub.provider.cmd.routeShow.desc': 'Show fallback routing config for a model alias.',
  'cli.sub.provider.cmd.routePreview.desc':
    'Preview expanded route candidates without exposing secret values.',
  'cli.sub.provider.cmd.routePreview.option.json':
    'Emit expanded route candidates as JSON.',
  'cli.sub.provider.cmd.routeAuto.desc':
    'Enable smart auto routing when a model has a credential pool or fallbacks.',
  'cli.sub.provider.cmd.routeAuto.option.fallback':
    'Comma-separated fallback model aliases. Empty string clears.',
  'cli.sub.provider.cmd.routeAuto.option.cooldownMs':
    'Cooldown after rate/auth/quota failures.',
  'cli.sub.provider.cmd.routeAuto.option.sessionAffinity':
    'Pin a session to the first successful route candidate: on or off. Defaults to on.',
  'cli.sub.provider.cmd.routeAuto.option.preferCredential':
    'Prefer a credential label, e.g. api_key:2 or primary:api_key:2. Empty string clears.',
  'cli.sub.provider.cmd.routeSet.desc': 'Set fallback routing config for a model alias.',
  'cli.sub.provider.cmd.routeSet.option.fallback':
    'Comma-separated fallback model aliases. Empty string clears.',
  'cli.sub.provider.cmd.routeSet.option.strategy':
    'Routing strategy: auto, fallback, fill_first, round_robin, weighted_round_robin, least_used, lowest_latency, rate_limit_aware, or random.',
  'cli.sub.provider.cmd.routeSet.option.cooldownMs':
    'Cooldown after rate/auth/quota failures.',
  'cli.sub.provider.cmd.routeSet.option.weights':
    'Comma-separated model weights, e.g. primary=3,backup=1. Empty string clears.',
  'cli.sub.provider.cmd.routeSet.option.sessionAffinity':
    'Pin a session to the first successful route candidate: on or off.',
  'cli.sub.provider.cmd.routeSet.option.preferCredential':
    'Prefer a credential label, e.g. api_key:2 or primary:api_key:2. Empty string clears.',
  'cli.sub.provider.cmd.routeReset.desc':
    'Reset runtime route cooldown and health counters for a session.',
  'cli.sub.provider.cmd.routeStatus.desc':
    'Show runtime route health, cooldowns, and counters for a session.',
  'cli.sub.provider.cmd.routeStatus.option.json': 'Emit route health as JSON.',
  'cli.sub.provider.cmd.catalog.desc':
    'Discover and import providers from the public models.dev catalog.',
  'cli.sub.provider.cmd.catalogList.desc':
    'List providers in the catalog, or models when a providerId is given.',
  'cli.sub.provider.cmd.catalogList.option.filter':
    'Case-insensitive id/name substring filter.',
  'cli.sub.provider.cmd.catalogList.option.url':
    'Override catalog URL. Defaults to {url}.',
  'cli.sub.provider.cmd.catalogList.option.json':
    'Emit the matching catalog slice as JSON.',
  'cli.sub.provider.cmd.catalogAdd.desc': 'Import a known provider from the catalog by id.',
  'cli.sub.provider.cmd.catalogAdd.option.apiKey':
    'API key for the provider. Falls back to KIMI_REGISTRY_API_KEY.',
  'cli.sub.provider.cmd.catalogAdd.option.apiKeyEnv':
    'Store {env:NAME} instead of a raw provider API key.',
  'cli.sub.provider.cmd.catalogAdd.option.defaultModel':
    'Mark the imported model as default_model after import.',
  'cli.sub.provider.cmd.catalogAdd.option.url':
    'Override catalog URL. Defaults to {url}.',
};

export const SUBCOMMAND_STRINGS_KO: Readonly<Record<string, string>> = {
  // export
  'cli.sub.export.option.output': '출력 ZIP 경로.',
  'cli.sub.export.option.yes': '이전 세션 확인 단계를 건너뜁니다.',
  'cli.sub.export.option.noIncludeGlobalLog':
    '활성 전역 진단 로그(~/.superliora/logs/liora.log, .1 회전 파일 제외)를 묶지 않습니다. 기본값은 포함입니다.',
  'cli.sub.export.arg.sessionId':
    '내보낼 세션 ID. 기본값은 가장 최근 세션입니다.',

  // login
  'cli.sub.login.option.oauthKey':
    '별도 OAuth 저장 키를 사용해 기존 계정을 폴백 ref로 유지합니다.',
  'cli.sub.login.option.oauthHost': '이번 로그인의 OAuth 호스트를 재정의합니다.',

  // vis
  'cli.sub.vis.option.port': '바인드할 포트. 기본값: 사용 가능한 포트를 자동 선택.',
  'cli.sub.vis.option.host': '바인드할 호스트. 기본값: 127.0.0.1.',
  'cli.sub.vis.option.noOpen': '브라우저를 자동으로 열지 않습니다.',
  'cli.sub.vis.arg.sessionId': '이 세션으로 바로 엽니다.',

  // doctor
  'cli.sub.doctor.cmd.config.desc': 'config.toml을 검사합니다.',
  'cli.sub.doctor.cmd.tui.desc': 'tui.toml을 검사합니다.',
  'cli.sub.doctor.arg.configPath':
    '기본 경로 대신 이 파일을 config.toml로 검사합니다.',
  'cli.sub.doctor.arg.tuiPath': '기본 경로 대신 이 파일을 tui.toml로 검사합니다.',

  // acp
  'cli.sub.acp.option.login':
    '디바이스 코드 로그인 흐름을 실행한 뒤 종료합니다(ACP terminal-auth 진입점).',

  // browser-use
  'cli.sub.browserUse.cmd.install.desc': 'CloakBrowser(1순위), Camoufox(2순위), Lightpanda(지원 시 3순위) 런타임을 미리 다운로드합니다.',
  'cli.sub.browserUse.cmd.update.desc': 'CloakBrowser, Camoufox, Lightpanda browser-use 런타임을 업데이트합니다.',
  'cli.sub.browserUse.cmd.status.desc': 'CloakBrowser, Camoufox, Lightpanda 런타임 상태를 출력합니다.',
  'cli.sub.browserUse.cmd.doctor.desc': '계층형 browser-use 런타임을 진단합니다.',

  // computer-use
  'cli.sub.computerUse.cmd.install.desc': '업스트림 설치 프로그램으로 cua-driver를 설치합니다.',
  'cli.sub.computerUse.cmd.update.desc': '업스트림 설치 프로그램으로 cua-driver를 업데이트합니다.',
  'cli.sub.computerUse.cmd.status.desc':
    '필요하면 cua-driver를 설치한 뒤 설치 상태를 출력합니다.',
  'cli.sub.computerUse.cmd.doctor.desc': 'cua-driver MCP 상태 진단을 실행합니다.',
  'cli.sub.computerUse.cmd.permissions.desc':
    'computer-use용 호스트 권한 안내를 출력합니다.',

  // server
  'cli.sub.server.cmd.run.desc':
    'SuperLiora 서버를 시작합니다(백그라운드 데몬; --foreground로 포그라운드 실행).',
  'cli.sub.server.option.port': '바인드 포트(기본값 {port})',
  'cli.sub.server.option.host':
    '바인드 호스트. 생략하면 {defaultHost}(이 머신만); --host만 주면 {lanHost}(모든 인터페이스); --host <host>로 특정 호스트 지정. 시작 시 bearer 토큰이 출력됩니다.',
  'cli.sub.server.option.allowedHost':
    'DNS 리바인딩 검사를 통과할 추가 Host 헤더 값. 반복하거나 쉼표로 구분; 선행 점(.)은 도메인 접미사와 매칭(예: .example.com).',
  'cli.sub.server.option.insecureNoTls':
    'TLS 종단 리버스 프록시 없이 non-loopback 바인드를 허용합니다. 기본값 true; non-loopback 바인드에만 해당.',
  'cli.sub.server.option.allowRemoteShutdown':
    'non-loopback 바인드에서 POST /api/v1/shutdown을 유지합니다(기본: 비활성 → 404).',
  'cli.sub.server.option.allowRemoteTerminals':
    'non-loopback 바인드에서 PTY /api/v1/terminals/* 경로를 유지합니다(기본: 비활성 → 404). 원격 셸은 위험합니다.',
  'cli.sub.server.option.logLevel': '서버 로그 수준: {levels}. 생략하면 로그 끔.',
  'cli.sub.server.option.debugEndpoints':
    '테스트용 /api/v1/debug/* 경로를 마운트합니다. 기본 OFF; 프로덕션에서는 설정하지 마세요.',
  'cli.sub.server.option.foreground':
    '포그라운드에서 서버를 실행하고 SIGINT/SIGTERM까지 이 터미널에 붙어 있습니다(데몬화 안 함).',
  'cli.sub.server.cmd.ps.desc':
    '실행 중인 SuperLiora 서버에 연결된 클라이언트를 나열합니다.',
  'cli.sub.server.cmd.ps.option.json': '원본 연결 목록을 JSON으로 출력합니다.',
  'cli.sub.server.cmd.kill.desc':
    '실행 중인 SuperLiora 서버를 중지합니다(우아한 API + 강제 PID 종료).',
  'cli.sub.server.cmd.rotateToken.desc':
    '새 영구 서버 토큰을 생성합니다; 이전 토큰은 즉시 무효화됩니다.',

  // provider
  'cli.sub.provider.cmd.add.desc':
    '커스텀 레지스트리(api.json)에 나열된 모든 프로바이더를 가져옵니다.',
  'cli.sub.provider.cmd.add.option.apiKey':
    '레지스트리 API 키. KIMI_REGISTRY_API_KEY로 대체.',
  'cli.sub.provider.cmd.remove.desc':
    '프로바이더와 이를 참조하던 모든 모델 별칭을 제거합니다.',
  'cli.sub.provider.cmd.list.desc': '구성된 프로바이더와 모델 수를 표시합니다.',
  'cli.sub.provider.cmd.list.option.json':
    'providers/models 구성을 JSON으로 출력합니다.',
  'cli.sub.provider.cmd.doctor.desc':
    '비밀 값을 노출하지 않고 프로바이더 인증, 환경 ref, 라우트를 검증합니다.',
  'cli.sub.provider.cmd.doctor.option.json': '프로바이더 진단 결과를 JSON으로 출력합니다.',
  'cli.sub.provider.cmd.use.desc': '이후 실행의 기본 모델 별칭을 설정합니다.',
  'cli.sub.provider.cmd.custom.desc':
    'api.json 레지스트리 없이 직접 커스텀 엔드포인트를 추가합니다.',
  'cli.sub.provider.cmd.customAdd.desc':
    'OpenAI 호환 또는 지원되는 직접 커스텀 엔드포인트를 추가합니다.',
  'cli.sub.provider.cmd.customAdd.option.baseUrl':
    '엔드포인트 기본 URL, 예: http://localhost:11434/v1.',
  'cli.sub.provider.cmd.customAdd.option.model':
    '엔드포인트로 보낼 업스트림 모델 ID.',
  'cli.sub.provider.cmd.customAdd.option.apiKey':
    '프로바이더 API 키. KIMI_PROVIDER_API_KEY로 대체.',
  'cli.sub.provider.cmd.customAdd.option.apiKeyEnv':
    '원시 API 키 대신 {env:NAME}을 저장합니다.',
  'cli.sub.provider.cmd.customAdd.option.keyless':
    '인증이 필요 없는 로컬 엔드포인트용 플레이스홀더 키를 사용합니다.',
  'cli.sub.provider.cmd.customAdd.option.alias':
    '생성할 모델 별칭. 기본값 <providerId>/<modelId>.',
  'cli.sub.provider.cmd.customAdd.option.type': '프로바이더 wire 타입. 기본값 openai.',
  'cli.sub.provider.cmd.customAdd.option.context':
    '컨텍스트 윈도우. 기본값 {size}.',
  'cli.sub.provider.cmd.customAdd.option.output': '이 모델의 최대 출력 토큰.',
  'cli.sub.provider.cmd.customAdd.option.displayName':
    '선택기에 표시할 친숙한 모델 이름.',
  'cli.sub.provider.cmd.customAdd.option.thinking':
    '모델을 사고(thinking) 지원으로 표시합니다.',
  'cli.sub.provider.cmd.customAdd.option.setDefault':
    '추가한 모델을 기본 모델로 설정합니다.',
  'cli.sub.provider.cmd.key.desc': '구성된 프로바이더의 API 키를 관리합니다.',
  'cli.sub.provider.cmd.keyAdd.desc':
    '폴백/로드 밸런싱용 API 키를 구성된 프로바이더에 추가합니다.',
  'cli.sub.provider.cmd.keyAdd.option.apiKey':
    '프로바이더 API 키. KIMI_PROVIDER_API_KEY로 대체.',
  'cli.sub.provider.cmd.keyAdd.option.apiKeys':
    '한 번에 추가할 쉼표 구분 프로바이더 API 키.',
  'cli.sub.provider.cmd.keyAdd.option.apiKeyEnv':
    '원시 API 키 대신 {env:NAME}을 저장합니다.',
  'cli.sub.provider.cmd.keyAdd.option.apiKeyEnvs':
    '{env:NAME} ref로 저장할 쉼표 구분 환경 변수 이름.',
  'cli.sub.provider.cmd.keyAdd.option.baseUrl':
    '추가된 키의 자격 증명별 엔드포인트 재정의.',
  'cli.sub.provider.cmd.keyAdd.option.label':
    '추가 키 하나의 친숙한 레이블, 예: work 또는 account-1.',
  'cli.sub.provider.cmd.keyAdd.option.labels':
    '대량 키 추가용 쉼표 구분 레이블.',
  'cli.sub.provider.cmd.keyAdd.option.rpm':
    '추가된 키의 로컬 분당 요청 수 제한.',
  'cli.sub.provider.cmd.keyAdd.option.tpm':
    '추가된 키의 로컬 분당 토큰 수 제한.',
  'cli.sub.provider.cmd.keyAdd.option.autoRoute':
    '이 프로바이더를 쓰는 모델 별칭에 자동 라우팅을 켭니다.',
  'cli.sub.provider.cmd.keyList.desc':
    '비밀 값을 출력하지 않고 구성된 API 키 슬롯을 나열합니다.',
  'cli.sub.provider.cmd.keyRemove.desc':
    '1부터 시작하는 슬롯 번호로 API 키 하나를 제거합니다.',
  'cli.sub.provider.cmd.keyPromote.desc':
    '비밀 값을 출력하지 않고 API 키 슬롯 하나를 primary로 이동합니다.',
  'cli.sub.provider.cmd.keyLabel.desc':
    'API 키 슬롯 하나에 친숙한 레이블을 설정합니다.',
  'cli.sub.provider.cmd.keyUnlabel.desc':
    'API 키 슬롯 하나에서 친숙한 레이블을 제거합니다.',
  'cli.sub.provider.cmd.keyLimit.desc':
    'API 키 슬롯 하나의 로컬 RPM/TPM 제한을 설정하거나 해제합니다.',
  'cli.sub.provider.cmd.keyLimit.option.rpm': '로컬 분당 요청 수 제한.',
  'cli.sub.provider.cmd.keyLimit.option.tpm': '로컬 분당 토큰 수 제한.',
  'cli.sub.provider.cmd.keyLimit.option.clear':
    '이 키의 로컬 RPM/TPM 제한을 제거합니다.',
  'cli.sub.provider.cmd.keyClear.desc':
    '프로바이더에서 구성된 모든 API 키를 제거합니다.',
  'cli.sub.provider.cmd.oauth.desc':
    '구성된 프로바이더의 OAuth 계정 ref를 관리합니다.',
  'cli.sub.provider.cmd.oauthAdd.desc':
    '폴백/로드 밸런싱용 OAuth 계정 ref를 구성된 프로바이더에 추가합니다.',
  'cli.sub.provider.cmd.oauthAdd.option.key':
    '참조할 OAuth 자격 증명 저장 키.',
  'cli.sub.provider.cmd.oauthAdd.option.storage':
    'OAuth 저장 백엔드: file 또는 keyring. 기본값 file.',
  'cli.sub.provider.cmd.oauthAdd.option.oauthHost':
    '여러 auth 호스트가 있는 프로바이더의 OAuth 호스트 재정의.',
  'cli.sub.provider.cmd.oauthAdd.option.label':
    '이 OAuth 계정 ref의 친숙한 레이블.',
  'cli.sub.provider.cmd.oauthAdd.option.autoRoute':
    '이 프로바이더를 쓰는 모델 별칭에 자동 라우팅을 켭니다.',
  'cli.sub.provider.cmd.oauthList.desc':
    '저장 키를 출력하지 않고 OAuth 계정 ref 슬롯을 나열합니다.',
  'cli.sub.provider.cmd.oauthRemove.desc':
    '1부터 시작하는 슬롯 번호로 OAuth 계정 ref 하나를 제거합니다.',
  'cli.sub.provider.cmd.oauthPromote.desc':
    '저장 키를 출력하지 않고 OAuth 계정 ref 슬롯 하나를 primary로 이동합니다.',
  'cli.sub.provider.cmd.oauthLabel.desc':
    'OAuth 계정 ref 슬롯 하나에 친숙한 레이블을 설정합니다.',
  'cli.sub.provider.cmd.oauthUnlabel.desc':
    'OAuth 계정 ref 슬롯 하나에서 친숙한 레이블을 제거합니다.',
  'cli.sub.provider.cmd.oauthClear.desc':
    '프로바이더에서 구성된 모든 OAuth 계정 ref를 제거합니다.',
  'cli.sub.provider.cmd.route.desc':
    '모델 폴백 및 로드 밸런싱 라우트를 관리합니다.',
  'cli.sub.provider.cmd.routeShow.desc':
    '모델 별칭의 폴백 라우팅 구성을 표시합니다.',
  'cli.sub.provider.cmd.routePreview.desc':
    '비밀 값을 노출하지 않고 확장된 라우트 후보를 미리 봅니다.',
  'cli.sub.provider.cmd.routePreview.option.json':
    '확장된 라우트 후보를 JSON으로 출력합니다.',
  'cli.sub.provider.cmd.routeAuto.desc':
    '자격 증명 풀이나 폴백이 있을 때 스마트 자동 라우팅을 켭니다.',
  'cli.sub.provider.cmd.routeAuto.option.fallback':
    '쉼표 구분 폴백 모델 별칭. 빈 문자열이면 해제.',
  'cli.sub.provider.cmd.routeAuto.option.cooldownMs':
    'rate/auth/quota 실패 후 쿨다운.',
  'cli.sub.provider.cmd.routeAuto.option.sessionAffinity':
    '세션을 첫 성공 라우트 후보에 고정: on 또는 off. 기본값 on.',
  'cli.sub.provider.cmd.routeAuto.option.preferCredential':
    '자격 증명 레이블 선호, 예: api_key:2 또는 primary:api_key:2. 빈 문자열이면 해제.',
  'cli.sub.provider.cmd.routeSet.desc':
    '모델 별칭의 폴백 라우팅 구성을 설정합니다.',
  'cli.sub.provider.cmd.routeSet.option.fallback':
    '쉼표 구분 폴백 모델 별칭. 빈 문자열이면 해제.',
  'cli.sub.provider.cmd.routeSet.option.strategy':
    '라우팅 전략: auto, fallback, fill_first, round_robin, weighted_round_robin, least_used, lowest_latency, rate_limit_aware, random.',
  'cli.sub.provider.cmd.routeSet.option.cooldownMs':
    'rate/auth/quota 실패 후 쿨다운.',
  'cli.sub.provider.cmd.routeSet.option.weights':
    '쉼표 구분 모델 가중치, 예: primary=3,backup=1. 빈 문자열이면 해제.',
  'cli.sub.provider.cmd.routeSet.option.sessionAffinity':
    '세션을 첫 성공 라우트 후보에 고정: on 또는 off.',
  'cli.sub.provider.cmd.routeSet.option.preferCredential':
    '자격 증명 레이블 선호, 예: api_key:2 또는 primary:api_key:2. 빈 문자열이면 해제.',
  'cli.sub.provider.cmd.routeReset.desc':
    '세션의 런타임 라우트 쿨다운 및 상태 카운터를 초기화합니다.',
  'cli.sub.provider.cmd.routeStatus.desc':
    '세션의 런타임 라우트 상태, 쿨다운, 카운터를 표시합니다.',
  'cli.sub.provider.cmd.routeStatus.option.json': '라우트 상태를 JSON으로 출력합니다.',
  'cli.sub.provider.cmd.catalog.desc':
    '공개 models.dev 카탈로그에서 프로바이더를 찾아 가져옵니다.',
  'cli.sub.provider.cmd.catalogList.desc':
    '카탈로그의 프로바이더를 나열하거나 providerId가 주어지면 모델을 나열합니다.',
  'cli.sub.provider.cmd.catalogList.option.filter':
    '대소문자 구분 없는 id/이름 부분 문자열 필터.',
  'cli.sub.provider.cmd.catalogList.option.url':
    '카탈로그 URL 재정의. 기본값 {url}.',
  'cli.sub.provider.cmd.catalogList.option.json':
    '일치하는 카탈로그 슬라이스를 JSON으로 출력합니다.',
  'cli.sub.provider.cmd.catalogAdd.desc':
    '카탈로그에서 id로 알려진 프로바이더를 가져옵니다.',
  'cli.sub.provider.cmd.catalogAdd.option.apiKey':
    '프로바이더 API 키. KIMI_REGISTRY_API_KEY로 대체.',
  'cli.sub.provider.cmd.catalogAdd.option.apiKeyEnv':
    '원시 API 키 대신 {env:NAME}을 저장합니다.',
  'cli.sub.provider.cmd.catalogAdd.option.defaultModel':
    '가져온 후 imported 모델을 default_model로 표시합니다.',
  'cli.sub.provider.cmd.catalogAdd.option.url':
    '카탈로그 URL 재정의. 기본값 {url}.',
};
