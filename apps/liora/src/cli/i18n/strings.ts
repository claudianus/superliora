import {
  STRINGS_RUNTIME_CORE_EN,
  STRINGS_RUNTIME_CORE_KO,
} from './strings-runtime-core';
import {
  STRINGS_RUNTIME_PROVIDER_EN,
  STRINGS_RUNTIME_PROVIDER_KO,
} from './strings-runtime-provider';
import { SUBCOMMAND_STRINGS_EN, SUBCOMMAND_STRINGS_KO } from './strings-subcommands';
import { STRINGS_TUI_EN, STRINGS_TUI_KO } from './strings-tui';

export type CliLocale = 'en' | 'ko';

/**
 * English CLI strings. Kept byte-identical to the previous hardcoded values
 * so the default (`en`) locale is unchanged and existing tests that assert on
 * exact English help text keep passing.
 */
export const STRINGS_EN: Readonly<Record<string, string>> = {
  'cli.description': 'The Starting Point for Next-Gen Agents',
  'cli.help': 'Show help.',
  'cli.usage': '[options] [command]',
  'cli.helpAfter': '\nDocumentation:        https://claudianus.github.io/superliora/en/\n',
  'cli.option.session':
    'Resume a session. With ID: resume that session. Without ID: interactively pick.',
  'cli.option.continue': 'Continue the previous session for the working directory.',
  'cli.option.yolo': 'Automatically approve all actions.',
  'cli.option.auto': 'Start in auto permission mode.',
  'cli.option.model':
    'LLM model alias to use for this invocation. Defaults to default_model in config.toml.',
  'cli.option.prompt': 'Run one prompt non-interactively and print the response.',
  'cli.option.outputFormat': 'Output format for prompt mode. Defaults to text.',
  'cli.option.showThinking': 'Print model thinking to stderr in prompt text mode.',
  'cli.option.addDir':
    'Add an additional workspace directory for this session. Can be repeated.',
  'cli.option.sandbox':
    'Lexical path checks: off | workspace | read-only (not OS isolation; default off).',
  'cli.option.sandboxEnforcement':
    'Sandbox enforcement: lexical (default) or process (native Bash only; Docker required, no host fallback). Host application, plugins, and raw Kaos remain trusted.',
  'cli.option.noProcessSandbox':
    'Disable process wrapping in lexical mode; conflicts with process enforcement. Lexical path checks still apply.',
  'cli.option.debug':
    'Write extra diagnostic logs under ~/.superliora/logs so a later bug report has evidence. Off by default.',
  'cli.option.worktree':
    'Create a git worktree for this session (optional name). Isolates file edits from the main checkout.',
  'cli.sub.upgrade.description':
    'Check for SuperLiora updates and install the latest version (same as update).',
  'cli.sub.upgrade.option.main':
    'Ignore published releases; install the tip of origin/main from source.',
  'cli.error.unknownCommand': "unknown command '{arg}'. See '{cmd} --help'.",
  'cli.error.didYouMean': "Did you mean '{cmd}'?",

  'cli.sub.export.description': 'Export a session as a ZIP archive.',
  'cli.sub.provider.description': 'Manage LLM providers non-interactively.',
  'cli.sub.browserUse.description': 'Manage the local browser-use runtimes (CloakBrowser primary, Camoufox secondary, Lightpanda tertiary where supported).',
  'cli.sub.computerUse.description': 'Manage the local cua-driver computer-use runtime.',
  'cli.sub.acp.description':
    'Run SuperLiora as an Agent Client Protocol (ACP) server over stdio.',
  'cli.sub.server.description':
    'Run the local SuperLiora daemon (REST + WebSocket). Daily job ops stay in the TUI (/jobs).',
  'cli.sub.login.description': 'Authenticate with SuperLiora CLI via the device-code flow.',
  'cli.sub.gc.description': 'Reclaim idle cache, worktree temp, and compress closed session wires.',
  'cli.sub.gc.option.dryRun': 'Report candidates without deleting or compressing.',
  'cli.sub.gc.option.idleDays': 'Treat sessions newer than this many days as active (default 7).',
  'cli.sub.doctor.option.storage': 'Print home/sessions/cache/logs/worktrees byte usage.',
  'cli.sub.doctor.description': 'Validate SuperLiora configuration files.',
  ...SUBCOMMAND_STRINGS_EN,
  ...STRINGS_RUNTIME_CORE_EN,
  ...STRINGS_RUNTIME_PROVIDER_EN,
  ...STRINGS_TUI_EN,
};

/**
 * Korean CLI strings. Falls back to {@link STRINGS_EN} per-key inside `t()`,
 * so any key not yet translated still renders English rather than the raw key.
 */
