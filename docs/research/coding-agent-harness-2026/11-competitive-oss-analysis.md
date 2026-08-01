# 11 — OSS 경쟁 하네스 교차분석

> 기준일: 2026-07-31  
> 로컬 클론: `.superliora/harness-research/`  
> 재설계 스펙: [`docs/specs/2026-07-31-sota-harness-redesign.md`](../../specs/2026-07-31-sota-harness-redesign.md)

## 공식 레포 (혼동 금지)

| 제품 | 공식 레포 | 비고 |
|---|---|---|
| OpenCode | [anomalyco/opencode](https://github.com/anomalyco/opencode) | `sst/opencode` → redirect. homepage: opencode.ai |
| Grok Build | [xai-org/grok-build](https://github.com/xai-org/grok-build) | xAI/SpaceXAI OSS harness+TUI. **아님**: `grok-prompts`, 커뮤니티 desktop 래퍼 |
| Hermes Agent | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | self-improving + narrow waist 원칙 |
| OpenHands | [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | 현 default = **Agent Canvas** (ACP 컨트롤 센터). CodeAct 모놀리스와 다름 |

## 한 줄 포지션

| 제품 | 포지션 |
|---|---|
| **OpenCode** | TS Effect 기반 세션 코어 + 최소 툴셋 + 구조화 컴팩션. “코딩 루프 순수성”에 가깝다. |
| **Grok Build** | Rust TUI+하네스 풀스택. skills/hooks/MCP/memory/worktrees/ACP. SuperLiora와 **제품 형태가 가장 유사**. |
| **Hermes** | 캐시 신성 + 엣지 확장 + 스킬 자기개선. 원칙은 SOTA, core 목록 자체는 GUI/video까지 실어 모순. |
| **OpenHands** | 에이전트 코어가 아니라 **멀티 하네스 호스트 UI**. ACP 오케스트레이션 참고. |
| **SuperLiora** | Pure loop + TUI realtime + server/SDK. **강점: 루프 순수성·가시성·래칫. 약점: default waist·서버 필수·구조화 handoff.** |

## 툴 허리 비교

### OpenCode builtin (`packages/opencode/src/tool/registry.ts`)

`invalid`, `shell`, `read`, `glob`, `grep`, `edit`, `write`, `task`, `fetch`, `todo`, `search`, `skill`, `patch`(**apply_patch**), `question`, `lsp`, `plan`, (+ optional code-mode).

→ **~16**, patch↔edit/write 상호배타 옵션.

### SuperLiora default (`packages/agent-core/src/profile/default/agent.yaml`)

Read/Write/Edit/Grep/Glob/Bash/RunProjectChecks/LioraRead/TodoList/UltraworkGraph/Plan*/Goal*/Skill*/Agent*/Swarm*/Web*/Context7*/AskUserQuestion/Memory/Task*/Media*/Verify*/LioraReview/VisualDiff/`mcp__*` …

→ **always-on ~35+ + mcp 와일드카드**. OpenCode 대비 2× 이상.

### Hermes `_HERMES_CORE_TOOLS`

원칙: “expand at edges, keep core tiny”. 실제 배열은 web/terminal/files/skills/browser/todo/memory/delegate/…까지 넓음. **원칙을 훔치고 목록은 훔치지 말 것.**

### Grok Build

Managed tools + MCP + **ToolSearchIndex(BM25)** 로 hidden tools를 검색 노출. 스키마 전량 always-on이 아님.

## 컴팩션 / 컨텍스트

| | OpenCode | Grok | Hermes | SuperLiora |
|---|---|---|---|---|
| 구조 | SUMMARY: Objective / Work State / Next Move / Relevant Files | CompactionPolicy + memory flush + optional two-pass | trajectory compressor (학습용) | micro-compaction 존재, handoff 템플릿 약함 |
| 캐시 | Context Epoch / admitted prompt | AGENTS 캐시 섹션 | **prompt-cache sacred** (턴 중 스왑 금지) | provider 의존 |
| Long-run | session 연속성 | worktrees + memory dream | skill_manage / session_search | goal/swarm 있으나 initializer 프로토콜 미정착 |

## 호스트 모델

| | 기본 실행 경로 |
|---|---|
| OpenCode | 프로세스 내 세션 루프 |
| Grok Build | shell crate + TUI/headless/ACP |
| Hermes | `run_agent.py` 단일 프로세스 |
| OpenHands Canvas | ACP로 외부 agent-server 연결 |
| SuperLiora | **liora → server → agent-core** (로컬도 서버). 인프로세스는 로드맵상 미완 |

## Steal 우선순위 (SuperLiora용)

1. **OpenCode waist + apply_patch + structured compaction** — 즉시 ROI  
2. **Hermes cache+waist 원칙 + check_fn 게이트** — 설계 규율  
3. **Grok ToolSearchIndex + hooks/memory/worktrees/ACP 모듈화** — 확장성  
4. **OpenHands ACP many-hands 호스트** — 오케스트레이션만  
5. **벤더**: Anthropic long-run artifacts, OpenAI AGENTS-as-ToC + mechanical lint, z.ai memory split

## Avoid

- Effect/Rust 전면 재작성  
- Hermes의 거대한 “core” 목록 복제  
- OpenHands Canvas UI 복제  
- 잘못된 레포(`grok-prompts`, 커뮤니티 grok-build-agent) 분석

## 다음 문서

구현 로드맵·패키지 변경 지도 → [`2026-07-31-sota-harness-redesign.md`](../../specs/2026-07-31-sota-harness-redesign.md)
