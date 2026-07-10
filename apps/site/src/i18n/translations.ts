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
}

export interface FeatureItem {
  title: string;
  body: string;
}

export interface InstallCommand {
  label: string;
  cmd: string;
}

export interface TerminalStep {
  cmd: string;
  output: string;
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
    harness: string;
    ultra: string;
    memory: string;
    themes: string;
    install: string;
  };
  hero: {
    eyebrow: string;
    h1: string;
    lead: string;
    install: string;
    github: string;
    stats: string[];
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
    copyList: string[];
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
    items: FeatureItem[];
  };
  install: {
    kicker: string;
    title: string;
    body: string;
    cta: string;
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
    issues: string;
    security: string;
  };
}

export const translations: Record<Lang, Translation> = {
  ko: {
    lang: 'ko',
    dir: 'ltr',
    meta: {
      title: 'SuperLiora - 터미널 중심 AI 코딩 하네스',
      description:
        'SuperLiora는 터미널에서 실행하는 독립형 AI 코딩 하네스입니다. 계획, 조사, 목표 관리, 병렬 실행, 검증, 기억, 문서화를 하나로 연결합니다.',
      ogLocale: 'ko_KR',
    },
    skip: '본문으로 이동',
    nav: {
      harness: 'Harness',
      ultra: 'Ultra System',
      memory: 'Memory & Wiki',
      themes: 'Themes',
      install: 'Install',
    },
    hero: {
      eyebrow: 'AI coding harness',
      h1: '길고 복잡한 개발 흐름을 터미널에서 끝까지 이어가는 하네스',
      lead: 'SuperLiora는 계획, 조사, 목표 관리, 병렬 실행, 검증, 기억, 문서화, 브라우저/컴퓨터 사용을 하나의 작업 흐름으로 연결합니다. 긴 세션에서도 맥락을 보존하고, 근거 있는 결정을 남기며, 개발자가 다음 단계에 집중할 수 있도록 돕습니다.',
      install: '바로 설치',
      github: 'GitHub 보기',
      stats: ['v0.20.1', 'MIT 라이선스', '12개 핵심 기능', 'Node.js >= 24'],
    },
    problem: {
      kicker: 'Problem',
      title: '긴 작업은 맥락을 잃고, 결정은 흩어집니다',
      body: '복잡한 구현, 마이그레이션, 리팩터링은 중간에 목표가 흐려지고, 근거가 사라지며, 같은 질문을 반복하게 됩니다. 도구가 많아질수록 오히려 흐름이 끊깁니다.',
      cases: [
        {
          title: 'Migration & refactoring',
          body: '대규모 변경에서 계획, 영향 범위, 검증을 하나의 흐름으로 유지합니다.',
        },
        {
          title: 'Feature implementation',
          body: '요구사항을 명확히 고정하고, 구현 중에도 완료 기준을 잃지 않습니다.',
        },
        {
          title: 'Incident & debugging',
          body: '조사 근거와 시도한 방법을 정리하며 루트 원인에 집중합니다.',
        },
        {
          title: 'Documentation & knowledge',
          body: '검증된 결정을 다음 작업에서 다시 사용할 수 있는 자산으로 남깁니다.',
        },
      ],
    },
    solution: {
      kicker: 'Solution',
      title: 'Shift-Tab 한 번으로 Ultrawork 시작',
      body: '일반 프롬프트는 가볍게, 복잡한 작업은 인터랙티브 세션 안에서 Ultrawork로 전환합니다. UltraPlan interview부터 research, Swarm decision, verification, learning까지 이어집니다.',
    },
    terminal: [
      { cmd: 'liora --version', output: 'SuperLiora 0.20.1' },
      { cmd: 'liora', output: 'Interactive session started.' },
      { cmd: 'liora --plan', output: 'Plan mode enabled. UltraPlan interview ready.' },
      { cmd: 'liora -p "explain this repo"', output: 'Single-turn answer returned.' },
      { cmd: 'liora --continue', output: 'Resumed last session in cwd.' },
      { cmd: 'liora server run --foreground', output: 'Server listening on 127.0.0.1:58627' },
      { cmd: 'liora provider list', output: 'Available models and credentials.' },
    ],
    ultra: {
      kicker: 'Ultra workflow',
      title: '계획부터 검증까지 이어지는 실행 구조',
      body: '인터랙티브 세션에서 Shift-Tab Ultrawork mode는 복잡한 요청을 UltraPlan interview로 먼저 좁히고, true/false로 검증 가능한 목표를 만든 뒤 research, Swarm decision, integration, verification 순서로 진행합니다.',
      copyTitle: 'Plan → Goal → Research → Swarm → Verify → Learn',
      copyBody:
        '각 단계는 이전 단계의 결과를 근거로 시작하며, 완료 여부를 명확히 기록합니다. 모호한 목표는 UltraPlan interview로 구체화되고, 리스크가 큰 결정은 Swarm gate를 통과합니다.',
      copyList: [
        'UltraPlan interview로 요구사항, 제약, 위험을 끝까지 좁힙니다.',
        'UltraGoal로 구체적 목표와 검증 기준을 고정합니다.',
        'UltraSwarm에서 ENGAGE/DEFER 결정을 먼저 기록합니다.',
      ],
      steps: [
        { num: '01', title: 'Plan', body: '요구를 정리합니다.' },
        { num: '02', title: 'Goal', body: '완료 기준을 고정합니다.' },
        { num: '03', title: 'Research', body: '근거를 확인합니다.' },
        { num: '04', title: 'Swarm', body: '전문가를 투입합니다.' },
        { num: '05', title: 'Verify', body: '테스트와 위험을 점검합니다.' },
        { num: '06', title: 'Learn', body: '검증된 지식을 남깁니다.' },
      ],
    },
    harness: {
      kicker: 'Harness capabilities',
      title: '브라우저와 데스크톱까지 같은 흐름에 담습니다',
      body: 'SuperLiora는 에디터 안에서 끝나지 않습니다. CloakBrowser + Playwright로 웹을 탐색하고, CUA/MCP로 네이티브 데스크톱을 조작하며, provider routing, context, memory, ACP를 같은 하네스에서 다룹니다.',
      copyTitle: '하나의 터미널에서 웹, 데스크톱, 코드 모두 다루기',
      copyBody:
        'Browser-use와 computer-use는 별도 도구가 아니라 동일한 harness의 일부입니다. 권한, 기억, 검증 모델을 공유하며 작업 맥락을 유지합니다.',
      copyList: [
        'CloakBrowser + Playwright로 웹 기반 흐름을 관찰하고 조작합니다.',
        'CUA/MCP로 네이티브 창을 캡처하고 클릭, 입력, 드래그를 수행합니다.',
        'Provider routing으로 quota, cooldown, latency를 기준으로 fallback합니다.',
      ],
    },
    memory: {
      kicker: 'Memory & LLM Wiki',
      title: '작업의 맥락을 기록하고 다시 활용합니다',
      body: 'Liora Recall은 프로젝트 사실, 결정, 절차, 후속 작업을 기억합니다. LLM Wiki는 코드베이스와 검증 근거를 문서화해 다음 작업이 같은 출발점을 공유하도록 돕습니다.',
      copyList: [
        'Semantic memory: 프로젝트 구조, API 제약, 운영 규칙.',
        'Procedural memory: 빌드, 배포, 검증 루틴.',
        'Governance memory: 정책, 하드 제약, 의사결정 기록.',
      ],
    },
    themes: {
      kicker: 'Premium TUI',
      title: '터미널도 개발자에게 맞춘 조종석이 됩니다',
      body: 'Neon Noir, Daylight, Prism Syntax, Recall Green, Executive Gold 등 팔레트를 바꾸고 외부 터미널 색상을 가져올 수 있습니다. 키보드 중심 탐색과 세션별 시각 디버깅을 지원합니다.',
      cards: [
        {
          title: 'Neon Operator',
          body: '기본 다크 팔레트. 높은 대비와 시네마틱한 강조색.',
        },
        {
          title: 'Prism Syntax',
          body: '코드 중심 작업에 최적화된 구문 강조 팔레트.',
        },
        {
          title: 'Recall Green',
          body: '장시간 세션에서 눈의 피로를 줄이는 녹색 계열.',
        },
        {
          title: 'Executive Gold',
          body: '덜 붉은 앰버 계열로 전환한 고급스러운 라이트 팔레트.',
        },
      ],
    },
    capabilities: {
      kicker: 'Capabilities',
      title: '긴 세션을 일관되게 만드는 핵심 기능',
      items: [
        { title: 'UltraPlan', body: '목표가 true/false로 검증 가능해질 때까지 요구사항을 인터뷰합니다.' },
        { title: 'UltraResearch', body: 'API, 논문, 릴리스 노트, 보안 권고를 확인하고 근거를 남깁니다.' },
        { title: 'UltraGoal', body: '조사 근거를 반영한 계획 뒤에 목표와 예산을 고정합니다.' },
        { title: 'UltraSwarm', body: '최대 128개의 specialist subagent를 ENGAGE/DEFER gate와 함께 운용합니다.' },
        { title: 'Context OS', body: 'structured working memory, repair, bounded rehydration으로 세션을 관리합니다.' },
        { title: 'Liora Recall', body: 'semantic, episodic, procedural, prospective, governance memory를 보존합니다.' },
        { title: 'Browser-use', body: 'CloakBrowser + Playwright로 웹 페이지를 관찰하고 조작합니다.' },
        { title: 'Computer-use', body: 'CUA/MCP로 네이티브 데스크톱을 캡처하고 조작합니다.' },
        { title: 'Provider routing', body: 'quota, cooldown, latency, route health를 기준으로 fallback 후보를 선택합니다.' },
        { title: 'LLM Wiki', body: '코드베이스 지식과 검증 근거를 프로젝트 로컬에서 검토할 수 있는 위키로 전환합니다.' },
        { title: 'Premium TUI', body: 'Neon Noir / Daylight 팔레트와 키보드 중심 탐색으로 터미널 작업 환경을 조종합니다.' },
        { title: 'ACP', body: '동일한 SuperLiora workflow를 stdio로 ACP 호환 editor와 IDE에 노출합니다.' },
      ],
    },
    install: {
      kicker: 'Install',
      title: '소스에서 설치',
      body: 'GitHub 저장소를 clone하고 빌드합니다. Node.js >=24.15.0과 Corepack이 설치된 pnpm 10.33.0이 필요합니다.',
      cta: 'GitHub 보기',
      commands: [
        { label: 'curl install', cmd: 'curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash' },
        { label: 'powershell install', cmd: 'irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex' },
        { label: 'version check', cmd: 'liora --version' },
      ],
    },
    cta: {
      title: '복잡한 작업도 한 흐름으로 끝까지',
      body: 'SuperLiora를 설치하고 첫 Ultrawork session을 시작해 보세요.',
      install: '지금 설치',
      github: 'GitHub 보기',
    },
    footer: {
      copyright: '© SuperLiora Contributors. MIT License.',
      github: 'GitHub',
      english: 'English',
      issues: 'Issues',
      security: 'Security',
    },
  },
  en: {
    lang: 'en',
    dir: 'ltr',
    meta: {
      title: 'SuperLiora - Terminal-Centric AI Coding Harness',
      description:
        'SuperLiora is a self-contained AI coding harness that runs in your terminal. It connects planning, research, goal management, parallel execution, verification, memory, and documentation into one workflow.',
      ogLocale: 'en_US',
    },
    skip: 'Skip to main content',
    nav: {
      harness: 'Harness',
      ultra: 'Ultra System',
      memory: 'Memory & Wiki',
      themes: 'Themes',
      install: 'Install',
    },
    hero: {
      eyebrow: 'AI coding harness',
      h1: 'A terminal harness that carries long, complex development flows to the finish line',
      lead: 'SuperLiora connects planning, research, goal management, parallel execution, verification, memory, documentation, browser, and computer use into one workflow. It preserves context across long sessions, leaves evidence-backed decisions, and helps developers focus on the next step.',
      install: 'Install now',
      github: 'View on GitHub',
      stats: ['v0.20.1', 'MIT License', '12 capabilities', 'Node.js >= 24'],
    },
    problem: {
      kicker: 'Problem',
      title: 'Long work loses context, and decisions scatter',
      body: 'Complex implementations, migrations, and refactoring blur goals mid-flight, erase rationale, and force the same questions again. More tools often mean more broken flow.',
      cases: [
        {
          title: 'Migration & refactoring',
          body: 'Keep plan, scope, and verification in a single flow for large-scale changes.',
        },
        {
          title: 'Feature implementation',
          body: 'Lock requirements and keep completion criteria visible while you build.',
        },
        {
          title: 'Incident & debugging',
          body: 'Organize investigation evidence and attempted fixes to focus on root cause.',
        },
        {
          title: 'Documentation & knowledge',
          body: 'Turn verified decisions into reusable assets for the next session.',
        },
      ],
    },
    solution: {
      kicker: 'Solution',
      title: 'Start Ultrawork with one Shift-Tab',
      body: 'Use normal prompts for light tasks, and switch to Ultrawork inside an interactive session for complex ones. From UltraPlan interview through research, Swarm decision, verification, and learning.',
    },
    terminal: [
      { cmd: 'liora --version', output: 'SuperLiora 0.20.1' },
      { cmd: 'liora', output: 'Interactive session started.' },
      { cmd: 'liora --plan', output: 'Plan mode enabled. UltraPlan interview ready.' },
      { cmd: 'liora -p "explain this repo"', output: 'Single-turn answer returned.' },
      { cmd: 'liora --continue', output: 'Resumed last session in cwd.' },
      { cmd: 'liora server run --foreground', output: 'Server listening on 127.0.0.1:58627' },
      { cmd: 'liora provider list', output: 'Available models and credentials.' },
    ],
    ultra: {
      kicker: 'Ultra workflow',
      title: 'An execution structure from plan to verification',
      body: 'Inside an interactive session, Shift-Tab Ultrawork mode first narrows complex requests with an UltraPlan interview, creates a true/false verifiable goal, then proceeds through research, Swarm decision, integration, and verification.',
      copyTitle: 'Plan → Goal → Research → Swarm → Verify → Learn',
      copyBody:
        'Each stage starts from the previous result and records completion clearly. Fuzzy goals are sharpened by the UltraPlan interview, and high-risk decisions pass through the Swarm gate.',
      copyList: [
        'UltraPlan interview narrows requirements, constraints, and risks.',
        'UltraGoal locks concrete objectives and verification criteria.',
        'UltraSwarm records the ENGAGE/DEFER decision first.',
      ],
      steps: [
        { num: '01', title: 'Plan', body: 'Clarify the request.' },
        { num: '02', title: 'Goal', body: 'Lock completion criteria.' },
        { num: '03', title: 'Research', body: 'Confirm the evidence.' },
        { num: '04', title: 'Swarm', body: 'Engage specialists.' },
        { num: '05', title: 'Verify', body: 'Check tests and risks.' },
        { num: '06', title: 'Learn', body: 'Leave verified knowledge.' },
      ],
    },
    harness: {
      kicker: 'Harness capabilities',
      title: 'Bring browser and desktop into the same flow',
      body: 'SuperLiora does not stop inside the editor. It explores the web with CloakBrowser + Playwright, manipulates native desktops with CUA/MCP, and handles provider routing, context, memory, and ACP in the same harness.',
      copyTitle: 'Handle web, desktop, and code from one terminal',
      copyBody:
        'Browser-use and computer-use are not separate tools; they are part of the same harness. They share permissions, memory, and verification models to keep work context intact.',
      copyList: [
        'CloakBrowser + Playwright observe and manipulate web flows.',
        'CUA/MCP capture native windows and perform clicks, input, and drag.',
        'Provider routing falls back by quota, cooldown, and latency.',
      ],
    },
    memory: {
      kicker: 'Memory & LLM Wiki',
      title: 'Record context and reuse it',
      body: 'Liora Recall remembers project facts, decisions, procedures, and follow-ups. LLM Wiki documents codebase knowledge and verification evidence so the next session starts from the same baseline.',
      copyList: [
        'Semantic memory: project structure, API constraints, operational rules.',
        'Procedural memory: build, deploy, and verification routines.',
        'Governance memory: policies, hard constraints, decision records.',
      ],
    },
    themes: {
      kicker: 'Premium TUI',
      title: 'Make the terminal a cockpit tuned for the developer',
      body: 'Switch palettes such as Neon Noir, Daylight, Prism Syntax, Recall Green, and Executive Gold, or import external terminal colors. Keyboard-first navigation and per-session visual debugging are built in.',
      cards: [
        {
          title: 'Neon Operator',
          body: 'The default dark palette. High contrast and cinematic accents.',
        },
        {
          title: 'Prism Syntax',
          body: 'A syntax-highlighting palette optimized for code-heavy work.',
        },
        {
          title: 'Recall Green',
          body: 'A green-leaning scheme that reduces eye strain in long sessions.',
        },
        {
          title: 'Executive Gold',
          body: 'A luxurious light palette shifted toward a less red amber.',
        },
      ],
    },
    capabilities: {
      kicker: 'Capabilities',
      title: 'Core capabilities that keep long sessions consistent',
      items: [
        { title: 'UltraPlan', body: 'Interview requirements until the goal becomes true/false verifiable.' },
        { title: 'UltraResearch', body: 'Check APIs, papers, release notes, and security advisories, then cite evidence.' },
        { title: 'UltraGoal', body: 'Lock objectives and budgets after the research-backed plan.' },
        { title: 'UltraSwarm', body: 'Run up to 128 specialist subagents behind an ENGAGE/DEFER gate.' },
        { title: 'Context OS', body: 'Manage sessions with structured working memory, repair, and bounded rehydration.' },
        { title: 'Liora Recall', body: 'Preserve semantic, episodic, procedural, prospective, and governance memory.' },
        { title: 'Browser-use', body: 'Observe and manipulate web pages with CloakBrowser + Playwright.' },
        { title: 'Computer-use', body: 'Capture and manipulate native desktops with CUA/MCP.' },
        { title: 'Provider routing', body: 'Choose fallback candidates by quota, cooldown, latency, and route health.' },
        { title: 'LLM Wiki', body: 'Turn codebase knowledge and verification evidence into a local project wiki.' },
        { title: 'Premium TUI', body: 'Pilot the terminal with Neon Noir / Daylight palettes and keyboard-first navigation.' },
        { title: 'ACP', body: 'Expose the same SuperLiora workflow over stdio to ACP-compatible editors and IDEs.' },
      ],
    },
    install: {
      kicker: 'Install',
      title: 'Install from source',
      body: 'Clone the GitHub repository and build. Requires Node.js >=24.15.0 and pnpm 10.33.0 with Corepack enabled.',
      cta: 'View on GitHub',
      commands: [
        { label: 'curl install', cmd: 'curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash' },
        { label: 'powershell install', cmd: 'irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex' },
        { label: 'version check', cmd: 'liora --version' },
      ],
    },
    cta: {
      title: 'One flow from start to finish, even for complex work',
      body: 'Install SuperLiora and start your first Ultrawork session.',
      install: 'Install now',
      github: 'View on GitHub',
    },
    footer: {
      copyright: '© SuperLiora Contributors. MIT License.',
      github: 'GitHub',
      english: 'English',
      issues: 'Issues',
      security: 'Security',
    },
  },
};

export const defaultLang: Lang = 'ko';
