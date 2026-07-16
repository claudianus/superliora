export type Lang = 'ko' | 'en';

export interface UseCase {
  title: string;
  body: string;
}

export interface WorkflowStep {
  num: string;
  title: string;
  body: string;
}

export interface ThemeCard {
  title: string;
  body: string;
  swatches: string[];
}

export interface FeatureItem {
  title: string;
  body: string;
  tag: string;
}

export interface InstallCommand {
  label: string;
  cmd: string;
}

export interface TerminalStep {
  cmd: string;
  output: string;
}

export interface StatItem {
  value: string;
  label: string;
}

export interface Translation {
  lang: Lang;
  dir: 'ltr';
  meta: {
    title: string;
    description: string;
    ogLocale: string;
  };
  skip: string;
  nav: {
    workflow: string;
    harness: string;
    memory: string;
    capabilities: string;
    install: string;
  };
  hero: {
    eyebrow: string;
    h1: string;
    lead: string;
    install: string;
    github: string;
    secondary: string;
    stats: StatItem[];
    chips: { title: string; body: string }[];
  };
  problem: {
    kicker: string;
    title: string;
    body: string;
    cases: UseCase[];
  };
  solution: {
    kicker: string;
    title: string;
    body: string;
    note: string;
  };
  terminal: TerminalStep[];
  ultra: {
    kicker: string;
    title: string;
    body: string;
    copyTitle: string;
    copyBody: string;
    copyList: string[];
    steps: WorkflowStep[];
  };
  harness: {
    kicker: string;
    title: string;
    body: string;
    copyTitle: string;
    copyBody: string;
    copyList: string[];
  };
  memory: {
    kicker: string;
    title: string;
    body: string;
    cards: { title: string; body: string }[];
  };
  themes: {
    kicker: string;
    title: string;
    body: string;
    cards: ThemeCard[];
  };
  capabilities: {
    kicker: string;
    title: string;
    body: string;
    items: FeatureItem[];
  };
  install: {
    kicker: string;
    title: string;
    body: string;
    cta: string;
    requirements: string;
    commands: InstallCommand[];
  };
  cta: {
    title: string;
    body: string;
    install: string;
    github: string;
  };
  footer: {
    copyright: string;
    github: string;
    english: string;
    korean: string;
    issues: string;
    security: string;
    docs: string;
  };
}

export const PRODUCT_VERSION = '0.20.1';

