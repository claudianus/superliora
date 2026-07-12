# SuperLiora Harness 최소화 로드맵

> 분석 기준일: 2026-07-12  
> 대상: SuperLiora 모노레포(현재) vs. pi(opencode) 최소 코딩 에이전트  
> 목적: "처음부터 하네스를 쌓아 올린다"는 관점에서 어디까지 줄일 수 있고, 어디까지 남겨야 하는지 방향 제시

---

## 1. 핵심 진단: 지금 SuperLiora가 무거운 이유

pi는 단일 패키지, 단일 책임 영역, **세션/도구/프롬프트를 직접 조립**하는 구조다. SuperLiora는 다음 층위가 모두 분리되어 있어 각 층마다 복잡도가 누적된다.

| 층위 | SuperLiora(현재) | pi(opencode) | 영향 |
|---|---|---|---|
| **프로젝트 단위** | 모노레po(apps ×4, packages ×13+) | 단일 패키지 | 작업 범위 추적 비용 큼 |
| **계층 분리** | agent-core / node-sdk / server / tui-renderer / oauth 등 | `opencode` + `core` 두 패키지 | 간접 참조가 많아 디버깅 어려움 |
| **프로필 시스템** | YAML + TypeScript 병행, 여러 프로필 | `.txt` 프롬프트 파일 위주, 프로필 개념 거의 없음 | 문법/버전/의존성 관리 포인트 증가 |
| **도구 세트** | 11개 기본 + N개 확장 | 약 8개 핵심 도구 | 도구별 메타데이터, 테스트, 문서가 늘어남 |
| **UI** | TUI + GUI + Vis 서버 | CLI 로그 + 선택적 TUI | 렌더러/입력/이벤트 루프 복잡도 |
| **런타임** | 서버 기반(REST + WebSocket) + CLI | 프로세스 내 직접 실행 | 분산 상태/동기화 부담 |

**결론:** SuperLiora의 무게는 "기능"보다 **추상화 층위와 분리된 책임**에서 나온다. pi를 참고할 때는 도구 개수만 줄이는 것이 아니라, **세션-도구-UI의 결합 방식**을 단순화하는 방향을 봐야 한다.

---

## 2. pi에서 배울 수 있는 최소화 원칙

### 2.1. 도구는 "에이전트가 스스로 고치는" 흐름에 맞춘다

pi의 핵심 도구는 다음 순환을 만든다.

```
read_file / list_dir → reasoning → edit / write / apply_patch → execute_command → websearch(부족할 때)
```

즉, **파일을 읽고, 추론하고, 고치고, 실행하고, 모륾면 검색**하는 5단계 폐쇄 루프다. SuperLiora도 `Read`, `Edit`, `Write`, `ExecuteCommand`, `WebSearch`가 있지만, 추가 도구들이 병렬로 존재해 에이전트가 "어떤 도구를 쓸지" 고르는 비용이 크다.

**적용 방향:** 기본 프로필은 위 5단계 루프를 완성하는 최소 도구만 남기고, 나머지는 명시적으로 사용자가 활성화하는 확장 도구로 옮긴다.

### 2.2. 추상화보다 직접 제어

pi는 `apply_patch`처럼 LLM이 직접 diff를 생성해 적용하는 방식을 쓴다. SuperLiora는 `Edit` 도구가 `old_string`/`new_string` 기반으로 안전하지만, **복잡한 다중 수정**에서는 LLM이 여러 번 `Edit`을 호출해야 한다.

**적용 방향:** `apply_patch` 스타일의 단일 호출 멀티 수정 도구를 실험적으로 추가핧 것을 검토한다. 다만, SuperLiora의 `Edit`은 안전성(정확한 old_string 매칭)이 강점이므로, **두 가지를 모두 제공**하되 기본 프로필에는 현재 `Edit`만 남기는 것이 바람직하다.

### 2.3. UI는 "선택적 TUI"가 아니라 "기본 CLI에 덧붙이는 TUI"

pi는 기본적으로 CLI 로그 출력이며, TUI는 별도 활성화 가능하다. SuperLiora의 `apps/liora`는 TUI에 강하게 의존하며, 이는 `packages/tui-renderer`와 `packages/gui-use` 등으로 확장된다.

**적용 방향:** TUI는 **선택적 모드**로 전환하고, 기본 경험은 pi처럼 스트리밍 로그 기반으로 만든다. 이는 디버깅과 자동화 측면에서도 유리하다.

### 2.4. 세션은 서버가 아니라 프로세스 안에서 살아간다

pi는 세션 상태가 Node 프로세스 내에서 유지된다. SuperLiora는 `packages/server`가 REST/WebSocket으로 세션을 호스팅하며, 이는 분산 환경/CLI 분리를 위해 설계되었지만 **로컬 개발 단일 사용자**에게는 과하다.

**적용 방향:** `apps/liora`가 `packages/agent-core`를 **인프로세스로 직접 사용**하는 경로를 우선 지원한다. 서버 모드는 선택적 배포 옵션으로 유지한다.

---

## 3. 3단계 로드맵

### Phase 1: 기본 프로필 축소 및 하위 호환 유지 ✅ 완료

