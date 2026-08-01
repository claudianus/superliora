# 08 — 참고문헌 & 출처

등급: **A** = 1급 원전(벤더 엔지니어링/피어리뷰·주요 survey), **B** = 실무 장문·입문서, **C** = 보조/요약/도구 문서.  
수치는 출처 시점에 묶여 있다. 재인용 전 원문을 확인할 것.

## 1. Harness Engineering

| 등급 | 자료 | URL / ID |
|---|---|---|
| A | Anthropic — *Effective harnesses for long-running agents* (2025-11) | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents |
| A | Anthropic — *Harness design for long-running application development* | https://www.anthropic.com/engineering/harness-design-long-running-apps |
| B | Faros — *Harness Engineering: Making AI Coding Agents Work in 2026* | https://www.faros.ai/blog/harness-engineering |
| B | amux — *Harness Engineering: The Complete Guide (2026)* | https://amux.io/guides/harness-engineering/ |
| B | capitalandcompute — *Harness Engineering in 2026: Techniques Beyond MCP* | https://capitalandcompute.net/blog/harness-engineering-techniques-2026/ |
| B | Sakasegawa — *Harness Engineering Best Practices (2026)* | https://nyosegawa.com/en/posts/harness-engineering-best-practices-2026/ |
| B | jrenaldi79/harness-engineering (field guide + skills) | https://github.com/jrenaldi79/harness-engineering/ |
| C | Addy Osmani — Agent Harness Engineering (O'Reilly Radar 등 인용) | 검색어: `Agent Harness Engineering Osmani 2026` |

핵심 인용 개념: `Agent = Model + Harness`, Guides/Sensors, Ratchet, initializer/coding agent.

## 2. Loop Engineering

| 등급 | 자료 | URL / ID |
|---|---|---|
| A | Macedo — *Stop Hand-Holding Your Coding Agent…* (2026-06-28) | arXiv:2607.00038 · https://arxiv.org/abs/2607.00038 |
| B | Emergent Mind — Loop Specification topic | https://www.emergentmind.com/topics/loop-specification |
| B | Geoffrey Huntley — Ralph technique (2025-07) | 검색어: `Ralph Wiggum Claude Code Huntley` |
| B | agentic-goal-loop / `/goal` (catalog skill) | `packages/agent-core/src/skill/catalog/agentic-goal-loop` |

핵심 인용 개념: Loop Specification, Verification Ladder L1–L5, named terminal states, maker≠checker.

## 3. Context Engineering

| 등급 | 자료 | URL / ID |
|---|---|---|
| A | *A Survey of Context Engineering for Large Language Models* | arXiv:2507.13334 |
| A | LangChain — *Context Engineering for Agents* | https://www.langchain.com/blog/context-engineering-for-agents |
| B | Digital Applied — *Context Engineering: Agent Reliability Playbook 2026* | https://www.digitalapplied.com/blog/context-engineering-agent-reliability-playbook-2026 |
| A | Agentic Memory (ACL 2026) | https://aclanthology.org/2026.acl-long.981.pdf |
| B | Chroma — context rot / long-context degradation studies (2025, 다수 인용) | 검색어: `Chroma context rot 2025` |

핵심 인용 개념: Write/Select/Compress/Isolate, compaction vs reset, context anxiety.

## 4. Prompt / Agent Foundations

| 등급 | 자료 | 비고 |
|---|---|---|
| A | Wei et al. — Chain-of-Thought | 사고 유도 |
| A | Yao et al. — ReAct | 툴 루프 조상 |
| A | Yao et al. — Tree of Thoughts | 탐색 |
| A | Shinn et al. — Reflexion | 구두 교훈 메모리 |
| A | Madaan et al. — Self-Refine | 자기 수정 한계와 함께 읽을 것 |
| A | Schick et al. — Toolformer | 툴 호출 학습 |
| B | Anthropic — workflow vs agent 가이드 | 고정 워크플로 vs 열린 루프 |

전체 계보는 arXiv:2607.00038 §Background가 잘 압축한다.

## 5. AGENTS.md / Skills / Workflow

| 등급 | 자료 | URL |
|---|---|---|
| B | Red Hat — *Standardize project context with AGENTS.md and Agent Skills* (2026-07) | https://developers.redhat.com/articles/2026/07/27/standardize-project-context-agentsmd-and-agent-skills |
| B | youngju — *AI Coding Workflow Best Practices in 2026* | https://www.youngju.dev/blog/culture/2026-05-14-ai-coding-workflow-best-practices-2026-claude-md-agents-md-cursorrules-subagent-skill-design-deep-dive.en |
| B | maketocreate — *CLAUDE.md Best Practices 2026* | https://maketocreate.com/claude-md-best-practices-the-complete-2026-guide/ |
| B | tianpan — *CLAUDE.md and AGENTS.md* | https://tianpan.co/blog/2026-02-25-claude-md-agents-md-ai-coding-agent-instruction-files |
| C | AAIF / AGENTS.md 표준화 소식 (2025-12 기증 보도) | Linux Foundation Agentic AI Foundation |

## 6. SuperLiora 내부

| 자료 | 경로 |
|---|---|
| Harness minimization roadmap | `docs/specs/2026-07-12-superliora-harness-minimization-roadmap.md` |
| Tool redundancy review | `docs/specs/2026-07-12-superliora-tool-redundancy-review.md` |
| Sovereign harness reform (SSOT) | `docs/specs/2026-07-31-superliora-sovereign-reform.md` |
| Deep research · never-halt · ops TUI | `docs/specs/2026-07-31-deep-research-never-halt-ops-tui.md` |
| SOTA harness redesign (annex) | `docs/specs/2026-07-31-sota-harness-redesign.md` |
| OSS competitive analysis | `docs/research/coding-agent-harness-2026/11-competitive-oss-analysis.md` |
| OpenCode (official) | https://github.com/anomalyco/opencode |
| Grok Build (official) | https://github.com/xai-org/grok-build |
| Hermes Agent | https://github.com/NousResearch/hermes-agent |
| OpenHands (Agent Canvas) | https://github.com/OpenHands/OpenHands |
| Ultraswarm / Ultraplan specs | `docs/specs/2026-07-09-*` |
| Repo agent guide | `AGENTS.md` |
| agent-core guide | `packages/agent-core/AGENTS.md` |
| write-tui skill | `.agents/skills/write-tui/SKILL.md` |
| Goal loop skill | `packages/agent-core/src/skill/catalog/agentic-goal-loop/SKILL.md` |

## 7. 타임라인 (학습용)

```
2022–23  Prompt era (CoT, instruction tuning UX)
2023–24  ReAct / tool agents mainstream
2024–25  Context engineering named; MCP; AGENTS.md spread
2025-07  Ralph technique public
2025-11  Anthropic long-running harness post
2025-12  AGENTS.md → AAIF; MCP ecosystem consolidation
2026-Q1  “Harness engineering” term hardens (Hashimoto et al.)
2026-Q2  Spec-driven IDEs/kits; evaluator splits widely discussed
2026-06  Loop engineering paper + Loop Library discourse
2026-07  (now) Techniques-beyond-MCP inventories; open+harness routing
```

## 8. Self-Improving Agents

상세: [09-self-improving-agents](./09-self-improving-agents.md)

| 등급 | 자료 | ID |
|---|---|---|
| A | ACE (Agentic Context Engineering) | arXiv:2510.04618 · ICLR 2026 |
| A | Darwin Gödel Machine | arXiv:2505.22954 |
| A | Huxley-Gödel Machine | arXiv:2510.21614 |
| A | Hyperagents | arXiv:2603.19461 |
| A | Red Queen Gödel Machine | arXiv:2606.26294 |
| A | ADAS / Meta Agent Search | arXiv:2408.08435 · ICLR 2025 |
| A | Socratic-SWE / Trace2Skill / Skill-DisCo | 2606.07412 / 2603.25158 / 2606.26669 |
| A | Safety in Self-Evolving · Zombie Agents | 2606.23075 / 2602.15654 |


## 10. Vendor official harness docs

상세 카탈로그: [10-vendor-official-harness](./10-vendor-official-harness.md)

| Vendor | Flagship |
|---|---|
| Anthropic | building-effective-agents · long-running harness · managed-agents · claude-code-best-practices |
| OpenAI | openai.com/index/harness-engineering · unrolling-the-codex-agent-loop · Codex best practices |
| Google | ai.google.dev Gemini Agents / Antigravity · Bake-Off 5 tips |
| DeepSeek | api-docs agent_integrations · thinking · kv_cache · tool_calls |
| z.ai | docs.z.ai best-practice · memory-mechanism · GLM-5.2 · thinking-mode |
| Cursor | cursor.com/blog/agent-best-practices · docs/rules · docs/skills |

## 9. 인용 시 주의

- 벤치 점수·“N점 향상”은 하네스·프롬프트·툴 버전에 민감하다.
- 블로그의 벤더 포스트는 자사 제품 편향이 있다. **패턴**을 가져오고 **숫자**는 재검증.
- Preprint(arXiv:2607.00038)는 position + corpus study다. 통제 실험 벤치마크는 저자도 future work로 둔다.
- Self-improve 벤치(SWE↑)는 **메타생산성**과 어긋날 수 있다 (HGM).
