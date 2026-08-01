# 10 — 벤더 공식 Harness 문서 카탈로그

> 기준일: 2026-07-31  
> 범위: **공식 홈/엔지니어링 블로그/개발자 문서**만 (3rd-party 해석은 보조).  
> 벤더: Anthropic · OpenAI · Google · DeepSeek · z.ai · Cursor

## 한 줄 요약

공식 문서가 수렴하는 공통식:

```
Harness = Instructions + Tools(+ACI) + Model-tuned loop + Sensors + Memory/Session
```

차이는 **어디에 opinionated한가**: Anthropic/OpenAI는 long-horizon·repo-as-SoR, Google는 sandbox/managed agent·프로토콜, Cursor는 model별 harness 튜닝, z.ai는 실무 워크플로 프레임, DeepSeek는 **모델 API + 기존 에이전트에 꽂기**(자체 장문 harness 에세이는 상대적으로 적음).

---

## 0. 교차 벤더 합의 (2026)

| 주제 | 합의 |
|---|---|
| 단순함 우선 | 워크플로 → 필요할 때만 열린 에이전트 (Anthropic) |
| 검증 루프 | 테스트/빌드/스크린샷 등 **pass-fail 신호** 없이 방치 금지 |
| Plan → Code | 복잡한 일은 탐색·계획 후 구현 (Anthropic, Cursor, z.ai) |
| Progressive disclosure | `AGENTS.md`/`CLAUDE.md`는 목차, 상세는 `docs/`·skills·rules |
| 기계적 강제 | lint/CI/hooks가 prose보다 강함 (OpenAI harness eng.) |
| JIT context | 전부 미리 넣지 말고 도구로 끌어오기 (Anthropic context eng.) |
| Harness는 썩음 | 모델이 세면 scaffolding을 걷어라 (Anthropic Managed Agents, Google Bake-Off) |
| Brain ≠ Hands | 세션/샌드박스/루프를 인터페이스로 분리 (Anthropic) |
| LLM reason / code execute | 계산·금전은 결정적 코드 + 스키마 (Google) |
| Rules vs Skills | always-on vs on-demand (Cursor, OpenAI Codex, z.ai) |

---

## 1. Anthropic

### 1.1 공식 문서 목록 (우선순위)

| 문서 | URL | 핵심 |
|---|---|---|
| Building Effective AI Agents | https://www.anthropic.com/engineering/building-effective-agents | 에이전트=LLM+tools in a loop; workflow vs agent; **ACI** |
| Effective context engineering for AI agents | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | JIT, hybrid CLAUDE.md+grep, compaction, NOTES.md |
| Effective harnesses for long-running agents | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | initializer + coding agent; feature JSON; git+progress |
| Harness design for long-running apps | https://www.anthropic.com/engineering/harness-design-long-running-apps | generator/evaluator; sprint contract; context reset vs compact |
| Scaling Managed Agents | https://www.anthropic.com/engineering/managed-agents | meta-harness; brain/hands/session; cattle not pets |
| Claude Code best practices | https://www.anthropic.com/engineering/claude-code-best-practices | verify, plan, CLAUDE.md, subagents, hooks, `/goal` |
| Long-running Claude (scientific) | https://www.anthropic.com/research/long-running-Claude | CLAUDE.md, tests as progress, Ralph/`/loop`, git commits |
| Claude Code Advanced Patterns (PDF) | https://resources.anthropic.com/…Claude Code Advanced Patterns… | rules paths, worktrees, agent teams |

### 1.2 통찰 요약

**Building Effective Agents**

- 성공 = 복잡한 시스템 ≠. **올바른 시스템**.
- Start simple prompts → eval → multi-step only if needed.
- 투명한 planning steps 노출.
- **ACI (Agent-Computer Interface)**: 툴 docstring에 HCI급 투자. SWE-bench에서 **프롬프트보다 툴 최적화에 더 시간**. 예: relative path 실패 → absolute path 강제 (poka-yoke).

**Context engineering**

- Just-in-time: 경로·쿼리 식별자만 들고 도구로 로드.
- Hybrid: always-on `CLAUDE.md` + glob/grep 탐색.
- Compaction은 요약 손실 위험 → 외부 NOTES/TODO로 보완.

**Long-running harness**

- Initializer ≠ Coding agent (첫 창만 다른 프롬프트).
- `feature_list.json` + `passes` 필드만 편집; Markdown보다 JSON이 덜 훼손.
- 세션 끝 = mergeable clean state + git commit + progress file.
- 조기 승리 선언 / one-shot overreach / 반쯤 구현된 핸드오프가 핵심 실패 모드.