export const STRINGS_KO: Readonly<Record<string, string>> = {
  'cli.description': '차세대 에이전트의 시작점',
  'cli.help': '도움말을 표시합니다.',
  'cli.usage': '[옵션] [명령]',
  'cli.helpAfter': '\n문서:        https://claudianus.github.io/superliora/\n',
  'cli.option.session':
    '세션을 이어서 진행합니다. ID를 주면 해당 세션을, 생략하면 대화형으로 선택합니다.',
  'cli.option.continue': '현재 작업 디렉터리의 이전 세션을 이어서 진행합니다.',
  'cli.option.yolo': '모든 작업을 자동으로 승인합니다.',
  'cli.option.auto': '자동 권한 모드로 시작합니다.',
  'cli.option.model':
    '이번 실행에 사용할 LLM 모델 별칭입니다. 기본값은 config.toml의 default_model입니다.',
  'cli.option.prompt': '프롬프트 하나를 비대화형으로 실행하고 응답을 출력합니다.',
  'cli.option.outputFormat': '프롬프트 모드의 출력 형식입니다. 기본값은 text입니다.',
  'cli.option.showThinking': '프롬프트 텍스트 모드에서 모델의 사고를 stderr로 출력합니다.',
  'cli.option.addDir': '이 세션에 추가 작업 디렉터리를 등록합니다. 여러 번 지정할 수 있습니다.',
  'cli.option.sandbox':
    '렉시컬 경로 검사: off | workspace | read-only (OS 격리 아님, 기본 off).',
  'cli.option.sandboxEnforcement':
    '샌드박스 강도: lexical (기본) 또는 process (네이티브 Bash만 격리; Docker 필수, 호스트 대체 실행 없음). 호스트 앱, 플러그인, raw Kaos는 신뢰 대상입니다.',
  'cli.option.noProcessSandbox':
    'lexical 모드에서 프로세스 래핑을 끕니다. process 강제 모드와 함께 사용할 수 없습니다. 렉시컬 경로 검사는 유지됩니다.',
  'cli.option.debug':
    '~/.superliora/logs에 진단 로그를 남깁니다. 평소에 켜 두면 나중에 버그를 재현·분석할 증거가 남습니다. 기본 꺼짐.',
  'cli.option.worktree':
    '이 세션용 git worktree를 만듭니다(이름 선택). 메인 checkout과 파일 편집을 격리합니다.',
  'cli.sub.upgrade.description':
    'SuperLiora 업데이트를 확인하고 최신 버전을 설치합니다 (update와 동일).',
  'cli.sub.upgrade.option.main':
    '게시된 릴리즈를 무시하고 origin/main 최신 소스로 설치합니다.',
  'cli.error.unknownCommand': "알 수 없는 명령 '{arg}'. '{cmd} --help'를 참고하세요.",
  'cli.error.didYouMean': "'{cmd}' 명령을 찾으셨나요?",

  'cli.sub.export.description': '세션을 ZIP 아카이브로 내보냅니다.',
  'cli.sub.provider.description': 'LLM 프로바이더를 비대화형으로 관리합니다.',
  'cli.sub.browserUse.description': '로컬 browser-use 런타임(CloakBrowser 1순위, Camoufox 2순위, Lightpanda 지원 시 3순위)을 관리합니다.',
  'cli.sub.computerUse.description': '로컬 cua-driver computer-use 런타임을 관리합니다.',
  'cli.sub.acp.description': 'SuperLiora를 stdio 기반 Agent Client Protocol(ACP) 서버로 실행합니다.',
  'cli.sub.server.description':
    '로컬 SuperLiora 데몬(REST + WebSocket)을 실행합니다. 일상 Job 조작은 TUI(/jobs)에서 합니다.',
  'cli.sub.login.description': '디바이스 코드 흐름으로 SuperLiora CLI 인증을 합니다.',
  'cli.sub.gc.description': '유휴 캐시·워크트리 임시 파일을 정리하고 종료된 세션 wire를 압축합니다.',
  'cli.sub.gc.option.dryRun': '삭제·압축 없이 후보만 보고합니다.',
  'cli.sub.gc.option.idleDays': '이 일수보다 최근 세션은 활성으로 취급합니다(기본 7).',
  'cli.sub.doctor.option.storage': '홈/세션/캐시/로그/worktree 바이트 사용량을 출력합니다.',
  'cli.sub.doctor.description': 'SuperLiora 설정 파일을 검사합니다.',
  ...SUBCOMMAND_STRINGS_KO,
  ...STRINGS_RUNTIME_CORE_KO,
  ...STRINGS_RUNTIME_PROVIDER_KO,
  ...STRINGS_TUI_KO,
};
