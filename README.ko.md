# SuperLiora CLI

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Site](https://img.shields.io/badge/site-online-blue)](https://claudianus.github.io/superliora/) <br>
[사이트](https://claudianus.github.io/superliora/) · [이슈](https://github.com/claudianus/superliora/issues) · [English](README.md) · [中文](README.zh-CN.md)

![SuperLiora command center](./site/assets/hero-command-center.png)

## 개발 흐름을 끝까지 이어가는 AI 코딩 에이전트

SuperLiora는 긴 소프트웨어 작업을 위한 독립 AI 코딩 에이전트입니다. 계획, 조사, 목표 관리, 병렬 실행, 검증, 기억, 프로젝트 문서화를 하나의 터미널 중심 작업 흐름으로 연결합니다.

이 제품은 context 품질, provider 가용성, 근거, release risk가 동시에 중요한 프로젝트 작업을 위해 만들어졌습니다. 결정은 추적 가능하게 남기고, 검증된 지식은 다시 사용할 수 있게 보존하며, 다음 단계가 더 분명한 출발점에서 시작되도록 돕습니다.

## 핵심 기능

| 기능 | 지원 내용 |
| --- | --- |
| UltraPlan | 목표가 true/false로 검증 가능해질 때까지 요구사항, 제약, 위험, 누락된 사실을 인터뷰합니다. |
| UltraResearch | API, 논문, 릴리스 노트, 보안 이슈를 확인하고 근거를 남깁니다. |
| UltraGoal | 조사 근거를 반영한 UltraPlan이 구체적 목표, 완료 기준, 검증 계획을 고정한 뒤 시작합니다. |
| UltraSwarm | ENGAGE/DEFER Swarm decision이 보일 때만 specialist subagent를 투입합니다. |
| UltraWork | 목표형 작업을 research, UltraPlan, UltraGoal, Swarm decision, integration, verification, learning 순서로 라우팅합니다. |
| Provider routing | API key와 OAuth account를 등록하고 quota, cooldown, latency, route health를 기준으로 fallback 후보를 선택합니다. |
| Liora Recall | 프로젝트 사실, 결정, 절차, 후속 작업, governance rule을 보존합니다. |
| LLM Wiki | 코드베이스 지식, 조사 근거, 검증 결과를 다시 쓸 수 있는 프로젝트 문서로 정리합니다. |
| Context OS | structured working memory, repair, bounded rehydration으로 긴 세션을 관리합니다. |
| Premium themes | preset, 외부 terminal palette, syntax-aware color로 긴 터미널 세션의 가독성을 높입니다. |
| ACP support | 호환 editor에서 같은 SuperLiora workflow를 stdio 기반으로 이어갈 수 있습니다. |

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

## 에디터에서 사용

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

## 문서

- [한국어 사이트](https://claudianus.github.io/superliora/)
- [English site](https://claudianus.github.io/superliora/en/)
- [中文站点](https://claudianus.github.io/superliora/zh/)

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

## 커뮤니티

- [Issues](https://github.com/claudianus/superliora/issues)
- 보안 취약점은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 라이선스

[MIT License](LICENSE)로 배포됩니다.