- `DEFAULT_AGENT_PROFILES`의 `tools` 배열을 11개로 축소.
- `superliora-full`, `superliora-coder`, `superliora-explorer` 하위 호환 프로필 추가.
- 빌드 및 스모크 테스트 통과, `profiles.md` 문서화, `.changeset` 작성.

**남은 보완:**
- `docs/specs/2026-07-12-superliora-tool-redundancy-review.md` 결론 섹션을 실제 구현 내용으로 갱신.
- 기본 프로필에 남은 11개 도구가 실제 코딩 워크플로우를 커버하는지 시나리오 테스트 추가.

### Phase 2: 인프로세스 경로 단순화 (권고)

- `apps/liora`가 `packages/server`를 거치지 않고 `packages/agent-core`를 직접 사용하는 **로컬 모드** 추가.
- TUI를 **옵트인**으로 변경하고, 기본 CLI 모드를 로그 스트리밍 중심으로 정리.
- 단일 세션 파일 형식 도입: `superliora-session.yaml` 또는 SQLite 경량 저장.

**기대 효과:**
- 디버깅 시 서버-프로토콜-WS 문제를 제거.
- 에이전트 루프의 지연 시간 감소.
- 단위 테스트 용이.

### Phase 3: 도구 레이어 재설계 (장기)

- **Core Tools(5~7개):** Read, Edit/ApplyPatch, Write, ExecuteCommand, WebSearch, ListDir, Grep.
- **Extended Tools(나머지):** Browser, Computer, LioraContext, FetchURL, Git 등은 명시적 플래그나 프로필로 활성화.
- `apply_patch` 도구 실험적 추가: LLM이 한 번의 호출로 여러 파일을 수정할 수 있도록.
- 도구별 메타데이터(YAML)와 TypeScript 정의의 중복 제거: 단일 출처(single source of truth)로 통합.

---

## 4. 위험 요소 및 반드시 피해야 할 함정

### 4.1. "pi처럼 만든다"고 모든 추상화를 없애는 것

pi는 단일 사용자 CLI용이다. SuperLiora는 서버 배포, 팀 공유, GUI, Vis 도구 등이 목표다. **완전한 단순화는 불가능**하며, 올바른 목표는 "로컬 개발 시 pi만큼 가볍게 쓸 수 있게 하는 것"이다.

### 4.2. 프로필/도구를 많이 만들수록 좋다는 착각

`superliora-coder`, `superliora-explorer`, `superliora-full` 등을 추가하는 것은 하위 호환을 위한 **단기적 안정장치**다. 장기적으로는 **하나의 적응형 프로필**이 사용자 명령/컨텍스트에 따라 도구를 동적으로 로드하도록 가야 한다.

### 4.3. TUI를 폐기한다는 오해

TUI를 없애는 것이 아니라, **기본 경험에서의 의존을 줄이는 것**이다. TUI는 여전히 시각적 피드백이 필요한 사용자에게 가치 있다. 하지만 자동화/CI/디버깅 환경에서는 CLI 로그가 필수적이다.

### 4.4. 서버 모드의 가치를 무시하기

서버-클이언트 분리는 향후 웹 IDE, 원격 에이전트, 팀 공유를 위한 자산이다. **인프로세스 모드를 추가할 뿐**, 서버 모드를 제거하지 않는다.

---

## 5. 우선순위와 다음 할 일

| 우선순위 | 작업 | 예상 소요 | 비고 |
|---|---|---|---|
| P0 | Phase 1 마무리: tool-redundancy-review 문서 갱신 | 30분 | 사용자에게 즉시 보여줄 결과 |
| P1 | `apps/liora` 인프로세스 모드 실험 | 1~2일 | 로컬 개발 경량화의 핵심 |
| P1 | 기본 CLI 로그 모드 정리 | 1일 | TUI 옵트인 전환 |
| P2 | Core/Extended 도구 분리 설계 | 2~3일 | 장기 구조 개선 |
| P2 | `apply_patch` 도구 실험 | 1~2일 | pi의 핵심 패턴 수용 |
| P3 | 세션 파일 형식 단순화 | 2~3일 | SQLite 또는 단일 YAML |

---

## 6. 권고 사항

1. **지금 당장:** Phase 1 문서를 마무리하고, 기본 프로필이 실제 코딩 시나리오에서 작동하는지 3가지 시나리오(버그 수정, 기능 추가, 리팩토링)로 검증한다.
2. **이번 주:** `apps/liora`가 `packages/agent-core`를 인프로세스로 실행할 수 있는 **최소한의 실험 브랜치**를 만든다.
3. **이번 달:** Core/Extended 도구 분리를 설계하고, `apply_patch`를 실험적으로 추가할 것을 결정한다.
4. **절대 하지 말 것:** 서버 모드 제거, 모든 프로필 통합, TUI 완전 폐기. 이들은 SuperLiora의 장기적 가치를 해친다.

---

## 7. 요약

pi는 **"코딩 에이전트라는 한 가지 일을 최소한의 층위로 하는"** 좋은 참고점이다. SuperLiora는 그보다 많은 책임을 지고 있으므로, pi와 똑같아질 수는 없다. 대신 **로컬 개발 경로에서 pi만큼 가볍게** 쓸 수 있도록 인프로세스 모드, CLI 로그 중심 경험, Core/Extended 도구 분리를 단계적으로 적용해야 한다. Phase 1은 이미 그 첫걸음이다.
