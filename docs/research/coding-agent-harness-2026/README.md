# Coding Agent Harness — 2026 중후반 학습 커리큘럼

> 기준일: 2026-07-31  
> 대상: SuperLiora 기여자 · 하네스 설계자 · TUI 코딩 에이전트를 깊게 이해하고 싶은 엔지니어  
> 성격: **학습 자료 / 연구 요약**. 제품 사용자 문서(`docs/en`, `apps/site`)가 아님.

## 한 줄 요약

2026년 중후반, 코딩 에이전트의 성패는 모델보다 **모델 주변을 어떻게 설계하느냐**에 달려 있다.

```
Agent = Model + Harness
```

성숙도 스택은 네 층이다. 각 층은 이전 층을 **대체하지 않고 흡수**한다.

| 층 | 핵심 질문 | 대략 시기 |
|---|---|---|
| **Prompt Engineering** | 어떻게 말할까? | 2022–2024 |
| **Context Engineering** | 무엇을 알게 할까? | 2024–2025 |
| **Harness Engineering** | 어떻게 행동·자기수정하게 할까? | 2025–2026 |
| **Loop Engineering** | 사람이 매 스텝을 안 붙잡고도 돌게 할까? | 2026 중반~ |

## 읽는 순서 (권장)

1. [01 — 성숙도 스택](./01-maturity-stack.md) — 전체 지도
2. [02 — Prompt Engineering](./02-prompt-engineering.md) — 여전히 필요한 층
3. [03 — Context Engineering](./03-context-engineering.md) — Write / Select / Compress / Isolate
4. [04 — Harness Engineering](./04-harness-engineering.md) — Guides · Sensors · Ratchet
5. [05 — Loop Engineering](./05-loop-engineering.md) — Loop Spec · Verification Ladder
6. [06 — 필수 체크리스트](./06-essential-checklist.md) — 실전 적용표
7. [07 — SuperLiora 매핑](./07-superliora-mapping.md) — 이 레포에 어떻게 대응되는가
8. [08 — 참고문헌](./08-references.md) — 논문 · 벤더 포스트 · 실무 글
9. [09 — Self-Improving Agents](./09-self-improving-agents.md) — ACE · DGM · HGM · RQGM · Trace→Skill · 안전
10. [10 — 벤더 공식 Harness 카탈로그](./10-vendor-official-harness.md) — Anthropic · OpenAI · Google · DeepSeek · z.ai · Cursor
11. [11 — OSS 경쟁 하네스 교차분석](./11-competitive-oss-analysis.md) — OpenCode · Grok Build · Hermes · OpenHands
12. 재설계 스펙(부록): [`docs/specs/2026-07-31-sota-harness-redesign.md`](../../specs/2026-07-31-sota-harness-redesign.md) — 기술 페이즈 A–F
13. **Sovereign Reform SSOT:** [`docs/specs/2026-07-31-superliora-sovereign-reform.md`](../../specs/2026-07-31-superliora-sovereign-reform.md) — 딥리서치·Never-Halt·Ops Theatre·오케스트레이션·캐시99%·RepoIndex·debrand
14. **Deep Research / Ops 부록:** [`docs/specs/2026-07-31-deep-research-never-halt-ops-tui.md`](../../specs/2026-07-31-deep-research-never-halt-ops-tui.md) — 검색 Ch1–6 · 무인 복구 · 도파민 Ops TUI

## 학습 목표

이 커리큘럼을 끝내면 다음을 설명할 수 있어야 한다.

- 왜 같은 모델이 하네스만 바꿔도 벤치에서 수십 점 차이 나는가
- Guides(사전 안내)와 Sensors(사후 검증)의 역할 분담
- Compaction vs Context Reset의 차이, 언제 무엇을 쓰는가
- Loop Specification의 5요소(트리거·목표·검증·정지·메모리)
- Verification Ladder L1–L5와 “자율 구간”
- SuperLiora의 `AGENTS.md` / skills / hooks / loop / swarm / plan이 위 이론의 어디에 꽂히는가
- Self-improving의 개선 표면(L0–L5), ACE playbook, DGM류 코드 자기수정, 메모리 포이즈닝을 구분한다

## 핵심 슬로건 (현장에서 실제로 쓰이는 말)

| 슬로건 | 의미 |
|---|---|
| Agent = Model + Harness | 모델만으로는 에이전트가 아니다 |
| Ratchet | 실수는 고치지 말고, **재발 불가 구조**로 남긴다 |
| Stop prompting, design the loop | 매 턴 지시 대신, 스스로 돌 루프를 설계한다 |
| Sensors > Guides (enforcement) | 문장 규칙은 ~70%, 훅/테스트는 ~100% |
| Information parity | 인간만 아는 관습은 하네스 구멍이다 |

## SuperLiora와의 관계

SuperLiora는 TUI 우선 코딩 에이전트다. 이 자료는 “마케팅 주장”이 아니라 **업계 이론을 SuperLiora 구현 축에 투영**하기 위한 내부 학습서다.

이미 레포에 있는 관련 스펙:

- [`docs/specs/2026-07-12-superliora-harness-minimization-roadmap.md`](../../specs/2026-07-12-superliora-harness-minimization-roadmap.md)
- [`docs/specs/2026-07-12-superliora-tool-redundancy-review.md`](../../specs/2026-07-12-superliora-tool-redundancy-review.md)
- [`docs/specs/2026-07-31-superliora-sovereign-reform.md`](../../specs/2026-07-31-superliora-sovereign-reform.md) — **현행 개혁 SSOT**
- [`docs/specs/2026-07-31-sota-harness-redesign.md`](../../specs/2026-07-31-sota-harness-redesign.md) — 기술 부록
- root / nested `AGENTS.md`, `.agents/skills/*`, `packages/agent-core` loop·skill·memory

## 면책

- 벤치 수치·벤더 주장은 출처 시점에 의존한다. 재현 실험 없이 “절대 진리”로 쓰지 말 것.
- arXiv preprint·블로그는 peer-review 여부가 다르다. [08-references](./08-references.md)에 등급을 표시했다.
- 제품 공개 문서가 필요하면 `apps/site/` 경로로 옮긴다 (`docs/AGENTS.md` 규칙).
