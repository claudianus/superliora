# 09 — Self-Improving Agents (딥리서치)

> 기준일: 2026-07-31  
> 선행 권장: [01 성숙도 스택](./01-maturity-stack.md) · [03 Context](./03-context-engineering.md) · [04 Harness](./04-harness-engineering.md) · [05 Loop](./05-loop-engineering.md)

## 한 줄 요약

Self-improving agent = **한 번의 성공이 아니라, 다음 시도의 기대 성능을 올리는 피드백 루프**를 가진 에이전트.

가중치를 바꾸지 않아도 된다. 2025–2026 주류는 **컨텍스트·스킬·하네스 코드·평가기**를 진화시키는 쪽이다. 가중치 학습은 상위(비싸고 느린) 옵션.

```
개선 표면 (가까운 것 → 먼 것)

  episode reflection  →  memory / playbook (ACE)
       →  reusable skills (Trace2Skill / Socratic-SWE)
       →  harness code rewrite (DGM / HGM / Hyperagents)
       →  co-evolve evaluator (RQGM)
       →  weight / FM training  (미래·고비용)
```

---

## 1. “Self-improving”이 아닌 것

| 착각 | 실제 |
|---|---|
| 한 세션 안에서 Self-Refine 한 번 | **within-task** 수정이지 continual improvement가 아님 |
| 모델이 “더 똑똑해졌다”고 느낌 | 컨텍스트가 좋아진 것일 수 있음 |
| MEMORY.md에 아무거나 append | 오염·붕괴 가능 (아래 §6) |
| 벤치 점수↑ = 자기개량 능력↑ | **Metaproductivity–Performance Mismatch** (HGM) |

루프 엔지니어링의 내부 사이클과 구분:

- **Internal cycle**: 지금 태스크를 푸는 ReAct 루프
- **Self-improvement loop**: 태스크 밖(또는 메타 레벨)에서 **에이전트 자체**를 바꾸는 루프

---

## 2. 개선 표면 택소노미

무엇을 바꾸느냐로 나눈다. 실무·논문이 같은 축을 쓴다.

| Level | 표면 | 대표 | 속도 | 위험 |
|---|---|---|---|---|
| **L0** | Episode critique | Reflexion, Self-Refine | 즉시 | 약한 일반화 |
| **L1** | Context / memory playbook | ACE, Dynamic Cheatsheet, ratchet `AGENTS.md` | 빠름 | context collapse, memory poisoning |
| **L2** | Skills / procedures | Voyager skill lib, Trace2Skill, Skill-DisCo, Socratic-SWE | 중 | 잘못된 스킬 고착 |
| **L3** | Harness / agent code | ADAS, DGM, HGM, Hyperagents | 느림·비쌈 | 자기수정 사고, sandbox 필수 |
| **L4** | Evaluator / utility | RQGM (Red Queen) | 중–느림 | reward hacking 전쟁 |
| **L5** | Model weights | SEAL류, RL on trajectories | 매우 비쌈 | 정렬·회귀 |

**프로덕션 코딩 에이전트(SuperLiora 포함)의 현실적 기본선: L0–L2 + 사람 래칫.**  
L3+는 연구/오프라인 실험 또는 강하게 샌드박스된 메타러닝.

---

## 3. 계보 (필수)

### 3.1 이론: Gödel Machine (Schmidhuber)

자기 코드를 **증명 가능하게 이로운** 경우에만 재작성.  
실무 불가능에 가깝다 → 후속 연구들이 **empirical validation**으로 완화.

### 3.2 Within-task / verbal RL

| 작업 | 요지 |
|---|---|
| **Reflexion** (Shinn et al.) | 실패 → 구두 교훈 → 다음 시도에 주입 |
| **Self-Refine** | generate → critique → revise |
| **TextGrad / GEPA** | 자연어 “gradient”로 프롬프트 최적화 |
| **Voyager** | 스킬 라이브러리 + 자동 커리큘럼 (Minecraft) |

한계: unaided self-correction은 외부 피드백 없이 불안정 (루프 논문·자기수정 문헌과 동일 결론).

### 3.3 ADAS — Automated Design of Agentic Systems

Hu et al., ICLR 2025 (arXiv:2408.08435).

- 에이전트 설계를 **검색 문제**로
- **Meta Agent Search**: 고정 메타에이전트가 코드로 새 에이전트를 프로그래밍
- archive of discoveries, 도메인·모델 전이 관찰

DGM과의 차이 (DGM 저자 주장): ADAS는 **고정 메타에이전트**. DGM은 **자기참조** — 푸는 에이전트와 개량하는 에이전트가 동일 계열.

2026 survey (Madžar & Mekterović): ADAS를 4축으로 정리 — optimization target · search strategy · representation · feedback signal. 33개 방법 분류.

---

