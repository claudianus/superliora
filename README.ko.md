# SuperLiora

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Site](https://img.shields.io/badge/site-online-blue)](https://claudianus.github.io/superliora/) <br>
[사이트](https://claudianus.github.io/superliora/) · [이슈](https://github.com/claudianus/superliora/issues) · [English](README.md)

![SuperLiora command center](./apps/site/public/assets/hero-command-center.png)

## 지속 가능한 소프트웨어 작업을 위한 AI 코딩 하네스

SuperLiora는 길고 복잡한 소프트웨어 작업을 위한 독립 AI 코딩 하네스입니다. 계획, 조사, 목표 관리, 병렬 실행, 검증, 기억, 프로젝트 문서화를 하나의 터미널 중심 작업 흐름으로 연결합니다. context 품질, 근거, provider 안정성, release risk가 동시에 중요한 작업을 염두에 두고 설계되었습니다.

- **코드보다 먼저 계획.** UltraPlan은 목표가 true/false로 검증 가능해질 때까지 요구사항을 인터뷰합니다.
- **근거를 기반으로 작업.** UltraResearch는 결정 전에 API, 논문, 릴리스 노트, 보안 권고를 확인합니다.
- **안전하게 분산.** UltraSwarm은 보이는 ENGAGE/DEFER gate 뒤에서 specialist subagent를 조립합니다.
- **일관성 유지.** Context OS, Liora Recall, LLM Wiki는 긴 세션을 끊김 없이 유지하고 재사용 가능하게 만듭니다.
- **에디터를 넘어서.** browser-use(CloakBrowser + Playwright)와 computer-use(CUA/MCP)로 실제 UI와 상호작용합니다.
- **어디서나 사용.** Premium TUI, ACP editor 지원, provider routing으로 터미널과 IDE 모두에서 실행할 수 있습니다.

## 핵심 기능

| 기능 | 설명 |
| --- | --- |
| **UltraPlan** | 목표가 true/false로 검증 가능해질 때까지 요구사항, 제약, 위험, 누락된 사실을 인터뷰합니다. (`packages/agent-core/src/agent/plan/ultra-plan-mode.ts`) |
| **UltraResearch** | API, 논문, 릴리스 노트, 보안 이슈를 확인하고 다음 단계에서도 사용할 수 있게 근거를 남깁니다. |
| **UltraGoal** | 조사 근거를 반영한 UltraPlan 뒤에 구체적 목표, 완료 기준, 예산을 고정합니다. (`packages/agent-core/src/agent/injection/goal.ts`) |
| **UltraSwarm** | plan/implement/review 단계로 최대 128개의 specialist subagent를 조립하고, visible ENGAGE/DEFER gate를 둡니다. (`packages/agent-core/src/tools/builtin/collaboration/ultra-swarm.ts`) |
| **UltraWork** | 목표형 작업을 research, UltraPlan, UltraGoal, Swarm decision, integration, verification, learning 순서로 라우팅합니다. (`packages/agent-core/src/ultrawork/mode.ts`) |
| **Browser-use** | CloakBrowser + Playwright로 웹 페이지를 관찰하고, 조작하고, 스크린샷을 찍고, 평가합니다. (`packages/gui-use/src/browser/cloak-browser.ts`) |
| **Computer-use** | CUA/MCP로 네이티브 데스크톱 창을 캡처하고 조작해, 같은 하네스 안에서 GUI 자동화를 수행합니다. (`packages/gui-use/src/computer/cua-computer.ts`) |
| **Provider routing** | API key와 OAuth account를 등록하고 quota, cooldown, latency, route health를 기준으로 fallback 후보를 선택합니다. (`packages/agent-core/src/session/provider-manager.ts`) |
| **Context OS** | structured working memory, repair, bounded rehydration으로 긴 세션을 관리합니다. (`packages/agent-core/src/agent/context-os/index.ts`) |
| **Liora Recall** | semantic, episodic, procedural, prospective, governance memory를 세션 간에 보존합니다. (`packages/agent-core/src/memory/types.ts`) |
| **LLM Wiki** | 코드베이스 지식, 근거, 검증 결과를 프로젝트 로컬에서 검토할 수 있는 wiki로 전환합니다. (`apps/liora/src/tui/commands/llm-wiki.ts`) |
| **Premium TUI** | Neon Noir / Daylight 팔레트, ambient effect, 키보드 중심 탐색을 제공하는 설정 가능한 터미널 화면입니다. (`apps/liora/src/tui/config.ts`) |
| **ACP** | 같은 SuperLiora workflow를 stdio로 ACP 호환 editor와 IDE에 노출합니다. (`packages/acp-adapter/src/server.ts`) |
| **Visual debugging** | `apps/vis`의 세션 replay, context projection, agent trace를 시각적으로 디버깅합니다. |

## 설치

이 GitHub 소스 저장소에서 설치합니다. Git과 Node.js `>=24.15.0`이 필요하며, Corepack이 `package.json`에 고정된 pnpm 버전을 사용합니다.

**macOS 또는 Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex
```

> Windows에서는 첫 실행 전에 [Git for Windows](https://gitforwindows.org/)를 설치하세요. SuperLiora는 Git Bash를 shell 환경으로 사용합니다. Git Bash를 표준 위치가 아닌 곳에 설치했다면 `LIORA_SHELL_PATH`에 `bash.exe`의 절대 경로를 지정하세요.

새 shell을 열고 명령을 확인합니다.

```sh
liora --version
```

설치 스크립트는 소스를 `~/.superliora/source`에 checkout하고 CLI를 빌드한 뒤 `liora` 명령을 설치합니다.

## 빠른 시작

프로젝트 폴더에서 TUI를 실행합니다.

```sh
cd your-project
liora
```

처음 실행하면 `/login`으로 OAuth 계정 또는 API key 기반 provider를 연결하세요. provider와 route 후보를 추가하려면 TUI의 `/provider` 또는 비대화형 명령을 사용합니다.

```sh
liora provider catalog add anthropic --api-key-env ANTHROPIC_API_KEY
liora provider key add openai --api-key-env OPENAI_BACKUP_KEY --label backup --auto-route
liora provider route preview <modelAlias>
liora provider route status <sessionId>
```

큰 구현 작업은 UltraWork로 시작합니다. TUI에서는 `Shift-Tab`으로 Ultrawork mode를 켭니다. 이 모드가 켜져 있거나 사용자가 명시적으로 UltraWork를 요청한 경우가 아니면 일반 프롬프트는 가볍게 처리됩니다.

```sh
liora -p "/ultrawork 이 repo를 audit하고, migration plan을 세우고, 구현하고, 검증하고, release risk를 요약해줘."
```

또는 TUI에서 이렇게 요청하세요.

```text
UltraWork를 사용해. 이 프로젝트를 분석하고, 가장 안전한 migration path를 찾고, 구현하고, 검증하고, 중요한 결정은 memory에 남겨줘.
```

### 브라우저와 컴퓨터 사용

실제 브라우저나 데스크톱 UI가 필요한 작업도 같은 하네스를 사용합니다.

```text
브라우저를 열고 staging 사이트로 이동한 뒤 로그인 플로우를 실행하고, 대시보드가 렌더링되는지 확인해줘.
```

```text
현재 Xcode 창을 캡처하고, 빌드 오류를 확인하고, 수정안을 제안해줘.
```

두 경로 모두 코드 편집과 동일한 permission, memory, verification 모델 아래에서 실행됩니다.

## 에디터에서 사용 (ACP)

SuperLiora는 Agent Client Protocol을 지원합니다. 한 번 로그인한 뒤 에디터가 `liora acp`를 실행하도록 설정하면 됩니다.

Zed 예시:

```json
{
  "agent_servers": {
    "SuperLiora": {
      "type": "custom",
      "command": "liora",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

## 시각적 디버깅

SuperLiora는 `apps/vis`에서 세션, replay, context projection, agent trace를 시각적으로 디버깅할 수 있는 도구를 제공합니다. 로컬에서 실행하려면:

```sh
pnpm dev:vis
```

## 문서

- [한국어 사이트](https://claudianus.github.io/superliora/)
- [English site](https://claudianus.github.io/superliora/en/)

## 개발

요구사항: Node.js `>=24.15.0`, pnpm `10.33.0`.

```sh
git clone https://github.com/claudianus/superliora.git
cd superliora
pnpm install
```

```sh
pnpm dev:cli
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

GitHub Pages 랜딩 사이트를 로컬에서 실행하려면:

```sh
pnpm dev:docs
```

## 커뮤니티

- [Issues](https://github.com/claudianus/superliora/issues)
- 보안 취약점은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 라이선스

[MIT License](LICENSE)로 배포됩니다.
