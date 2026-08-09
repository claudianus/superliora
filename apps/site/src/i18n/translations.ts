export type Lang = 'ko' | 'en';

export type DocSlug =
  | 'getting-started'
  | 'how-conductor-works'
  | 'jobs'
  | 'control-tower'
  | 'reference';

export interface InstallCommand {
  label: string;
  cmd: string;
}

export interface WorkflowStep {
  title: string;
  body: string;
}

export interface TowerItem {
  keys: string;
  title: string;
  body: string;
}

export interface DocPage {
  slug: DocSlug;
  title: string;
  lead: string;
  sections: { heading: string; body: string; code?: string }[];
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
    how: string;
    tower: string;
    install: string;
    docs: string;
  };
  hero: {
    brand: string;
    h1: string;
    lead: string;
    install: string;
    github: string;
    docs: string;
  };
  how: {
    kicker: string;
    title: string;
    body: string;
    steps: WorkflowStep[];
  };
  tower: {
    kicker: string;
    title: string;
    body: string;
    items: TowerItem[];
  };
  install: {
    kicker: string;
    title: string;
    body: string;
    requirements: string;
    commands: InstallCommand[];
    next: string;
  };
  theatre: {
    play: string;
    pause: string;
    chapter: string;
    beats: { id: string; label: string; caption: string }[];
  };
  footer: {
    copyright: string;
    github: string;
    english: string;
    korean: string;
    docs: string;
    issues: string;
    security: string;
    tagline: string;
  };
  docsNav: { slug: DocSlug; label: string }[];
  docs: Record<DocSlug, DocPage>;
  docsShell: {
    home: string;
    onThisSite: string;
  };
}

export const defaultLang: Lang = 'ko';
export const PRODUCT_VERSION = '0.20.1';

const INSTALL_SH =
  'curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash';
const INSTALL_PS =
  'irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex';

const docsNavKo: Translation['docsNav'] = [
  { slug: 'getting-started', label: '시작하기' },
  { slug: 'how-conductor-works', label: 'Conductor' },
  { slug: 'jobs', label: 'Jobs' },
  { slug: 'control-tower', label: 'Control tower' },
  { slug: 'reference', label: '레퍼런스' },
];

const docsNavEn: Translation['docsNav'] = [
  { slug: 'getting-started', label: 'Getting started' },
  { slug: 'how-conductor-works', label: 'Conductor' },
  { slug: 'jobs', label: 'Jobs' },
  { slug: 'control-tower', label: 'Control tower' },
  { slug: 'reference', label: 'Reference' },
];