## 4. 2025–2026 핵심 논문/시스템

### 4.1 ACE — Agentic Context Engineering (ICLR 2026)

arXiv:2510.04618 · Zhang et al. (Stanford / SambaNova 등)

**주장:** 가중치 대신 컨텍스트를 진화시키되, “짧게 요약”하면 망한다.

| 실패 | 내용 |
|---|---|
| **Brevity bias** | 프롬프트 최적화가 짧은 일반 문구로 붕괴 |
| **Context collapse** | 통째 재작성 시 18k→122 토큰처럼 정보 증발 + 성능↓ |

**구조 (역할 분리):**

```
Generator  → 궤적 생성
Reflector  → 성공/실패에서 인사이트
Curator    → structured delta를 playbook에 병합 (비-LLM 병합 가능)
```

**장치:**

- Incremental **delta updates** (아이템화된 bullet + helpful/harmful 카운터)
- **Grow-and-refine** (append + 의미 중복 제거)
- 라벨 없이도 **execution feedback**로 적응

보고 수치 (논문): agents +10.6%, finance +8.6%, AppWorld에서 작은 OSS 모델로 상위 production agent에 근접/상회하는 split.

→ 하네스 커리큘럼의 Context/Harness와 직결: **playbook = evolving Guides**, Reflector/Curator = Sensors의 학습 변형.

### 4.2 Darwin Gödel Machine (DGM)

arXiv:2505.22954 · Sakana AI + Clune lab (UBC)

**아이디어:** 코딩 에이전트가 **자기 코드베이스를 수정**하고, 벤치로 empirical 검증.  
FM은 frozen. 개선 대상 = 툴·워크플로·컨텍스트 관리·피어리뷰 등 **하네스**.

루프:

```
archive의 parent 샘플
  → self-modify (자기 repo 편집)
  → benchmark evaluate
  → archive에 추가 (편집 능력 유지한 것만)
  → open-ended 탐색 (stepping stones 유지)
```

보고: SWE-bench 20%→50%, Polyglot 14.2%→30.7% (설정·서브셋 주의).  
베이스라인 대비: self-improve 없음 / archive 없음 둘 다 열등.

안전: sandbox, human oversight, 수정 traceability (논문 §5).

### 4.3 Huxley-Gödel Machine (HGM)

arXiv:2510.21614

**Metaproductivity–Performance Mismatch:**  
지금 벤치 점수 높음 ≠ 이후 self-modify에 유리.

**CMP (clade-metaproductivity):** 자손 성능 집합으로 “개량 잠재력” 추정.  
HGM은 CMP 추정치로 탐색 가이딩 → 더 적은 CPU로 DGM류 능가, 전이 실험에서 human-level급 보고 (설정·모델 의존, 원문 확인).

교훈: **자기개량 루프의 선택 압력 설계가 점수 최적화와 다를 수 있다.**

### 4.4 Hyperagents / DGM-H

arXiv:2603.19461

Task agent + Meta agent를 **하나의 editable program**으로 통합.  
메타 수정 절차 자체도 편집 가능 → DGM의 “코딩 능력 = 자기개량 능력” 가정 완화.  
코딩 외(페이퍼 리뷰, 로보틱스 reward, olympiad grading)로 확장.

### 4.5 Red Queen Gödel Machine (RQGM)

arXiv:2606.26294 · Cambridge 등 · 2026-06

고정 verifier만으로는:

- 벤치 포화
- reward hacking
- AI-generated 산출물에 관대한 judge

**Controlled utility evolution:**

- **Epoch 안**: evaluator frozen → 기존 self-improve 보장 유지
- **Epoch 경계**: ground-truth anchor로 challenger evaluator 교체 가능

코딩에서도 agent-as-judge 리뷰 신호를 보완하면 pass↑ + 토큰↓ 보고.  
주관 도메인(논문 작성/리뷰, 증명 채점)에서 특히 의미.

루프 커리큘럼의 “maker ≠ checker” + “L4 취약”을 **평가기 공진화**로 확장한 형태.

### 4.6 Trace → Skill 계열

| 시스템 | 요지 |
|---|---|
| **Trace2Skill** (arXiv:2603.25158) | 궤적에서 교훈 → 전이 가능한 declarative skill. 모델·도메인 전이 보고 |
| **Skill-DisCo** (arXiv:2606.26669) | 성공 궤적 → PFSM 부분그래프 → 컴파일된 executable skill |
| **Socratic-SWE** (arXiv:2606.07412) | 실패/수리 패턴을 skill로 증류 → 약점 타깃 태스크 생성 → solver 개선 커리큘럼. SWE-bench Verified 3 iter 후 50.40% 보고 |

공통: **경험의 episodic 재사용**을 넘어 **절차·스킬로 컴파일**.

---

## 5. 통합 프레임: Self-Improvement Stack