**Long-running apps harness**

- Generator ≠ Evaluator; Playwright 등 E2E로 “써보기”.
- Sprint contract 협상 후 구현.
- Context anxiety → reset; Opus 4.5에선 reset이 dead weight → **모델 바뀌면 harness 재검토**.

**Managed Agents (2026-04)**

- Harness는 모델 약점의 가정 → 자주 상한다.
- **Meta-harness**: Session(append-only log) · Harness(loop) · Sandbox(hands) 인터페이스만 opinionated.
- Pets→Cattle: 컨테이너/하네스 크래시해도 `wake(sessionId)`로 재개.
- Credentials는 sandbox에 두지 않음 (vault/proxy).
- Session ≠ context window: `getEvents()`로 슬라이스 조회.
- Many brains / many hands; TTFT 대폭 개선 보고.

**Claude Code BP**

- Context window이 1차 제약.
- Verify: tests / `/goal` / Stop hook / verification subagent.
- Explore → Plan → Code; subagents로 조사 격리.
- Hooks, worktrees, agent teams.

### 1.3 SuperLiora 메모

- ACI·툴 설명 품질, emitter-side truncation, plan mode, nested AGENTS = Anthropic과 같은 축.
- Managed Agents식 brain/hands 분리는 `agent-core` loop 순수성 + kaos sandbox와 철학적으로 유사.

---

## 2. OpenAI

### 2.1 공식 문서 목록

| 문서 | URL | 핵심 |
|---|---|---|
| **Harness engineering** (Codex agent-first) | https://openai.com/index/harness-engineering/ | 0 lines human code 실험; repo SoR; mechanical enforcement |
| Unrolling the Codex agent loop | https://openai.com/index/unrolling-the-codex-agent-loop/ | harness=agent loop; Responses API; compaction |
| Introducing Codex | https://openai.com/index/introducing-codex/ | AGENTS.md; isolated env; tests/linters |
| Codex best practices | https://developers.openai.com/codex/learn/best-practices | AGENTS.md, skills, MCP, config, sandbox |
| Codex manual | https://developers.openai.com/codex/codex-manual.md | 운영 수준 상세 |

### 2.2 통찰 요약

**Harness engineering (Lopopolo, 2026-02)** — 가장 “하네스”라는 단어를 제품 공식으로 쓴 글.

- Humans steer, agents execute. 엔지니어 일 = **환경·의도·피드백 루프 설계**.
- 실패 시 “더 세게 프롬프트”가 아니라 **빠진 capability를 레포에 넣어 enforce**.
- `AGENTS.md` ≈ **목차(~100줄)**; 본문은 `docs/` knowledge base (progressive disclosure).
- 거대 AGENTS.md 실패 이유: 컨텍스트 낭비, 전부 중요→무중요, 즉시 부패, 검증 불가.
- **Doc-gardening agent** + CI linter로 문서 freshness 기계 검증.
- Architecture layers를 custom lint로 강제; 에러 메시지에 **remediation을 에이전트 컨텍스트로 주입**.
- Golden principles + recurring cleanup agents.
- UI/로그/메트릭을 에이전트에 **legible**하게 (CDP, LogQL/PromQL, worktree-bootable apps).
- Agent-to-agent review + Ralph-style 루프.
- Information parity: Slack/머리 속 지식은 에이전트에게 없는 것과 같음 → **repo-local SoR**.

**Codex agent loop**

- Harness = user ↔ model ↔ tools 오케스트레이션.
- Responses API `instructions` / `tools` / `input`; model-specific base instructions.
- Auto-compact (`/responses/compact`, encrypted compaction item).
- Sandbox 권한은 shell 툴에 한정; MCP는 각자 가드.

**Codex product BP**

- Task context → AGENTS.md → config.toml → MCP → Skills → Automations.
- Nested AGENTS.md (가까운 경로 우선).
- Approval mode × sandbox mode.

### 2.3 SuperLiora 메모

- “짧은 AGENTS + docs map + mechanical ratchet”은 이미 root/nested AGENTS + check:test-baseline과 동형.
- OpenAI의 legibility(관측을 에이전트에) ↔ SuperLiora TUI 실시간 스트림.

---

## 3. Google

### 3.1 공식 문서 목록

