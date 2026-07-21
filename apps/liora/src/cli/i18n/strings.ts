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
  'cli.option.skillsDir':
    'Load skills from this directory instead of auto-discovered user and project directories. Can be repeated.',
  'cli.option.addDir':
    'Add an additional workspace directory for this session. Can be repeated.',
  'cli.option.plan': 'Start with Ultrawork plan steering.',
  'cli.option.resumeGoal': 'Automatically resume the first goal in the queue on startup.',
  'cli.sub.upgrade.description': 'Upgrade SuperLiora to the latest version.',
  'cli.error.unknownCommand': "unknown command '{arg}'. See '{cmd} --help'.",

  'cli.sub.export.description': 'Export a session as a ZIP archive.',
  'cli.sub.provider.description': 'Manage LLM providers non-interactively.',
  'cli.sub.browserUse.description': 'Manage the local browser-use runtimes (CloakBrowser primary, Camoufox secondary, Lightpanda tertiary where supported).',
  'cli.sub.computerUse.description': 'Manage the local cua-driver computer-use runtime.',
  'cli.sub.acp.description':
    'Run kimi-code as an Agent Client Protocol (ACP) server over stdio.',
  'cli.sub.server.description': 'Run the local SuperLiora server (REST + WebSocket API).',
  'cli.sub.login.description': 'Authenticate with SuperLiora CLI via the device-code flow.',
  'cli.sub.doctor.description': 'Validate SuperLiora configuration files.',
  'cli.sub.vis.description': 'Launch the session visualizer in your browser.',
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
  'cli.option.skillsDir':
    '자동 발견된 사용자/프로젝트 디렉터리 대신 이 디렉터리에서 스킬을 로드합니다. 여러 번 지정할 수 있습니다.',
  'cli.option.addDir': '이 세션에 추가 작업 디렉터리를 등록합니다. 여러 번 지정할 수 있습니다.',
  'cli.option.plan': 'Ultrawork 플랜 조향으로 시작합니다.',
  'cli.option.resumeGoal': '시작 시 큐의 첫 번째 goal을 자동으로 재개합니다.',
  'cli.sub.upgrade.description': 'SuperLiora를 최신 버전으로 업그레이드합니다.',
  'cli.error.unknownCommand': "알 수 없는 명령 '{arg}'. '{cmd} --help'를 참고하세요.",

  'cli.sub.export.description': '세션을 ZIP 아카이브로 내보냅니다.',
  'cli.sub.provider.description': 'LLM 프로바이더를 비대화형으로 관리합니다.',
  'cli.sub.browserUse.description': '로컬 browser-use 런타임(CloakBrowser 1순위, Camoufox 2순위, Lightpanda 지원 시 3순위)을 관리합니다.',
  'cli.sub.computerUse.description': '로컬 cua-driver computer-use 런타임을 관리합니다.',
  'cli.sub.acp.description': 'SuperLiora를 stdio 기반 Agent Client Protocol(ACP) 서버로 실행합니다.',
  'cli.sub.server.description': '로컬 SuperLiora 서버(REST + WebSocket API)를 실행합니다.',
  'cli.sub.login.description': '디바이스 코드 흐름으로 SuperLiora CLI 인증을 수행합니다.',
  'cli.sub.doctor.description': 'SuperLiora 설정 파일을 검사합니다.',
  'cli.sub.vis.description': '세션 시각화 도구를 브라우저에서 엽니다.',
  ...SUBCOMMAND_STRINGS_KO,
  ...STRINGS_RUNTIME_CORE_KO,
  ...STRINGS_RUNTIME_PROVIDER_KO,
  ...STRINGS_TUI_KO,
};