이전 커리큘럼과 정렬한 실무 스택.

```
┌─────────────────────────────────────────────────────────┐
│ L3+ Research: DGM / HGM / Hyperagents / RQGM            │
│   (sandbox · archive · CMP/utility epochs)              │
├─────────────────────────────────────────────────────────┤
│ L2 Skills: Trace2Skill / Voyager-style libraries        │
│   (compile + verify before publish)                     │
├─────────────────────────────────────────────────────────┤
│ L1 Playbook: ACE (Generator/Reflector/Curator)          │
│   + Ratchet AGENTS.md / MEMORY with provenance          │
├─────────────────────────────────────────────────────────┤
│ L0 Episode: Reflexion inside loop (external verify!)    │
├─────────────────────────────────────────────────────────┤
│ Foundation: Harness sensors (lint/test) + Loop Spec     │
└─────────────────────────────────────────────────────────┘
```

**설계 원칙 (합집합):**

1. **External ground truth first** — L1/L2 검증 없이 L4 자기채점만으로 개량하지 말 것
2. **Delta, not rewrite** — ACE; 통짜 요약은 collapse
3. **Archive / diversity** — DGM; 국소최적 탈출
4. **Separate roles** — Generator ≠ Reflector ≠ Curator ≠ Judge
5. **Ratchet** — 실패 → 구조 고정 (사람 또는 Curator)
6. **Evolve the bar** — RQGM; 평가기도 정체되면 해킹됨
7. **Provenance on memory** — 자기개량의 write path가 공격면

---

## 6. 실패 모드 & 안전

### 6.1 학습이 망가지는 방식

| 모드 | 설명 | 완화 |
|---|---|---|
| Context collapse | 재작성으로 지식 증발 | delta bullets, grow-and-refine |
| Brevity bias | 일반 문구만 남음 | playbook 목표, 상세 보존 |
| Reward hacking | proxy↑ true↓ | frozen epoch + GT anchor (RQGM), hold-out |
| Self-grading | maker=judge | 분리 모델/세션 |
| Skill fossilization | 잘못된 스킬 재사용 | skill 버전·검증·폐기 |
| Metaproductivity mismatch | 벤치왕 ≠ 개량왕 | CMP류 메타지표 |
| Junk memory | append-only 쓰레기통 | prune, helpful/harmful counters |

### 6.2 보안 (self-evolving이 공격면을 키움)

| 위협 | 요지 |
|---|---|
| **Memory poisoning** | 한 번 심은 페이로드가 세션을 넘어 지시처럼 회수됨 |
| **Zombie Agents** | 감염→트리거; 간접 웹 콘텐츠만으로도 가능 (arXiv:2602.15654) |
| **Self-reinforcing misalignment** | 해킹 성공 → 그 패턴을 자기훈련 (arXiv:2606.23075 survey) |
| **Self-mod code** | DGM류는 sandbox·감사·사람 게이트 필수 |

방어 체크리스트:

- [ ] Memory write에 **provenance** (source, trust, timestamp)
- [ ] Untrusted tool 출력 ≠ trusted instruction
- [ ] Memory write 경로 격리 / 사람 승인 옵션
- [ ] Instruction-like memory 탐지·격리
- [ ] Self-mod은 컨테이너 + allowlist + 감사 로그
- [ ] 개량 루프는 offline / non-prod부터
- [ ] Behavioral drift 모니터링

OWASP Agentic 리스크(ASI06 등)와 정합하는 주제로 취급할 것.

---

## 7. 프로덕션 래더 (코딩 에이전트팀용)

| 단계 | 할 일 | 완료 신호 |
|---|---|---|
| **P0** | 실패→사람 ratchet (AGENTS/hook/test) | 같은 실수 재발↓ |
| **P1** | Episode reflection + **검증 명령** | L0이 L1/L2에 묶임 |
| **P2** | ACE식 memory: delta bullets, helpful/harmful, dedupe | collapse 없이 성장 |
| **P3** | Trace→Skill 파이프라인 (사람 리뷰 후 catalog) | 스킬 재사용률↑ |
| **P4** | Offline ADAS/DGM-lite (툴/프롬프트 검색) | 샌드박스 벤치↑ |
| **P5** | Evaluator co-evolution (RQGM 아이디어) | hack ratio 감시 |
| **P6** | Weight training | 별도 ML 플랫폼 |

대부분의 팀은 **P0–P3에서 ROI 대부분**을 얻는다. P4+는 연구 예산.

---

## 8. SuperLiora 매핑