| 문서 | URL | 핵심 |
|---|---|---|
| Agents Overview (Gemini API) | https://ai.google.dev/gemini-api/docs/agents | Managed agent = configurable harness + Linux sandbox |
| Building Managed Agents | https://ai.google.dev/gemini-api/docs/custom-agents | AGENTS.md, SKILL.md, tools, MCP, environments |
| Antigravity Agent | https://ai.google.dev/gemini-api/docs/antigravity-agent | IDE와 동일 harness; hooks; model lock on create |
| Managed Agents Quickstart | https://ai.google.dev/gemini-api/docs/managed-agents-quickstart | compaction ~135k; env persistence |
| Agent Bake-Off: 5 tips | https://developers.googleblog.com/build-better-ai-agents-5-developer-tips-from-the-agent-bake-off/ | multi-agent, harness impermanence, protocols, schemas |
| AI Agent Protocols guide | https://developers.googleblog.com/developers-guide-to-ai-agent-protocols/ | MCP/A2A/… alphabet soup |
| ADK | Agent Development Kit docs (linked from Bake-Off) | multi-agent frameworks |

### 3.2 통찰 요약

**Managed / Antigravity harness**

- 단일 API 호출로 sandbox 프로비저닝 + tool-use loop.
- 기본 툴: code_execution, google_search, url_context; filesystem은 environment 있을 때.
- `.agents/AGENTS.md` + skills mount; `system_instruction`과 additive.
- Network allowlist, credential via egress proxy (sandbox에 시크릿 미노출).
- Hooks로 tool 전후 가드.
- Managed agent 생성 시 model lock → 디버깅·보안 경계 예측 가능.
- Native compaction (~135k) against context rot.

**Bake-Off 5 tips (2026-04)**

1. Monolith LLM 금지 → supervisor + scoped sub-agents (microservices).
2. **Harness may need to be replaced tomorrow** — 모델이 따라잡으면 복잡한 harness deprecate. Modular.
3. Multimodality는 1급.
4. MCP / A2A 등 오픈 프로토콜로 glue 코드 줄이기.
5. **LLMs reason, deterministic code executes** — Pydantic/JSON schema → Python/SQL.

### 3.3 SuperLiora 메모

- Harness impermanence = Anthropic “strip dead weight”와 동일 결론.
- Hooks + sandbox network policy는 kaos/permission 레이어와 대응.

---

## 4. DeepSeek

### 4.1 공식 문서 목록

| 문서 | URL | 핵심 |
|---|---|---|
| Your First API Call | https://api-docs.deepseek.com/ | OpenAI/Anthropic 호환; agent tools 연동 |
| Agent Integrations (hub) | https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code | Claude Code 등 기존 harness에 모델로 꽂기 |
| Reasonix | https://api-docs.deepseek.com/quick_start/agent_integrations/reasonix | DeepSeek-native TUI; cache-first; tool-call repair (3rd party, disclaimer) |
| nanobot 등 | 동일 Agent Integrations 트리 | 서드파티 에이전트 목록 |
| Thinking Mode | https://api-docs.deepseek.com/guides/thinking_mode | reasoning_effort / thinking |
| Tool Calls | https://api-docs.deepseek.com/guides/tool_calls | function calling |
| KV Cache / Context Caching | https://api-docs.deepseek.com/guides/kv_cache | 캐시 히트 비용 |
| Chat Prefix Completion | https://api-docs.deepseek.com/guides/chat_prefix_completion | 출력 형식 강제 패턴 |
| Anthropic API compat | https://api-docs.deepseek.com/guides/anthropic_api | Claude Code류 호환 경로 |

### 4.2 통찰 요약 (공식 입장의 성격)

DeepSeek 공식 문서는 **“자체 장문 Harness Engineering 에세이”보다 “모델을 어떤 에이전트 런타임에 연결하는가”**에 무게가 있다.

- 전략: **호환성** — OpenAI/Anthropic SDK·Claude Code·OpenCode·Copilot에 backend로 사용.
- Reasonix(공식 목록, 단 3rd-party 면책): cache-first loop, flash-first cost, automatic tool-call repair, 번역 shim 없이 `api.deepseek.com`.
- Flash vs Pro 라우팅 (`/pro`, `/preset max`) — **비용-품질을 harness UX에 노출**.
- Thinking / tool_calls / KV cache = 에이전트 루프 설계자가 만져야 할 API 레버.
- Prefix completion = ACI 수준의 출력 제약 기법.

**한계(정직하게):** Anthropic/OpenAI급 “long-running harness case study”는 공식 사이트에서 찾기 어렵다. 학습 시 DeepSeek는 **모델+캐시+툴콜 계약**, harness 패턴은 Claude Code/Codex/Cursor 쪽 공식 글을 참고하는 구조.

### 4.3 SuperLiora 메모