export const translations: Record<Lang, Translation> = {
  ko: {
    lang: 'ko',
    dir: 'ltr',
    meta: {
      title: 'SuperLiora — Conductor harness',
      description:
        'SuperLiora는 Conductor 하네스입니다. 채팅은 컨트롤 플레인이고, 구현은 격리 Job(worktree)에서 돌아갑니다. Job Deck·Worker Dock·Inbox로 진행을 보고, 신뢰 검사 후 로컬 land합니다.',
      ogLocale: 'ko_KR',
    },
    skip: '본문으로 건너뛰기',
    nav: {
      how: '작동 방식',
      tower: '조종석',
      install: '설치',
      docs: '문서',
    },
    hero: {
      brand: 'SuperLiora',
      h1: '말해 주세요. Conductor가 Job으로 돌립니다.',
      lead: '컨트롤 플레인에서 결과를 적으면, 워커가 격리 worktree에서 구현합니다. 기다리지 말고 Deck과 Inbox로 운영하세요.',
      install: '설치하기',
      github: 'GitHub',
      docs: '문서',
    },
    how: {
      kicker: 'How Conductor works',
      title: '채팅은 위임. 구현은 Job.',
      body: '제품이 가르치는 계약과 같습니다 — 결과를 적고, ACK를 받고, 백그라운드를 보고, 필요할 때 답하고, 검사가 통과하면 land합니다.',
      steps: [
        {
          title: '작업 입력',
          body: '채팅에 결과를 적으면 Conductor가 Job을 만듭니다.',
        },
        {
          title: '즉시 ACK',
          body: 'job_id와 상태가 바로 돌아옵니다. 워커 완료를 기다리지 않습니다.',
        },
        {
          title: 'Dock / Deck',
          body: 'Worker Dock과 Alt+J Job Deck으로 진행을 실시간으로 봅니다.',
        },
        {
          title: 'needs_user',
          body: 'Job이 물으면 Inbox(Alt+I)에서 답하고 재개합니다.',
        },
        {
          title: 'Land',
          body: '신뢰 검사를 통과하면 로컬로 merge합니다. Land는 push가 아닙니다.',
        },
      ],
    },
    tower: {
      kicker: 'Control tower',
      title: '키보드로 함대를 읽습니다.',
      body: 'Conductor UX의 핫키 — 한 줄로 기억하세요.',
      items: [
        {
          keys: 'Alt+J',
          title: 'Job Deck',
          body: '카드와 워커 트랜스크립트를 실시간으로 봅니다.',
        },
        {
          keys: 'Alt+I',
          title: 'Inbox',
          body: 'needs_user·완료·실패 알림에 답합니다.',
        },
        {
          keys: 'Alt+B',
          title: 'Intent Composer',
          body: 'success_criteria 등 brief 슬롯을 채웁니다.',
        },
        {
          keys: 'Timeline',
          title: 'Timeline',
          body: 'Intake → Running → Needs you → Land 흐름을 봅니다.',
        },
      ],
    },
    install: {
      kicker: 'Install',
      title: '설치하고 liora를 실행하세요.',
      body: 'Node.js ≥24.15.0이 필요합니다. 설치 후 /login과 /model로 프로바이더를 연결하세요.',
      requirements: 'Node.js ≥24.15.0 · pnpm via Corepack(소스 설치 시)',
      commands: [
        { label: 'macOS / Linux', cmd: INSTALL_SH },
        { label: 'Windows PowerShell', cmd: INSTALL_PS },
      ],
      next: '문서로 이어가기',
    },
    theatre: {
      play: '재생',
      pause: '일시정지',
      chapter: '챕터',
      beats: [
        { id: 'welcome', label: 'Welcome', caption: 'Conductor 코치 — 채팅에 작업을 적으세요.' },
        { id: 'ack', label: 'Job ACK', caption: '한 줄 입력 → 즉시 job_id ACK.' },
        { id: 'strip', label: 'Job strip', caption: '푸터 strip이 보드를 따라갑니다.' },
        { id: 'dock', label: 'Worker Dock', caption: '백그라운드 워커가 Dock에 살아 있습니다.' },
        { id: 'deck', label: 'Job Deck', caption: 'Alt+J — 카드와 워커 trace.' },
        { id: 'inbox', label: 'Inbox', caption: 'Alt+I — needs_user에 답하고 재개.' },
        { id: 'brief', label: 'Composer', caption: 'Alt+B — hotfix brief → JobCreate.' },
        { id: 'timeline', label: 'Timeline', caption: 'Intake → Running → Needs you → Land.' },
        { id: 'merge', label: 'Merge Preview', caption: '게이트 체크리스트 — 증거 없으면 hold.' },
        { id: 'land', label: 'Land', caption: '로컬 land 완료. Land ≠ push.' },
      ],
    },
    footer: {
      copyright: '© SuperLiora Contributors',
      github: 'GitHub',
      english: 'English',
      korean: '한국어',
      docs: '문서',
      issues: 'Issues',
      security: 'Security',
      tagline: 'Conductor harness',
    },
    docsNav: docsNavKo,
    docsShell: { home: '홈', onThisSite: '이 사이트에서' },
    docs: {
      'getting-started': {
        slug: 'getting-started',
        title: '시작하기',
        lead: '설치하고 첫 Job까지.',
        sections: [
          {
            heading: '설치',
            body: 'macOS/Linux 또는 Windows에서 설치 스크립트를 실행합니다.',
            code: INSTALL_SH,
          },
          {
            heading: '첫 세션',
            body: '프로젝트 루트에서 liora를 실행한 뒤 /login과 /model로 프로바이더와 모델을 고릅니다. 채팅에 원하는 결과를 적으면 Conductor가 Job을 만듭니다.',
            code: 'liora\n/login\n/model',
          },
          {
            heading: '이어하기',
            body: '같은 디렉터리의 최근 세션은 --continue로 재개합니다. 중단된 Job은 /job resume로 살립니다.',
            code: 'liora --continue',
          },
        ],
      },
      'how-conductor-works': {
        slug: 'how-conductor-works',
        title: 'How Conductor works',
        lead: 'Conductor는 워커가 아니라 컨트롤 플레인입니다.',
        sections: [
          {
            heading: '위임만',
            body: '파일 변경·빌드·테스트는 Job입니다. Conductor 레인은 읽기·조회·ledger·질문만 합니다. 직접 Write는 거부되고 Job 초안이 나옵니다.',
          },
          {
            heading: '기다리지 않음',
            body: 'JobCreate는 즉시 ACK합니다. 결과는 Inbox로 옵니다. 폴링하지 마세요.',
          },
          {
            heading: '두 종류의 worktree',
            body: 'Job worktree는 Job별 격리 git 트리입니다. liora --worktree는 세션 cwd 격리입니다. 둘을 섞어 말하지 마세요.',
          },
          {
            heading: 'Ask vs Build',
            body: 'Shift-Tab은 Build와 Ask를 바꿉니다. Ask에서는 JobCreate도 거부됩니다. 위임하려면 Build로 돌아오세요.',
          },
        ],
      },
      jobs: {
        slug: 'jobs',
        title: 'Jobs',
        lead: 'ledger · Deck · Inbox · merge.',
        sections: [
          {
            heading: '목록과 Deck',
            body: '/jobs로 목록을 보고, /jobs deck 또는 Alt+J로 모니터를 엽니다.',
            code: '/jobs\n/jobs deck',
          },
          {
            heading: '조향',
            body: '/job inspect · answer · resume · cancel · steer로 실행 중 작업을 다룹니다. 많은 경로는 LLM 없이 RPC hotpath입니다.',
            code: '/job inbox\n/job answer <id> <text>\n/job resume\n/job cancel <id>',
          },
          {
            heading: 'Merge와 Land',
            body: 'Merge Preview에서 게이트를 확인한 뒤 승인하면 로컬 main으로 land합니다. 원격 배포는 Push Preview가 따로 있습니다.',
          },
          {
            heading: '정리',
            body: '/job gc로 끝난 worktree를 정리합니다.',
            code: '/job gc',
          },
        ],
      },
      'control-tower': {
        slug: 'control-tower',
        title: 'Control tower',
        lead: '단축키와 프로젝트 모드.',
        sections: [
          {
            heading: '단축키',
            body: 'Alt+J Job Deck · Alt+I Inbox · Alt+B Intent Composer · Ctrl-K Command Hub.',
          },
          {
            heading: 'Project modes',
            body: 'balanced · greenfield · hotfix · review. 모드에 따라 병렬 풀과 brief 요구가 달라집니다. /job mode로 바꿉니다.',
            code: '/job mode hotfix',
          },
          {
            heading: 'Intent Composer',
            body: 'success_criteria 등 슬롯을 채운 뒤 Job을 만듭니다. hotfix는 brief에서 바로 생성할 수 있습니다.',
          },
          {
            heading: 'Plan / Goal',
            body: '/plan은 Plan Desk Job으로 계획을 오프로드합니다. /goal은 Goal Desk로 목표 루프를 넘깁니다. Conductor 채팅은 계속 열려 있습니다.',
            code: 'liora --plan\n/goal <objective>',
          },
        ],
      },
      reference: {
        slug: 'reference',
        title: '레퍼런스',
        lead: '자주 쓰는 CLI와 slash.',
        sections: [
          {
            heading: 'CLI',
            body: '인터랙티브와 세션 플래그.',
            code: 'liora\nliora --continue\nliora --plan\nliora --worktree [name]\nliora -m <alias>',
          },
          {
            heading: '핵심 slash',
            body: '/login · /model · /jobs · /job · /agents · /plan · /ask · /goal · /status · /help',
          },
          {
            heading: 'Ask mode',
            body: '/ask 또는 Shift-Tab. 읽기 전용. Job 위임이 필요하면 Build로 전환하세요.',
          },
        ],
      },
    },
  },
  en: {
    lang: 'en',
    dir: 'ltr',
    meta: {
      title: 'SuperLiora — Conductor harness',
      description:
        'SuperLiora is a Conductor harness. Chat is the control plane; implementation runs on isolated Jobs in git worktrees. Watch progress in the Job Deck and Worker Dock, answer Inbox prompts, then land locally when trust checks pass.',
      ogLocale: 'en_US',
    },
    skip: 'Skip to content',
    nav: {
      how: 'How it works',
      tower: 'Control tower',
      install: 'Install',
      docs: 'Docs',
    },
    hero: {
      brand: 'SuperLiora',
      h1: 'You talk. Conductor runs Jobs.',
      lead: 'Describe the outcome on the control plane. Workers implement in isolated worktrees. Operate with the Deck and Inbox — do not wait on the worker.',
      install: 'Install',
      github: 'GitHub',
      docs: 'Docs',
    },
    how: {
      kicker: 'How Conductor works',
      title: 'Chat delegates. Jobs implement.',
      body: 'Same contract the product teaches — type an outcome, take the ACK, watch the background, answer when asked, land when checks pass.',
      steps: [
        {
          title: 'Type a task',
          body: 'Describe the outcome in chat; Conductor creates a Job.',
        },
        {
          title: 'Instant ACK',
          body: 'You get job_id and state immediately. Never block on worker finish.',
        },
        {
          title: 'Dock / Deck',
          body: 'Watch live progress in the Worker Dock and Alt+J Job Deck.',
        },
        {
          title: 'needs_user',
          body: 'When a Job asks, answer from Inbox (Alt+I) and resume.',
        },
        {
          title: 'Land',
          body: 'When trust checks pass, merge locally. Land is not push.',
        },
      ],
    },
    tower: {
      kicker: 'Control tower',
      title: 'Read the fleet from the keyboard.',
      body: 'Conductor UX hotkeys — keep these four.',
      items: [
        {
          keys: 'Alt+J',
          title: 'Job Deck',
          body: 'Live cards and worker transcripts.',
        },
        {
          keys: 'Alt+I',
          title: 'Inbox',
          body: 'Answer needs_user, done, and failure notices.',
        },
        {
          keys: 'Alt+B',
          title: 'Intent Composer',
          body: 'Fill brief slots such as success_criteria.',
        },
        {
          keys: 'Timeline',
          title: 'Timeline',
          body: 'Intake → Running → Needs you → Land.',
        },
      ],
    },
    install: {
      kicker: 'Install',
      title: 'Install, then run liora.',
      body: 'Requires Node.js ≥24.15.0. After install, connect a provider with /login and /model.',
      requirements: 'Node.js ≥24.15.0 · pnpm via Corepack for source installs',
      commands: [
        { label: 'macOS / Linux', cmd: INSTALL_SH },
        { label: 'Windows PowerShell', cmd: INSTALL_PS },
      ],
      next: 'Continue in docs',
    },
    theatre: {
      play: 'Play',
      pause: 'Pause',
      chapter: 'Chapter',
      beats: [
        { id: 'welcome', label: 'Welcome', caption: 'Conductor coach — type a task in chat.' },
        { id: 'ack', label: 'Job ACK', caption: 'One line in → instant job_id ACK.' },
        { id: 'strip', label: 'Job strip', caption: 'Footer strip tracks the board.' },
        { id: 'dock', label: 'Worker Dock', caption: 'Background workers stay visible.' },
        { id: 'deck', label: 'Job Deck', caption: 'Alt+J — cards and worker trace.' },
        { id: 'inbox', label: 'Inbox', caption: 'Alt+I — answer needs_user, resume.' },
        { id: 'brief', label: 'Composer', caption: 'Alt+B — hotfix brief → JobCreate.' },
        { id: 'timeline', label: 'Timeline', caption: 'Intake → Running → Needs you → Land.' },
        { id: 'merge', label: 'Merge Preview', caption: 'Gate checklist — hold without evidence.' },
        { id: 'land', label: 'Land', caption: 'Local land complete. Land ≠ push.' },
      ],
    },
    footer: {
      copyright: '© SuperLiora Contributors',
      github: 'GitHub',
      english: 'English',
      korean: '한국어',
      docs: 'Docs',
      issues: 'Issues',
      security: 'Security',
      tagline: 'Conductor harness',
    },
    docsNav: docsNavEn,
    docsShell: { home: 'Home', onThisSite: 'On this site' },
    docs: {
      'getting-started': {
        slug: 'getting-started',
        title: 'Getting started',
        lead: 'Install through your first Job.',
        sections: [
          {
            heading: 'Install',
            body: 'Run the install script on macOS/Linux or Windows.',
            code: INSTALL_SH,
          },
          {
            heading: 'First session',
            body: 'From a project root, run liora, then /login and /model. Type the outcome you want; Conductor creates a Job.',
            code: 'liora\n/login\n/model',
          },
          {
            heading: 'Resume',
            body: 'Resume the latest session in this directory with --continue. Interrupted Jobs come back with /job resume.',
            code: 'liora --continue',
          },
        ],
      },
      'how-conductor-works': {
        slug: 'how-conductor-works',
        title: 'How Conductor works',
        lead: 'Conductor is the control plane, not a coding worker.',
        sections: [
          {
            heading: 'Delegation only',
            body: 'File mutations, builds, and tests are Jobs. The Conductor lane reads, inspects, manages the ledger, and asks questions. Direct Write is rejected with a Job draft.',
          },
          {
            heading: 'Never wait',
            body: 'JobCreate ACKs immediately. Results arrive in Inbox. Do not poll.',
          },
          {
            heading: 'Two worktrees',
            body: 'A Job worktree is an isolated git tree per Job. liora --worktree isolates the session cwd. Do not conflate them.',
          },
          {
            heading: 'Ask vs Build',
            body: 'Shift-Tab cycles Build and Ask. Ask denies JobCreate. Switch back to Build to delegate.',
          },
        ],
      },
      jobs: {
        slug: 'jobs',
        title: 'Jobs',
        lead: 'Ledger, Deck, Inbox, merge.',
        sections: [
          {
            heading: 'List and Deck',
            body: 'List with /jobs. Open the monitor with /jobs deck or Alt+J.',
            code: '/jobs\n/jobs deck',
          },
          {
            heading: 'Steer',
            body: 'inspect · answer · resume · cancel · steer. Many paths are RPC hotpaths without an LLM turn.',
            code: '/job inbox\n/job answer <id> <text>\n/job resume\n/job cancel <id>',
          },
          {
            heading: 'Merge and Land',
            body: 'Approve Merge Preview after gates pass to land into local main. Remote publish is a separate Push Preview.',
          },
          {
            heading: 'GC',
            body: 'Clean finished worktrees with /job gc.',
            code: '/job gc',
          },
        ],
      },
      'control-tower': {
        slug: 'control-tower',
        title: 'Control tower',
        lead: 'Shortcuts and project modes.',
        sections: [
          {
            heading: 'Shortcuts',
            body: 'Alt+J Job Deck · Alt+I Inbox · Alt+B Intent Composer · Ctrl-K Command Hub.',
          },
          {
            heading: 'Project modes',
            body: 'balanced · greenfield · hotfix · review. Pool size and brief rules change with mode. Set with /job mode.',
            code: '/job mode hotfix',
          },
          {
            heading: 'Intent Composer',
            body: 'Fill slots such as success_criteria, then create a Job. Hotfix can create straight from the brief.',
          },
          {
            heading: 'Plan / Goal',
            body: '/plan offloads planning to a Plan Desk Job. /goal sends the objective loop to Goal Desk. Conductor chat stays free.',
            code: 'liora --plan\n/goal <objective>',
          },
        ],
      },
      reference: {
        slug: 'reference',
        title: 'Reference',
        lead: 'CLI flags and slash commands you will actually use.',
        sections: [
          {
            heading: 'CLI',
            body: 'Interactive session flags.',
            code: 'liora\nliora --continue\nliora --plan\nliora --worktree [name]\nliora -m <alias>',
          },
          {
            heading: 'Core slash',
            body: '/login · /model · /jobs · /job · /agents · /plan · /ask · /goal · /status · /help',
          },
          {
            heading: 'Ask mode',
            body: '/ask or Shift-Tab. Read-only. Switch to Build when you need Job delegation.',
          },
        ],
      },
    },
  },
};