export const translations: Record<Lang, Translation> = {
  ko: {
    lang: 'ko',
    dir: 'ltr',
    meta: {
      title: 'SuperLiora — Blood Moon 터미널 AI 코딩 하네스',
      description:
        'SuperLiora는 Blood Moon(#E63946) 브랜드의 터미널 AI 코딩 하네스입니다. Ultrawork로 조사·계획·목표·스웜·검증·학습을 한 흐름에 묶고, Liora Recall·LLM Wiki·브라우저/컴퓨터 사용까지 같은 조종석에서 다룹니다.',
      ogLocale: 'ko_KR',
    },
    skip: '본문으로 이동',
    nav: {
      workflow: 'Ultrawork',
      harness: 'Harness',
      memory: 'Memory',
      capabilities: 'Capabilities',
      install: 'Install',
    },
    hero: {
      eyebrow: 'Blood Moon · terminal harness v0.20.1',
      h1: '긴 개발 작업을 터미널에서 끝까지 이어 붙입니다',
      lead:
        'SuperLiora는 계획, 조사, 목표, 병렬 실행, 검증, 기억, 문서화, 브라우저·컴퓨터 사용을 하나의 Ultrawork 흐름으로 묶습니다. Blood Moon 팔레트 위에서 근거와 완료 기준을 잃지 않게 합니다.',
      install: '설치하기',
      github: 'GitHub',
      secondary: '라이브 데모',
      stats: [
        { value: '0.20.1', label: 'liora release' },
        { value: '128', label: 'max specialists' },
        { value: '7', label: 'Ultrawork stages' },
        { value: 'MIT', label: 'open license' },
      ],
      chips: [
        {
          title: 'UltraPlan',
          body: '목표가 true/false로 검증 가능해질 때까지 요구를 좁힙니다.',
        },
        {
          title: 'UltraSwarm',
          body: 'ENGAGE/DEFER gate 뒤에서 최대 128명의 specialist를 운용합니다.',
        },
        {
          title: 'Liora Recall',
          body: 'semantic·episodic·procedural·prospective 기억을 세션 밖으로 남깁니다.',
        },
        {
          title: 'Browser + Desktop',
          body: 'CloakBrowser/Playwright와 CUA/MCP를 같은 하네스에서 호출합니다.',
        },
      ],
    },
    problem: {
      kicker: 'Friction',
      title: '긴 작업일수록 목표, 근거, 맥락이 먼저 무너집니다',
      body: '마이그레이션, 리팩터, 장애 대응은 중간에 완료 기준이 흐려지고 같은 조사를 반복합니다. 도구가 늘어날수록 흐름이 끊기고 결정 기록이 흩어집니다.',
      cases: [
        {
          title: 'Migration & refactor',
          body: '영향 범위, 계획, 검증 명령을 한 세션 안에서 유지합니다.',
        },
        {
          title: 'Feature delivery',
          body: '요구사항과 acceptance criteria를 UltraGoal로 고정한 채 구현합니다.',
        },
        {
          title: 'Incident response',
          body: '시도한 가설과 증거를 남기며 루트 원인에 집중합니다.',
        },
        {
          title: 'Knowledge carry-over',
          body: '검증된 결정을 LLM Wiki와 Recall에 남겨 다음 세션이 같은 출발점에서 시작합니다.',
        },
      ],
    },
    solution: {
      kicker: 'Operator path',
      title: 'Shift-Tab 한 번으로 Ultrawork',
      body: '가벼운 질문은 일반 프롬프트로, 복잡한 작업은 인터랙티브 세션에서 Ultrawork로 전환합니다. research → UltraPlan interview → UltraGoal → research loop → Swarm decision → integrate → verify → learn 순서로 진행합니다.',
      note: 'Shift + Tab · /ultrawork · liora --plan',
    },
    terminal: [
      { cmd: 'liora --version', output: 'SuperLiora 0.20.1' },
      { cmd: 'liora', output: 'Interactive session ready · Blood Moon TUI' },
      { cmd: 'liora --plan', output: 'Plan steering on · UltraPlan interview armed' },
      {
        cmd: 'liora -p "/ultrawork harden auth refresh path"',
        output: 'Ultrawork: research → interview → goal → swarm → verify',
      },
      { cmd: 'liora --continue', output: 'Resumed last session in cwd' },
      { cmd: 'liora server run --foreground', output: 'Server listening on 127.0.0.1:58627' },
      { cmd: 'liora provider list', output: 'Routes ranked by quota · cooldown · latency' },
    ],
    ultra: {
      kicker: 'Ultrawork spine',
      title: '조사에서 학습까지 끊기지 않는 실행 구조',
      body: 'Ultrawork는 모호한 요청을 인터뷰로 좁히고, 검증 가능한 목표를 잠근 뒤, 필요하면 Swarm을 켜고, 통합·검증·학습까지 한 런으로 남깁니다.',
      copyTitle: 'Research → Plan → Goal → Swarm → Verify → Learn',
      copyBody:
        '각 단계는 이전 단계의 산출물을 입력으로 받습니다. 리스크가 크면 UltraSwarm ENGAGE, 단독으로 충분하면 DEFER. 완료는 테스트·런타임 증거로 닫습니다.',
      copyList: [
        'UltraPlan interview로 요구·제약·비목표·위험을 true/false 기준까지 좁힙니다.',
        'UltraGoal이 목표, 예산, acceptance criteria를 고정합니다.',
        'UltraSwarm은 ENGAGE/DEFER를 먼저 기록한 뒤 specialist를 붙입니다.',
        'Learn 단계에서 프로젝트 로컬 LLM Wiki와 필요한 Recall 항목을 갱신합니다.',
      ],
      steps: [
        { num: '01', title: 'Research', body: 'API, 릴리스 노트, 코드 사실을 먼저 확인합니다.' },
        { num: '02', title: 'Plan', body: 'UltraPlan interview로 요구를 검증 가능하게 만듭니다.' },
        { num: '03', title: 'Goal', body: 'UltraGoal로 완료 기준과 예산을 잠급니다.' },
        { num: '04', title: 'Swarm', body: 'ENGAGE/DEFER 뒤 전문 에이전트를 배치합니다.' },
        { num: '05', title: 'Verify', body: '테스트, 런타임, 레드팀으로 닫습니다.' },
        { num: '06', title: 'Learn', body: 'Wiki·Recall에 검증된 지식만 남깁니다.' },
      ],
    },
    harness: {
      kicker: 'Full harness',
      title: '코드 밖 표면까지 같은 권한·기억 모델로',
      body: 'Browser-use와 computer-use는 부가 기능이 아니라 하네스의 일부입니다. provider routing, Context OS, ACP, Premium Quality가 같은 세션 상태를 공유합니다.',
      copyTitle: '웹, 데스크톱, 에디터를 한 터미널에서',
      copyBody:
        'CloakBrowser + Playwright로 페이지를 관찰·조작하고, CUA/MCP로 네이티브 창을 캡처합니다. quota·cooldown·latency 기반 fallback으로 모델을 고르고, ACP로 IDE에 같은 워크플로를 노출합니다.',
      copyList: [
        'Browser-use: CloakBrowser + Playwright 웹 자동화',
        'Computer-use: CUA/MCP 네이티브 데스크톱 제어',
        'Provider routing: 경로 건강·할당량 기준 fallback',
        'ACP + Premium Quality: IDE 연동과 시각 품질 게이트',
      ],
    },
    memory: {
      kicker: 'Memory stack',
      title: '세션이 끝나도 맥락이 남습니다',
      body: 'Context OS가 긴 대화를 압축·복구하고, Liora Recall이 장기 기억을 관리하며, LLM Wiki가 프로젝트 로컬 검토 문서를 만듭니다. 코드와 테스트가 최종 진실입니다.',
      cards: [
        {
          title: 'Context OS',
          body: 'structured working memory, repair, bounded rehydration으로 긴 세션 연속성을 유지합니다.',
        },
        {
          title: 'Liora Recall',
          body: 'semantic · episodic · procedural · prospective 기억을 검색 가능하게 보관합니다.',
        },
        {
          title: 'LLM Wiki',
          body: 'Ultrawork 런 근거와 코드 지식을 프로젝트 로컬 위키로 남겨 사람이 검토합니다.',
        },
      ],
    },
    themes: {
      kicker: 'Premium TUI',
      title: 'Blood Moon 조종석으로 터미널을 맞춥니다',
      body: 'Blood Moon 기본 다크, Daylight 라이트, 코드/장시간 세션용 보조 팔레트를 지원합니다. 키보드 중심 탐색과 세션 시각 디버깅(vis)을 함께 제공합니다.',
      cards: [
        {
          title: 'Blood Moon',
          body: '기본 다크. #E63946 primary, 시네마틱 대비, 장시간 상태 가독성.',
          swatches: ['#0B0B0C', '#E63946', '#ECEAE7', '#34D399'],
        },
        {
          title: 'Daylight',
          body: '오프화이트 라이트 테마. 문서·리뷰 작업용 높은 가독성.',
          swatches: ['#F4F1EC', '#C62828', '#161513', '#166534'],
        },
        {
          title: 'Prism Syntax',
          body: '구문 강조 중심 팔레트. 코드 밀도가 높은 작업에 맞춤.',
          swatches: ['#10131A', '#E63946', '#F5B041', '#A78BFA'],
        },
        {
          title: 'Recall Green',
          body: '장시간 세션용 저자극 그린 계열. 눈 피로를 줄입니다.',
          swatches: ['#0C1210', '#34D399', '#A8A6A1', '#E63946'],
        },
      ],
    },
    capabilities: {
      kicker: 'Capability map',
      title: '긴 세션을 일관되게 만드는 표면들',
      body: '아래는 코드에 실제로 존재하는 SuperLiora 표면입니다. 마케팅용 가상 기능이 아닙니다.',
      items: [
        {
          title: 'UltraPlan',
          tag: 'interview',
          body: '목표가 true/false로 검증 가능해질 때까지 요구·제약·위험을 인터뷰합니다.',
        },
        {
          title: 'UltraResearch',
          tag: 'evidence',
          body: 'API, 논문, 릴리스 노트, 보안 권고를 확인하고 근거를 남깁니다.',
        },
        {
          title: 'UltraGoal',
          tag: 'budget',
          body: '조사 뒤 목표와 예산, acceptance criteria를 잠급니다.',
        },
        {
          title: 'UltraSwarm',
          tag: 'parallel',
          body: '최대 128 specialist를 ENGAGE/DEFER gate 뒤에서 운용합니다.',
        },
        {
          title: 'Context OS',
          tag: 'session',
          body: 'compaction, working memory, continuity repair, rehydration.',
        },
        {
          title: 'Liora Recall',
          tag: 'memory',
          body: 'semantic · episodic · procedural · prospective 장기 기억.',
        },
        {
          title: 'Browser-use',
          tag: 'web',
          body: 'CloakBrowser + Playwright로 페이지를 관찰하고 조작합니다.',
        },
        {
          title: 'Computer-use',
          tag: 'desktop',
          body: 'CUA/MCP로 네이티브 데스크톱을 캡처하고 조작합니다.',
        },
        {
          title: 'Provider routing',
          tag: 'fallback',
          body: 'quota, cooldown, latency, route health로 fallback 후보를 고릅니다.',
        },
        {
          title: 'LLM Wiki',
          tag: 'docs',
          body: '코드베이스 지식과 검증 근거를 프로젝트 로컬 위키로 남깁니다.',
        },
        {
          title: 'Premium TUI',
          tag: 'cockpit',
          body: 'Blood Moon / Daylight 팔레트와 키보드 중심 네비게이션.',
        },
        {
          title: 'ACP',
          tag: 'ide',
          body: '같은 SuperLiora workflow를 stdio로 ACP 호환 에디터에 노출합니다.',
        },
      ],
    },
    install: {
      kicker: 'Install',
      title: '수 분 안에 조종석을 띄웁니다',
      body: '공식 설치 스크립트 또는 소스 빌드. Node.js ≥24.15.0, pnpm 10.33.0(Corepack)이 필요합니다.',
      cta: '저장소 열기',
      requirements: 'Node.js ≥24.15.0 · pnpm 10.33.0 · macOS / Linux / Windows',
      commands: [
        {
          label: 'macOS / Linux',
          cmd: 'curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash',
        },
        {
          label: 'Windows PowerShell',
          cmd: 'irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex',
        },
        { label: '버전 확인', cmd: 'liora --version' },
        { label: 'Plan mode', cmd: 'liora --plan' },
      ],
    },
    cta: {
      title: '복잡한 작업도 한 흐름으로 끝까지',
      body: 'SuperLiora를 설치하고 Blood Moon 조종석에서 첫 Ultrawork 세션을 시작하세요.',
      install: '지금 설치',
      github: 'GitHub 보기',
    },
    footer: {
      copyright: '© SuperLiora Contributors · MIT',
      github: 'GitHub',
      english: 'English',
      korean: '한국어',
      issues: 'Issues',
      security: 'Security',
      docs: 'Reference docs',
    },
  },
  en: {
    lang: 'en',
    dir: 'ltr',
    meta: {
      title: 'SuperLiora — Blood Moon terminal AI coding harness',
      description:
        'SuperLiora is a Blood Moon (#E63946) terminal AI coding harness. Ultrawork binds research, planning, goals, swarm execution, verification, and learning — with Liora Recall, LLM Wiki, browser-use, and computer-use in one cockpit.',
      ogLocale: 'en_US',
    },
    skip: 'Skip to main content',
    nav: {
      workflow: 'Ultrawork',
      harness: 'Harness',
      memory: 'Memory',
      capabilities: 'Capabilities',
      install: 'Install',
    },
    hero: {
      eyebrow: 'Blood Moon · terminal harness v0.20.1',
      h1: 'Carry long development work to the finish in your terminal',
      lead:
        'SuperLiora binds planning, research, goals, parallel execution, verification, memory, documentation, browser-use, and computer-use into one Ultrawork flow. The Blood Moon palette keeps dense status readable without losing evidence.',
      install: 'Install',
      github: 'GitHub',
      secondary: 'Live demo',
      stats: [
        { value: '0.20.1', label: 'liora release' },
        { value: '128', label: 'max specialists' },
        { value: '7', label: 'Ultrawork stages' },
        { value: 'MIT', label: 'open license' },
      ],
      chips: [
        {
          title: 'UltraPlan',
          body: 'Interview requirements until the goal is true/false verifiable.',
        },
        {
          title: 'UltraSwarm',
          body: 'Run up to 128 specialists behind an ENGAGE/DEFER gate.',
        },
        {
          title: 'Liora Recall',
          body: 'Keep semantic, episodic, procedural, and prospective memory durable.',
        },
        {
          title: 'Browser + Desktop',
          body: 'Call CloakBrowser/Playwright and CUA/MCP from the same harness.',
        },
      ],
    },
    problem: {
      kicker: 'Friction',
      title: 'Long work fails when goals, evidence, and context drift first',
      body: 'Migrations, refactors, and incidents blur completion criteria mid-flight and force the same investigation twice. More tools often mean more broken flow and scattered decisions.',
      cases: [
        {
          title: 'Migration & refactor',
          body: 'Keep scope, plan, and verification commands alive in one session.',
        },
        {
          title: 'Feature delivery',
          body: 'Lock requirements and acceptance criteria with UltraGoal while you build.',
        },
        {
          title: 'Incident response',
          body: 'Record hypotheses and evidence while you chase the root cause.',
        },
        {
          title: 'Knowledge carry-over',
          body: 'Leave verified decisions in LLM Wiki and Recall so the next session starts warm.',
        },
      ],
    },
    solution: {
      kicker: 'Operator path',
      title: 'One Shift-Tab into Ultrawork',
      body: 'Use normal prompts for light questions. For hard work, flip Ultrawork inside an interactive session: research → UltraPlan interview → UltraGoal → research loop → Swarm decision → integrate → verify → learn.',
      note: 'Shift + Tab · /ultrawork · liora --plan',
    },
    terminal: [
      { cmd: 'liora --version', output: 'SuperLiora 0.20.1' },
      { cmd: 'liora', output: 'Interactive session ready · Blood Moon TUI' },
      { cmd: 'liora --plan', output: 'Plan steering on · UltraPlan interview armed' },
      {
        cmd: 'liora -p "/ultrawork harden auth refresh path"',
        output: 'Ultrawork: research → interview → goal → swarm → verify',
      },
      { cmd: 'liora --continue', output: 'Resumed last session in cwd' },
      { cmd: 'liora server run --foreground', output: 'Server listening on 127.0.0.1:58627' },
      { cmd: 'liora provider list', output: 'Routes ranked by quota · cooldown · latency' },
    ],
    ultra: {
      kicker: 'Ultrawork spine',
      title: 'An execution structure that does not drop the thread',
      body: 'Ultrawork narrows fuzzy asks with an interview, locks a verifiable goal, engages Swarm only when needed, then closes with integrate, verify, and learn — as one durable run.',
      copyTitle: 'Research → Plan → Goal → Swarm → Verify → Learn',
      copyBody:
        'Each stage consumes the previous artifact. High risk means UltraSwarm ENGAGE; otherwise DEFER. Completion is closed with tests and runtime evidence.',
      copyList: [
        'UltraPlan interview narrows requirements, constraints, non-goals, and risks to true/false criteria.',
        'UltraGoal locks objectives, budgets, and acceptance criteria.',
        'UltraSwarm records ENGAGE/DEFER first, then attaches specialists.',
        'Learn updates the project-local LLM Wiki and only the Recall facts that deserve durability.',
      ],
      steps: [
        { num: '01', title: 'Research', body: 'Ground in APIs, release notes, and code facts.' },
        { num: '02', title: 'Plan', body: 'Make the ask verifiable with UltraPlan interview.' },
        { num: '03', title: 'Goal', body: 'Lock completion criteria and budget with UltraGoal.' },
        { num: '04', title: 'Swarm', body: 'Place specialists after ENGAGE/DEFER.' },
        { num: '05', title: 'Verify', body: 'Close with tests, runtime, and red-team checks.' },
        { num: '06', title: 'Learn', body: 'Write only verified knowledge into Wiki/Recall.' },
      ],
    },
    harness: {
      kicker: 'Full harness',
      title: 'Surfaces beyond code, same permission and memory model',
      body: 'Browser-use and computer-use are part of the harness, not bolt-ons. Provider routing, Context OS, ACP, and Premium Quality share the same session state.',
      copyTitle: 'Web, desktop, and editors from one terminal',
      copyBody:
        'Observe and drive pages with CloakBrowser + Playwright. Capture native windows with CUA/MCP. Pick models by quota, cooldown, and latency. Expose the same workflow to IDEs over ACP.',
      copyList: [
        'Browser-use: CloakBrowser + Playwright web automation',
        'Computer-use: CUA/MCP native desktop control',
        'Provider routing: health- and quota-aware fallback',
        'ACP + Premium Quality: IDE bridge and visual quality gate',
      ],
    },
    memory: {
      kicker: 'Memory stack',
      title: 'Context that survives the session boundary',
      body: 'Context OS compresses and repairs long chats, Liora Recall stores durable memory, and LLM Wiki leaves project-local review docs. Code and tests remain the final source of truth.',
      cards: [
        {
          title: 'Context OS',
          body: 'Structured working memory, repair, and bounded rehydration for long-session continuity.',
        },
        {
          title: 'Liora Recall',
          body: 'Searchable semantic, episodic, procedural, and prospective memory.',
        },
        {
          title: 'LLM Wiki',
          body: 'Project-local Ultrawork evidence and codebase knowledge for human review.',
        },
      ],
    },
    themes: {
      kicker: 'Premium TUI',
      title: 'Tune the terminal as a Blood Moon cockpit',
      body: 'Blood Moon dark by default, Daylight for light review work, plus helper palettes for dense code and long sessions. Keyboard-first navigation and session visual debugging (vis) ship with the harness.',
      cards: [
        {
          title: 'Blood Moon',
          body: 'Default dark. #E63946 primary, cinematic contrast, dense status readability.',
          swatches: ['#0B0B0C', '#E63946', '#ECEAE7', '#34D399'],
        },
        {
          title: 'Daylight',
          body: 'Off-white light theme for docs and review-heavy work.',
          swatches: ['#F4F1EC', '#C62828', '#161513', '#166534'],
        },
        {
          title: 'Prism Syntax',
          body: 'Syntax-forward palette for high code density.',
          swatches: ['#10131A', '#E63946', '#F5B041', '#A78BFA'],
        },
        {
          title: 'Recall Green',
          body: 'Lower-stimulus green lean for long sessions.',
          swatches: ['#0C1210', '#34D399', '#A8A6A1', '#E63946'],
        },
      ],
    },
    capabilities: {
      kicker: 'Capability map',
      title: 'Surfaces that keep long sessions coherent',
      body: 'These are real SuperLiora surfaces present in the monorepo — not brochure fiction.',
      items: [
        {
          title: 'UltraPlan',
          tag: 'interview',
          body: 'Interview requirements until the goal is true/false verifiable.',
        },
        {
          title: 'UltraResearch',
          tag: 'evidence',
          body: 'Check APIs, papers, release notes, and advisories; leave citations.',
        },
        {
          title: 'UltraGoal',
          tag: 'budget',
          body: 'Lock objectives, budgets, and acceptance criteria after research.',
        },
        {
          title: 'UltraSwarm',
          tag: 'parallel',
          body: 'Run up to 128 specialists behind ENGAGE/DEFER.',
        },
        {
          title: 'Context OS',
          tag: 'session',
          body: 'Compaction, working memory, continuity repair, rehydration.',
        },
        {
          title: 'Liora Recall',
          tag: 'memory',
          body: 'Semantic, episodic, procedural, and prospective durable memory.',
        },
        {
          title: 'Browser-use',
          tag: 'web',
          body: 'Observe and drive pages with CloakBrowser + Playwright.',
        },
        {
          title: 'Computer-use',
          tag: 'desktop',
          body: 'Capture and control native desktops with CUA/MCP.',
        },
        {
          title: 'Provider routing',
          tag: 'fallback',
          body: 'Choose fallbacks by quota, cooldown, latency, and route health.',
        },
        {
          title: 'LLM Wiki',
          tag: 'docs',
          body: 'Turn codebase knowledge and verification evidence into a local wiki.',
        },
        {
          title: 'Premium TUI',
          tag: 'cockpit',
          body: 'Blood Moon / Daylight palettes with keyboard-first navigation.',
        },
        {
          title: 'ACP',
          tag: 'ide',
          body: 'Expose the same workflow over stdio to ACP-compatible editors.',
        },
      ],
    },
    install: {
      kicker: 'Install',
      title: 'Bring the cockpit up in minutes',
      body: 'Use the official install scripts or build from source. Requires Node.js ≥24.15.0 and pnpm 10.33.0 with Corepack.',
      cta: 'Open repository',
      requirements: 'Node.js ≥24.15.0 · pnpm 10.33.0 · macOS / Linux / Windows',
      commands: [
        {
          label: 'macOS / Linux',
          cmd: 'curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash',
        },
        {
          label: 'Windows PowerShell',
          cmd: 'irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex',
        },
        { label: 'Version check', cmd: 'liora --version' },
        { label: 'Plan mode', cmd: 'liora --plan' },
      ],
    },
    cta: {
      title: 'One flow from first ask to verified finish',
      body: 'Install SuperLiora and start your first Ultrawork session from the Blood Moon cockpit.',
      install: 'Install now',
      github: 'View on GitHub',
    },
    footer: {
      copyright: '© SuperLiora Contributors · MIT',
      github: 'GitHub',
      english: 'English',
      korean: '한국어',
      issues: 'Issues',
      security: 'Security',
      docs: 'Reference docs',
    },
  },
};

export const defaultLang: Lang = 'ko';