- kosong/provider 라우팅 + Flash/Pro식 effort 스위치는 제품적으로 유사 기회.
- TUI 네이티브(Reasonix) 서술과 SuperLiora TUI 포지션 비교 가능.

---

## 5. z.ai (Zhipu / GLM Coding)

### 5.1 공식 문서 목록

| 문서 | URL | 핵심 |
|---|---|---|
| **Best Practice** | https://docs.z.ai/devpack/resources/best-practice | Prompts·Plans·Skills·Workflows 프레임 |
| **Memory mechanism** | https://docs.z.ai/devpack/resources/memory-mechanism | 계층 메모리, instruction vs learning |
| GLM-5.2 guide | https://docs.z.ai/guides/llm/glm-5.2 | long-horizon coding, `/goal`, standards in md |
| Thinking mode | https://docs.z.ai/guides/capabilities/thinking-mode | Preserved / Interleaved / turn-level thinking |
| Function calling | https://docs.z.ai/guides/capabilities/function-calling | single-responsibility tools, validation |
| Devpack overview / quick start | https://docs.z.ai/devpack/overview.md | Coding Plan 제품 문맥 |
| MCP servers (reader/search/vision/…) | https://docs.z.ai/devpack/mcp/… | 외부 컨텍스트 |

### 5.2 통찰 요약

**Best Practice 프레임 (공식 종합 — 타사 공식 가이드를 흡수한 형태)**

1. Collaborator not one-shot Q&A — 가치 = model × workflow.
2. Task input 4요소: **Goal · Context · Constraints · Done when**.
3. Complex → Plan before code.
4. Long-lived rules → project config files; temporary → prompt.
5. Execution environment가 능력 상한.
6. Full dev loop (read/edit/run/verify), not generate-only.
7. MCP로 repo 밖 실시간 정보.
8. Skills로 반복 워크플로 패키징.
9. Automation (schedule/trigger).

**Memory mechanism**

- Short-term (session) vs Long-term (semantic / episodic / procedural).
- **Instruction memory ≠ Learning memory** — 섞으면 drift.
- 계층: Organization → Project → User → Local → Role/subagent.
- 규칙 파일 <200줄, 구체·검증 가능 문구; path-scoped rules.
- Compaction 후 남는 것은 **디스크에 쓴 메모리뿐**.

**GLM-5.2 / Thinking**

- `/goal`로 검증 가능한 장기 작업.
- Preserved thinking (`clear_thinking: false`) — reasoning_content를 그대로 반환해 캐시·연속성.
- Turn-level thinking으로 비용 조절.

### 5.3 SuperLiora 메모

- z.ai Best Practice는 사실상 업계 수렴본 → SuperLiora 온보딩 체크리스트로 재사용하기 좋음.
- Instruction vs Learning memory 분리는 ACE/포이즈닝 방어와 직결.

---

## 6. Cursor

### 6.1 공식 문서 목록

| 문서 | URL | 핵심 |
|---|---|---|
| **Best practices for coding with agents** | https://cursor.com/blog/agent-best-practices | Harness=Instructions+Tools+Model; Plan; Rules/Skills |
| Customizing agents (Learn) | https://cursor.com/learn/customizing-agents | Rules vs Skills 표 |
| Rules | https://cursor.com/docs/rules.md | always/globs/intelligent; <500 lines; ratchet |
| Skills | https://cursor.com/docs/skills.md · help/customization/skills | on-demand workflows |
| Dynamic context discovery (blog) | https://cursor.com/blog/dynamic-context-discovery | skills/context 동적 로드 |

### 6.2 통찰 요약

**Harness 정의 (Cursor 공식)**

```
1. Instructions (system + rules)
2. Tools (edit, search, terminal, …)
3. Model
```

- **모델마다 harness를 다르게 튜닝** (evals). 사용자는 모델 스왑에 집중.
- Plan Mode: research → questions → plan markdown → approve → build; `.cursor/plans/` 저장.
- 실패 시 follow-up보다 **plan으로 되돌아가 재실행**이 빠른 경우 많음.
- Context: 에이전트 검색에 맡기기; 관련 없는 `@`는 독.
- 새 대화 타이밍: 작업 단위가 끝나면 / 혼란·반복 실수 시.
- `@Past Chats`로 선택적 이력 참조 (전체 복붙 금지).
- **Rules** = always-on; **Skills** = dynamic. AGENTS.md = 크로스툴 단순 SSOT.
- Rules BP: linter 대체 금지, 파일 참조, 반복 실수에만 추가 (ratchet).
- Hooks / custom `/` commands.

### 6.3 SuperLiora 메모

