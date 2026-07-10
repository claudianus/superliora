# SuperLiora

[![License: MIT](https://img.shields.io/badge/License-MIT-00D5FF.svg)](./LICENSE)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-00D5FF)](https://claudianus.github.io/superliora/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.15.0-00D5FF)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.33.0-00D5FF)](https://pnpm.io/)

**터미널 중심의 AI 코딩 하네스로, 길고 복잡한 개발 흐름을 계획부터 완료까지 이어갑니다.**

[English README](./README.md) · [라이브 데모](https://claudianus.github.io/superliora/)

```bash
# 설치
pnpm add -g @superliora/liora

# 인터랙티브 세션 시작
liora

# 복잡한 작업을 위해 Plan mode로 시작
liora --plan

# 현재 디렉터리의 최근 세션 이어하기
liora --continue
```

SuperLiora는 터미널에서 실행하는 독립형 AI 코딩 하네스입니다. 계획, 조사, 목표 관리, 병렬 실행, 검증, 기억, 문서화, 브라우저 사용, 컴퓨터 사용을 하나의 작업 흐름으로 연결합니다.

긴 세션에서도 맥락을 보존하고, 근거 있는 결정을 남기며, 개발자가 다음 단계에 집중할 수 있도록 돕습니다.

## 주요 기능

- **UltraPlan interview** — 목표가 true/false로 검증 가능해질 때까지 요구사항을 좁힙니다.
- **UltraGoal** — 조사 근거를 반영한 계획 뒤에 목표와 예산을 고정합니다.
- **UltraResearch** — API, 논문, 릴리스 노트, 보안 권고를 확인하고 근거를 남깁니다.
- **UltraSwarm** — 최대 128개의 specialist subagent를 ENGAGE/DEFER gate 뒤에서 운용합니다.
- **Context OS** — structured working memory, repair, bounded rehydration으로 세션을 관리합니다.
- **Liora Recall** — semantic, episodic, procedural, prospective, governance memory를 보존합니다.
- **Browser-use** — CloakBrowser + Playwright로 웹 페이지를 관찰하고 조작합니다.
- **Computer-use** — CUA/MCP로 네이티브 데스크톱을 캡처하고 조작합니다.
- **Provider routing** — quota, cooldown, latency, route health를 기준으로 fallback 후보를 선택합니다.
- **LLM Wiki** — 코드베이스 지식과 검증 근거를 프로젝트 로컬 위키로 전환합니다.
- **Premium TUI** — Neon Noir / Daylight 팔레트와 키보드 중심 탐색으로 터미널을 조종합니다.
- **ACP** — 동일한 SuperLiora workflow를 stdio로 ACP 호환 editor와 IDE에 노출합니다.

## 설치

**Node.js ≥24.15.0**과 Corepack이 설치된 **pnpm 10.33.0**이 필요합니다.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex

liora --version
```

## 빠른 시작

```bash
# 대화형 세션 시작
liora

# Plan mode로 시작
liora --plan

# 단일 프롬프트 비대화 실행
liora -p "auth를 stateless JWT로 리팩터링"

# 현재 디렉터리 최근 세션 이어하기
liora --continue
```

## 개발

```bash
# 클론 및 설치
git clone https://github.com/claudianus/superliora.git
cd superliora
pnpm install

# 전체 모노레포 빌드
pnpm run build

# GitHub Pages 사이트만 빌드
pnpm -C apps/site run build

# 로컬에서 사이트 실행
pnpm -C apps/site run dev
```

자세한 내용은 [CONTRIBUTING.md](./CONTRIBUTING.md)와 [SECURITY.md](./SECURITY.md)를 참조하세요.

## 라이선스

SuperLiora는 [MIT License](./LICENSE) 하에 배포됩니다.

© SuperLiora Contributors
