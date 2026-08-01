# 01 — 성숙도 스택: Prompt → Context → Harness → Loop

## 1. 왜 “스택”인가

각 층은 유행어가 아니라 **병목이 이동한 자리**다.

| 시기 | 병목 | 사람들이 한 일 |
|---|---|---|
| 2022–2023 | 말이 안 통함 | few-shot, CoT, 포맷 지시 |
| 2024–2025 | 코드베이스를 모름 | RAG, rules 파일, MCP, 메모리 |
| 2025–2026 초 | 알아서 하다가 망가짐 | 훅, 센서, 권한, 관측 |
| 2026 중반~ | 사람 없이 오래 못 돔 | 루프 스펙, Ralph, handoff |

한 층을 “죽었다”고 선언하는 헤드라인은 과장이다. Prompt는 없어지지 않았다. **프롬프트가 하네스 안의 한 부품으로 재분류**됐을 뿐이다 (Atlan 등: “prompt engineering did not die; it was reclassified”).

## 2. 네 층의 정의

### Prompt Engineering

한 번의(또는 짧은) 모델 호출에서 **언어로 행동을 빚는** 기술.

- 역할, 제약, 출력 스키마, few-shot
- CoT / Self-Consistency / Plan-and-Solve 등 “생각의 형태”
- 여전히: 도구 설명 문구, 스킬 SKILL.md, stop-hook 메시지, 루프 안 프롬프트

### Context Engineering

유한한 컨텍스트 창에 **무엇을, 언제, 어떤 순서로** 넣을지 설계하는 기술.

LangChain 등이 정리한 네 레버:

| 레버 | 의미 | 코딩 에이전트 예 |
|---|---|---|
| **Write** | 창 밖으로 밀어낸다 | `PLAN.md`, git, progress 파일 |
| **Select** | 필요한 것만 끌어온다 | JIT 파일 읽기, skill progressive disclosure, tool RAG |
| **Compress** | 줄여서 남긴다 | compaction, tool-result truncation, context editing |
| **Isolate** | 분리해서 오염을 막는다 | subagent, worktree, swarm 역할 분리 |

Survey: *A Survey of Context Engineering for Large Language Models* (arXiv:2507.13334, 2025) — 구성 요소(검색·처리·관리)와 시스템(RAG·메모리·툴·멀티에이전트) 지도.

### Harness Engineering

모델 주변의 **운영 환경 전체**를 설계하는 기술.

```
하네스 ⊃ 컨텍스트 파이프라인 + 가이드 + 센서 + 도구 + 메모리
       + 오케스트레이션 + 훅 + 권한 + 샌드박스 + 관측성
```

공식 정의에 가까운 실무 문구 (Hashimoto, 2026 초):

> Anytime you find an agent makes a mistake, you take the time to engineer a solution such that the agent never makes that mistake again.

Böckeler (Thoughtworks / Fowler): **Guides**(feedforward) vs **Sensors**(feedback).

### Loop Engineering

하네스가 이미 제공하는 내부 `perceive → act → observe` 사이클 **위**에, 사람이 설계하는 **외부 Loop Specification**을 올리는 기술.

arXiv:2607.00038 (*Stop Hand-Holding Your Coding Agent*, 2026-06):

> stop prompting your agent, start designing the loop that prompts it

루프 스펙 ≠ 프로그래밍 for-loop ≠ 하네스 내부 ReAct 루프.  
루프 스펙 = **트리거 + 목표 + 검증 + 정지 규칙 + 메모리**.

## 3. 세 가지 “루프”를 헷갈리지 말 것

| 이름 | 무엇인가 | 누가 설계하나 |
|---|---|---|
| Programming loop | `for` / `while` | 개발자 코드 |
| Internal agent cycle | 툴 호출 반복 (ReAct 계열) | 하네스 기본 제공 |
| **Loop specification** | 언제 깨우고, 뭐가 done인지, 언제 멈추는지 | **루프 엔지니어 (사람)** |

내부 사이클은 “엔진”, 루프 스펙은 “파일럿”.

## 4. 벤치가 말해준 것 (하네스 > 모델 스왑)

실무 글에서 반복되는 관찰 (Osmani / Faros / amux 등, 2026):

- Terminal-Bench류에서 **같은 모델, 다른 하네스** → 큰 점수 차
- LangChain 팀 사례: 모델 고정, 하네스만 바꿔 Top 30 → Top 5 급 이동 (보도·벤치 해석은 출처 확인)
- 오픈 웨이트 + 강한 하네스가 비싼 프론티어 라우트에 근접하는 평가도 보고됨 (Faros 등)

교훈: 모델은 렌트되고 가격이 바뀐다. **하네스는 git에 남고 복리로 쌓인다.**

## 5. 실패 모드 → 어느 층이 답인가

| 실패 | 1차 의심 층 | 전형적 처방 |
|---|---|---|
| 포맷/스키마 틀림 | Prompt | JSON schema, few-shot |
| 레포 관습 무시 | Context | 짧은 `AGENTS.md`, nested rules |
| 같은 실수 반복 | Harness | ratchet: hook / lint / test |
| 긴 작업 중반에 승리 선언 | Harness + Loop | feature JSON + verifier |
| 컨텍스트 가득 차며 품질 붕괴 | Context | reset + handoff / Ralph |
| 자기 자신을 A+로 채점 | Loop / Harness | maker ≠ checker |
| 밤새 돌리다 비용만 씀 | Loop | budget + named terminal states |

## 6. SuperLiora 한 장 투영

```
Prompt   → system / skill SKILL.md / tool descriptions / plan prompts
Context  → AGENTS.md, skills progressive load, memory, compaction, TUI stream truncation
Harness  → tools, permissions, hooks, profiles, kaos sandbox, observability, check:test-baseline
Loop     → agentic-goal-loop, ultraplan / ultraswarm, session handoff artifacts, CI gates
```

자세한 대응표는 [07-superliora-mapping](./07-superliora-mapping.md).

## 7. 이 장의 체크

- [ ] 네 층을 “대체”가 아니라 “흡수”로 설명할 수 있다
- [ ] Guides vs Sensors를 구분한다
- [ ] Internal cycle vs Loop Spec을 구분한다
- [ ] 실패 하나를 골라 “어느 층에 래칫을 박을지” 말할 수 있다

다음: [02 — Prompt Engineering](./02-prompt-engineering.md)