- Cursor의 “model-specific harness tuning”은 kosong+프로필 전략의 제품화 버전.
- write-tui / skills / nested AGENTS = Rules/Skills 이분법과 동일.

---

## 7. 벤더별 “한 문장 포지션”

| 벤더 | 공식 목소리 |
|---|---|
| **Anthropic** | 단순 루프 + ACI + long-horizon artifacts; harness는 모델과 함께 진화; meta-harness로 인터페이스 고정 |
| **OpenAI** | Agent-first repo: 짧은 AGENTS 맵 + 기계적 린트 + legible observability; humans design loops |
| **Google** | Managed sandbox harness + 프로토콜; LLM은 추론, 결정은 코드; harness는 일시적일 수 있음 |
| **DeepSeek** | 강한 코딩 모델을 **기존/네이티브 에이전트에 호환 연결**; cache·thinking·tool repair 레버 |
| **z.ai** | 실무 프레임(Goal/Context/Constraints/Done) + 계층 메모리 + GLM thinking/`/goal` |
| **Cursor** | Instructions×Tools×Model을 모델별로 조율; Plan/Rules/Skills로 사용자 측 harness 커스텀 |

---

## 8. 패턴 매트릭스 (누가 무엇을 강조했나)

| 패턴 | Ant | OAI | Google | DS | z.ai | Cursor |
|---|---|---|---|---|---|---|
| Workflow before agent | ● | ○ | ○ | | ○ | ○ |
| ACI / tool docs | ● | ○ | ○ | ○ | ○ | ○ |
| AGENTS/CLAUDE map | ● | ● | ● | (via hosts) | ● | ● |
| Progressive docs | ● | ● | ○ | | ● | ● |
| Mechanical lint/hooks | ○ | ● | ● | | ○ | ● |
| Plan mode | ● | ○ | | | ● | ● |
| Verify / stop gates | ● | ● | ● | | ● | ● |
| Compaction / session object | ● | ● | ● | KV cache | preserved thinking | summary |
| Initializer / long-run | ● | ○ | | | `/goal` | long runs |
| Brain≠Hands / meta-harness | ● | | ● sandbox | | | |
| Model-tuned harness | ○ | ○ | ○ | Flash/Pro | effort | ● |
| Self-mod repo culture | | ● | | | | |
| Protocol soup (MCP/A2A) | ○ | ○ | ● | | ○ | ○ |

● = 강하게 공식 서술 · ○ = 부분적

---

## 9. SuperLiora가 벤더 공식에서 가져갈 액션 아이템

| 출처 | 액션 |
|---|---|
| Anthropic ACI | 툴 설명·절대경로·에러 메시지 poka-yoke 감사 |
| Anthropic Managed Agents | session/log를 context와 분리하는 인터페이스 점검 |
| OpenAI Harness eng. | AGENTS를 목차로 유지; docs CI/gardening; lint 메시지에 remediation |
| OpenAI Legibility | TUI/로그/메트릭을 에이전트가 쿼리 가능하게 |
| Google Bake-Off | harness 모듈화·폐기 가능; schema→결정적 실행 |
| Google/Ant hooks | Pre/Post tool sensors 강화 |
| z.ai memory | instruction vs learning 파일 분리 |
| Cursor | Plan-first UX; Rules 비대화 방지; Skills on-demand |
| DeepSeek | provider별 cache/thinking 레버를 루프에 노출 |

---

## 10. 읽기 순서 (반나절)

1. Anthropic — Building Effective Agents (30m)  
2. OpenAI — Harness engineering (30m)  
3. Anthropic — Long-running harness + Managed Agents (45m)  
4. Cursor — Agent best practices (20m)  
5. z.ai — Best practice + Memory (30m)  
6. Google — Agents overview + Bake-Off (20m)  
7. DeepSeek — Agent integrations + Thinking/KV cache (15m)

이론 스택과의 연결: [01](./01-maturity-stack.md) · [04](./04-harness-engineering.md) · [09](./09-self-improving-agents.md)

---

## 11. 수집 한계 / 면책

- DeepSeek·일부 z.ai 페이지는 **제품 통합 가이드** 비중이 크고, Anthropic/OpenAI급 장문 케이스 스터디는 적다.
- Reasonix 등 DeepSeek “Agent Integrations” 항목은 공식 목록이어도 **3rd-party 면책**이 붙는다.
- 벤치·TTFT 수치는 벤더 자사 보고 — 재현 없이 인용 주의.
- URL·제품명(Antigravity, Managed Agents, Codex)은 2026-07 시점; 이후 rename 가능.
