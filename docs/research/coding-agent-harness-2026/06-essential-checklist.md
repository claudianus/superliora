# 06 — 필수 체크리스트 & 트렌드 요약

## A. 2026 중후반 트렌드 (한 페이지)

1. **모델 상품화, 하네스 차별화** — 벤치·현장 모두 “같은 가중치, 다른 래퍼”
2. **결정적 강제(센서)가 prose를 이김** — hooks / CI / archgate
3. **컨텍스트는 자원** — write/select/compress/isolate가 기본 어휘
4. **장기 실행 = 세션 브릿지** — feature JSON, progress, git, Ralph/reset
5. **루프 엔지니어링 부상** — 외부 loop spec, verification ladder
6. **AGENTS.md 표준화** — 크로스툴 SSOT, Skills progressive disclosure
7. **Spec-driven** — 멀티에이전트·멀티세션에서 계약이 채팅을 이김
8. **Maker ≠ Checker** — evaluator agent, reward hacking 경계
9. **오픈 모델 + 강한 하네스** — 비용 효율 라우팅
10. **관측·예산이 1급** — overnight 없으면 사고

## B. 레포 하네스 최소 완성도

### B1. Guides

- [ ] root `AGENTS.md` (또는 동등) — 빌드/테스트/금기만
- [ ] nested 도메인 가이드 (모노레포)
- [ ] Skills 디렉터리 + 짧은 description
- [ ] aspirational rule 0개 (실패 근거 있는 줄만)

### B2. Sensors

- [ ] format / lint / typecheck
- [ ] 단위·통합 테스트
- [ ] PreToolUse 위험 명령 차단
- [ ] PostToolUse 자동 피드백 (가능하면)
- [ ] Stop/완료 게이트 (테스트 green)
- [ ] 시크릿 스캔

### B3. Context

- [ ] always-on 토큰 예산 의식
- [ ] 상세는 on-demand
- [ ] 긴 작업용 progress / plan 파일 관행
- [ ] compaction 또는 reset 정책이 문서화됨

### B4. Loop readiness

- [ ] 검증 명령이 한 줄로 존재
- [ ] named terminal states
- [ ] budget (steps/tokens/$)
- [ ] maker/checker 분리 기준
- [ ] stagnation 감지

### B5. Ops

- [ ] 세션/트레이스 볼 수 있음
- [ ] cost 가시성
- [ ] 실패 → ratchet 티켓/PR 습관
- [ ] information parity (인간만 아는 절차 없음)

## C. 작업 유형별 추천 스택

| 작업 | Prompt | Context | Harness | Loop |
|---|---|---|---|---|
| 작은 버그픽스 | 짧은 지시 | JIT read | lint+test | 불필요 |
| 피처 1개 | plan | AGENTS+skill | PostToolUse | 가벼운 goal |
| 마이그레이션 | 계약형 goal | progress 파일 | CI ratchet | Ralph/goal-loop |
| 그린필드 앱 | initializer 프롬프트 | feature JSON | E2E sensor | Anthropic식 N세션 |
| 보안·결제 | 명시 제약 | isolate | PreToolUse+HITL | maker–checker |
| 리서치/탐색 | 열린 질문 | subagent | 관측만 | 루프 비권장 |

## D. “지금 당장” 90분 래칫 워크숍

1. **15분** — 최근 에이전트 실패 3건 나열
2. **30분** — 각 건을 Guide / Sensor / Context / Isolate 중 하나에 매핑
3. **30분** — Sensor 1개 + AGENTS.md 3줄 이내 패치
4. **15분** — 동일 프롬프트로 재현 시도 → 재발 여부 기록

## E. 읽기 로드맵 (시간 예산)

| 시간 | 읽을 것 |
|---|---|
| 30분 | 이 커리큘럼 01 + 04 요약부 |
| 2시간 | Anthropic long-running harness + 이 폴더 전체 |
| 반나절 | arXiv:2607.00038 + LangChain context engineering |
| 주간 | Survey 2507.13334 목차 훑고 필요한 장만 |

참고 링크 전체: [08-references](./08-references.md)

다음: [07 — SuperLiora 매핑](./07-superliora-mapping.md)
