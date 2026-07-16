# SuperLiora

[![License: MIT](https://img.shields.io/badge/License-MIT-E63946.svg)](./LICENSE)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-E63946)](https://claudianus.github.io/superliora/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.15.0-E63946)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.33.0-E63946)](https://pnpm.io/)
[![Brand](https://img.shields.io/badge/Brand-Blood%20Moon-E63946)](https://claudianus.github.io/superliora/)

**Blood Moon 터미널 하네스로, 긴 개발 작업을 계획부터 검증된 완료까지 이어 붙입니다.**

[라이브 사이트](https://claudianus.github.io/superliora/) · [English README](./README.md) · [English site](https://claudianus.github.io/superliora/en/)

```bash
# 설치
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash

# 인터랙티브 세션
liora

# 복잡한 작업 → Ultrawork plan steering
liora --plan

# 현재 디렉터리 최근 세션 이어하기
liora --continue
```

## 무엇인가

SuperLiora(`liora`)는 오래 이어지는 소프트웨어 작업을 위한 AI 코딩 하네스입니다. 브랜드 프라이머리는 **Blood Moon**(`#E63946`)입니다. 조사, 계획, 목표, 병렬 specialist, 검증, 기억, 문서화, 브라우저 사용, 컴퓨터 사용을 하나의 운영 흐름 — **Ultrawork** — 로 묶습니다.

긴 세션에서도 구조화된 맥락을 유지하고, 근거 있는 결정을 남기며, 시네마틱 다크 TUI 위에서 상태를 읽기 쉽게 유지합니다.

## Ultrawork 스파인

인터랙티브 세션에서 `Shift-Tab`(또는 `/ultrawork`, `liora --plan`)은 다음 순서로 진행합니다.

1. **Research** — API, 릴리스 노트, 코드 사실로 기반을 잡습니다  
2. **UltraPlan interview** — 목표가 true/false로 검증 가능해질 때까지 요구를 좁힙니다  
3. **UltraGoal** — 목표, 예산, acceptance criteria를 잠급니다  
4. **UltraResearch loop** — 고위험 결정 전에 출처를 남깁니다  
5. **UltraSwarm** — 최대 128 specialist를 ENGAGE/DEFER 게이트로 운용합니다  
6. **Integrate → Verify** — 통합 후 테스트·런타임 증거로 닫습니다  
7. **Learn** — 프로젝트 로컬 LLM Wiki를 쓰고, 장기 사실만 Liora Recall에 남깁니다  

## 기능 맵

| 표면 | 역할 |
|---|---|
| **UltraPlan** | 요구·제약·비목표·위험 인터뷰 |
| **UltraGoal** | 조사 뒤 목표·검증 기준 고정 |
| **UltraResearch** | API·논문·보안 권고 확인 및 인용 |
| **UltraSwarm** | ENGAGE/DEFER + specialist (최대 128) |
| **Context OS** | compaction, working memory, repair, rehydration |
| **Liora Recall** | semantic · episodic · procedural · prospective 기억 |
| **LLM Wiki** | Ultrawork 런 기반 프로젝트 로컬 검토 문서 |
| **Browser-use** | CloakBrowser + Playwright 웹 관찰·조작 |
| **Computer-use** | CUA/MCP 네이티브 데스크톱 캡처·조작 |
| **Provider routing** | quota·cooldown·latency·route health 기준 fallback |
| **Premium TUI** | Blood Moon / Daylight, 키보드 중심 탐색 |
| **ACP** | 동일 워크플로를 ACP 호환 에디터/IDE에 stdio 노출 |
| **Premium Quality** | 아트 디렉션·안티 슬롭·스크린샷 증명 (`/premium`) |

## 설치

**Node.js ≥24.15.0**, **pnpm 10.33.0**(Corepack) 필요.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex

liora --version   # SuperLiora 0.20.1
```

### 빠른 시작

```bash
liora                                    # 대화형 세션
liora --plan                             # Ultrawork plan steering
liora -p "이 저장소 설명해"                # 단일 턴 headless
liora -p "/ultrawork harden auth path"   # headless Ultrawork
liora --continue                         # cwd 최근 세션 재개
liora server run --foreground            # 로컬 서버 (기본 127.0.0.1:58627)
liora provider list                      # 모델 / 자격 증명
```

## 모노레포 맵

| 경로 | 역할 |
|---|---|
| `apps/liora` | CLI / TUI (`@superliora/liora`) |
| `apps/site` | GitHub Pages 랜딩 (공개 브랜드 표면) |
| `apps/vis` | 세션 / wire 시각 디버거 |
| `packages/agent-core` | 에이전트 엔진, Ultrawork, memory, tools |
| `packages/node-sdk` | 공개 TypeScript SDK (`@superliora/sdk`) |
| `packages/server` | REST + WebSocket 세션 호스트 |
| `packages/gui-use` | browser-use + computer-use 런타임 |
| `packages/acp-adapter` | Agent Client Protocol 어댑터 |
| `packages/kosong` | LLM / provider 추상화 |
| `packages/kaos` | 실행 환경 추상화 |
| `docs/` | 미배포 EN/ZH 레퍼런스 (공개 사이트 아님) |

## 개발

```bash
git clone https://github.com/claudianus/superliora.git
cd superliora
pnpm install
pnpm run build

# CLI만
pnpm -C apps/liora run dev

# GitHub Pages 사이트
pnpm -C apps/site run dev
pnpm -C apps/site run build
```

자세한 내용은 [CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md)를 보세요.

## 라이선스

MIT — [LICENSE](./LICENSE)

© SuperLiora Contributors