| Self-improve level | SuperLiora에 이미 있는 것 | 공백 / 기회 |
|---|---|---|
| L0 Episode | plan/review, tool error → 재시도, goal-loop validate | Reflector 역할의 명시적 모듈화 |
| L1 Playbook | `AGENTS.md`, nested guides, memory package, skills | ACE식 Curator·delta·helpful counters |
| L2 Skills | `.agents/skills`, skill catalog, progressive disclosure | Trace→Skill 자동 증류 + 검증 게이트 |
| L3 Harness code | 사람이 PR로 agent-core/liora 개량; minimization roadmap | 자동 self-mod는 **의도적 비활성**(안전)이 합리적 |
| L4 Evaluator | maker≠checker 관행, ultraswarm review, baseline ratchet | RQGM식 epoch evaluator는 실험 영역 |
| Ops | `check:test-baseline`, smoke, source-install gate | “개량 제안 → CI → merge” 사람-in-the-loop 래칫 |

**권장 제품 철학 (내부):**

> SuperLiora는 모델을 미세조정하는 self-improver가 아니라,  
> **실행 피드백을 playbook·skill·repo ratchet으로 누적하는 self-improving harness**를 지향한다.  
> 코드 self-mod(L3)는 연구 샌드박스에 두고, 프로덕션 기본 경로는 L0–L2 + human merge다.

이론적으로 이게 DGM보다 “약해 보이지만”, 보안·관측·TUI 제품 제약에서는 **올바른 기본값**이다. 차별점은 이미 있는 **실시간 관측 + emitter truncation + test baseline ratchet**을 ACE/Trace 파이프라인과 연결하는 쪽.

### 실습 과제

1. 최근 실패 3건 → ACE bullet 초안 (strategy / failure mode / when-not-to) + helpful=0
2. 동일 실패에 대해 **센서(훅/테스트)** 로 옮길 수 있는지 분기 (문장만 남기지 말 것)
3. 성공 세션 1개 transcript → skill draft 1페이지 → 사람이 리뷰 후 catalog 후보
4. (연구) agent-core 포크에서 **읽기 전용 archive + 벤치**만으로 DGM-lite 사고실험 — 쓰기 self-mod는 금지

---

## 9. 용어 빠른 사전

| 용어 | 의미 |
|---|---|
| Recursive self-improvement (RSI) | 개량이 개량 능력을 올리는 루프 |
| Open-ended exploration | 당장이 아닌 stepping stone archive |
| Playbook | 요약이 아닌 누적 전략 컨텍스트 (ACE) |
| Delta update | 부분 bullet 추가/수정 |
| Clade / CMP | 자손 성능으로 본 개량 잠재력 (HGM) |
| Controlled utility evolution | epoch 단위 평가기 동결/교체 (RQGM) |
| Metaproductivity | “다음에 얼마나 잘 개량할 잠재력” |
| Zombie agent | 메모리에 잠복한 지속 장악 |

---

## 10. 참고문헌 (이 장 전용)

### A — 원전

| 자료 | ID / URL |
|---|---|
| ACE — Agentic Context Engineering | arXiv:2510.04618 · https://ace-agent.github.io/ |
| Darwin Gödel Machine | arXiv:2505.22954 · https://sakana.ai/dgm/ |
| Huxley-Gödel Machine | arXiv:2510.21614 |
| Hyperagents / DGM-H | arXiv:2603.19461 |
| Red Queen Gödel Machine | arXiv:2606.26294 |
| ADAS / Meta Agent Search | arXiv:2408.08435 · ICLR 2025 |
| ADAS Survey (2026) | https://www.preprints.org/manuscript/202606.0238 |
| Socratic-SWE | arXiv:2606.07412 |
| Trace2Skill | arXiv:2603.25158 |
| Skill-DisCo | arXiv:2606.26669 |
| Safety in Self-Evolving Agents | arXiv:2606.23075 |
| Zombie Agents | arXiv:2602.15654 |
| Memory poisoning study | arXiv:2606.04329 |
| Reflexion | Shinn et al. |
| Voyager | Wang et al. |
| Gödel Machine | Schmidhuber |

### B — 이 커리큘럼과의 연결

- Ratchet / Sensors → [04](./04-harness-engineering.md)
- Compaction vs playbook → [03](./03-context-engineering.md)
- Verification ladder / maker≠checker → [05](./05-loop-engineering.md)
- SuperLiora 좌표 → [07](./07-superliora-mapping.md)

---

## 11. 이 장의 체크

- [ ] Self-improve를 L0–L5 표면으로 설명할 수 있다
- [ ] ACE의 brevity bias / context collapse와 처방을 말할 수 있다
- [ ] DGM vs ADAS (자기참조 vs 고정 메타)를 구분한다
- [ ] HGM의 metaproductivity mismatch를 한 문장으로
- [ ] RQGM이 “평가기를 왜 바꾸는지” 설명할 수 있다
- [ ] Memory poisoning이 prompt injection과 다른 이유를 안다
- [ ] SuperLiora에 권장하는 프로덕션 래더(P0–P3)를 고를 수 있다
