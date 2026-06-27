# 슈퍼키미(Super Kimi) 스킬 시스템 설계 분석 보고서

## 1. 시스템 개요

슈퍼키미의 스킬 시스템은 `antigravity-awesome-skills` 플러그인을 통해 제공되는 **파일 기반 스킬(File-based Skill) 아키텍처**입니다. 각 스킬은 독립된 디렉토리에 `SKILL.md`를 중심으로 관련 자료(참고 문서, 스크립트, 에셋 등)를 함께 묶어 구성됩니다. 이는 마치 소프트웨어 패키지처럼, 문서(README)와 실행 가능한 코드/설정이 하나의 단위로 묶이는 형태입니다.

**핵심 특징:**
- **마크다운 기반**: AI 에이전트가 읽고 이해하기 쉬운 구조화된 텍스트 포맷
- **선언적 메타데이터**: YAML 프론트매터를 통한 표준화된 스킬 메타정보
- **모듈화**: 필요한 참고 자료와 실행 스크립트를 하위 폴더로 분리
- **생태계 연동**: 다른 에이전트/스킬과의 연계를 설계에 내재

---

## 2. 물리적 구조 (Directory Architecture)

```
antigravity-awesome-skills/skills/
├── {skill-name}/                    # 각 스킬은 고유 디렉토리 보유
│   ├── SKILL.md                     # 스킬의 핵심 정의 파일 (필수)
│   ├── references/                  # 참고 문서, 예시, 매뉴얼 (132개 스킬에서 사용)
│   ├── scripts/                     # 실행 가능한 스크립트 (75개 스킬에서 사용)
│   ├── assets/                      # 이미지, 설정 파일 등 정적 에셋 (17개 스킬에서 사용)
│   ├── agents/                      # 에이전트 설정/프롬프트 (14개 스킬에서 사용)
│   ├── templates/                   # 재사용 가능한 템플릿 (8개 스킬에서 사용)
│   ├── tests/                       # 테스트 케이스 (3개 스킬에서 사용)
│   ├── lib/                         # 공유 라이브러리 코드 (2개 스킬에서 사용)
│   └── examples/                    # 코드 예시 (20개 스킬에서 사용)
```

**구조적 설계 의도:**
1. **단일 책임 원칙**: `SKILL.md`는 "무엇을 해야 하는지"를 기술하고, `scripts/`는 "어떻게 실행하는지"를 담당합니다.
2. **확장성**: 새로운 스킬을 추가할 때 기존 스킬의 디렉토리를 복제하여 템플릿으로 활용 가능합니다.
3. **버전 관리 친화적**: 각 스킬이 독립 폴더로 분리되어 있어 Git 기반 버전 관리가 용이합니다.

---

## 3. 메타데이터 설계 (YAML Frontmatter)

모든 `SKILL.md` 파일은 상단에 YAML 프론트매터를 포함하여 AI 에이전트가 스킬을 빠르게 파싱하고 적절한 컨텍스트를 선택할 수 있게 합니다.

### 3.1 핵심 필드

| 필드 | 필수 여부 | 설명 | 예시 값 |
|------|----------|------|---------|
| `name` | ✅ | 스킬의 고유 식별자 (snake_case) | `bug-hunter`, `deploy-to-vercel` |
| `description` | ✅ | 스킬의 목적과 사용 시기를 한 문장으로 | `"Systematically finds and fixes bugs..."` |
| `risk` | ✅ | 위험도 수준 (`none`, `safe`, `unknown`, `critical`) | `safe` |
| `source` | 선택 | 스킬의 출처 (`community`, 특정 URL, 레포명) | `community`, `Dimillian/Skills (MIT)` |
| `date_added` | 선택 | 스킬 추가일 (ISO 8601) | `2026-03-05` |
| `category` | 선택 | 기능적 분류 (`development`, `security`, `design` 등) | `development` |
| `author` | 선택 | 작성자 정보 | `renat` |
| `tags` | 선택 | 검색/매칭을 위한 키워드 목록 | `[planning, pre-task, risk-analysis]` |
| `tools` | 선택 | 해당 스킬이 사용하는 외부 도구 목록 | `[claude-code, antigravity, cursor]` |

### 3.2 분류 체계 설계

**위험도 (`risk`) 필드의 중요성:**
- `none`: 순수 정보 제공/분석 (예: `task-intelligence`의 계획 단계)
- `safe`: 파일 읽기, 로컬 분석 등 비파괴적 작업
- `unknown`: 사용자 환경에 따라 영향이 달라질 수 있는 작업
- `critical`: 데이터 삭제, 배포, 외부 API 호출 등 되돌리기 어려운 작업

이는 AGENTS.md의 "Delete before you optimize" 원칙과 일치하여, 에이전트가 실행 전에 적절한 확인 단계를 거치도록 유도합니다.

---

## 4. 콘텐츠 아키텍처 (Content Architecture)

`SKILL.md` 본문은 일관된 마크다운 섹션 구조를 따릅니다. 이는 AI가 스킬을 "빠르게 스캔"하고 필요한 부분만 선택적으로 읽을 수 있게 합니다.

### 4.1 표준 섹션 구조

```markdown
# {Skill Name} (H1 - 스킬 제목)

## Overview / When to Use (H2 - 사용 맥락)
- "언제 이 스킬을 사용해야 하는가"
- "언제 사용하지 말아야 하는가" (When NOT to Use)

## Goal (H2 - 목표)
- 스킬 실행 후 달성해야 할 상태

## Workflow / Steps (H2 - 실행 절차)
### 1) 단계명 (H3)
- 구체적인 행동 지침
- 코드 블록 (예시 명령어, 코드 스니펫)

## Checklist (H2 - 검증 목록)
- 실행 전/후 확인해야 할 항목들

## Anti-patterns (H2 - 금지 사항)
- 흔히 저지르는 실수와 그 대안

## Related Skills (H2 - 연계 스킬)
- 다른 스킬과의 연계 방식 (`@skill-name` 문법)

## Limitations (H2 - 한계)
- 스킬의 적용 범위와 책임 한계
```

### 4.2 설계적 장점

1. **선택적 읽기 (Selective Reading)**: AI가 전체 문서를 읽지 않고도 `When to Use`와 `Workflow`만 파싱하여 빠르게 판단할 수 있습니다.
2. **실행 가능성 (Actionability)**: 모든 단계는 명령형(imperative) 문장으로 작성되어 즉시 실행 가능합니다.
3. **컨텍스트 보존**: `Overview`와 `Goal` 섹션이 에이전트의 의도를 지속적으로 상기시킵니다.
4. **실패 모드 정의**: `Anti-patterns`와 `Limitations`를 명시하여 과도한 추론이나 책임 범위 벗어남을 방지합니다.

---

## 5. 스킬 유형별 설계 패턴 분석

### 5.1 단순 가이드형 (Simple Guide)

**예시**: `ask-questions-if-underspecified`, `react-component-performance`
- **특징**: 짧은 문서, 명확한 체크리스트, 코드 예시 중심
- **구조**: `When to Use` → `Checklist` → `Code Examples` → `Limitations`
- **설계 의도**: 빠른 참조를 위한 치트시트 역할

### 5.2 절차적 워크플로우형 (Procedural Workflow)

**예시**: `bug-hunter`, `deploy-to-vercel`
- **특징**: 단계별 실행 절차, 분기 로직 (if/else), 환경별 대응
- **구조**: `Step 1: State Gathering` → `Step 2: Decision Branch` → `Step 3: Execution`
- **설계 의도**: 상태 기반 의사결정 트리를 문서화하여 복잡한 작업의 일관된 수행 보장
- **고급 패턴**: `deploy-to-vercel`은 "Linked + Git", "Linked + No Git", "Not Linked + Auth", "Not Linked + No Auth" 등 4가지 상태에 따라 완전히 다른 실행 경로를 정의합니다.

### 5.3 멀티 에이전트 오케스트레이션형 (Multi-Agent Orchestration)

**예시**: `task-intelligence`
- **특징**: 여러 전문 에이전트를 병렬로 활성화하고 결과를 통합
- **구조**: `Fase 1: Classificação` → `Fase 2: Scan/Match` → `Fase 3: Briefing` → `Fase 4: Estimativa` → `Fase 5: Mapa de Problemas` → `Fase 6: Plano`
- **설계 의도**: 단일 에이전트의 한계를 인정하고, "사전 분석" 단계를 통해 실행 품질을 높입니다.
- **독특한 요소**: 포르투갈어와 영어가 혼용되어 있으며, 특정 생태계(Claude, Antigravity, Cursor 등)를 가정하고 있습니다.

### 5.4 자동화/스크립트 연동형 (Automation/Script-Linked)

**예시**: `deploy-to-vercel`, `playwright-skill`
- **특징**: `scripts/` 또는 `resources/` 폴더의 실행 파일을 직접 참조
- **구조**: `SKILL.md`에서 `bash /path/to/script.sh` 형태로 명령어 실행
- **설계 의도**: AI의 "추론"과 "실행"을 분리하여, 복잡한 로직은 스크립트에 위임하고 AI는 오케스트레이션에 집중합니다.

### 5.5 디자인/프론트엔드 시스템형 (Design System)

**예시**: `antigravity-design-expert`
- **특징**: 시각적 원칙, 기술 스택 선호도, 애니메이션 규칙
- **구조**: `Role Overview` → `Tech Stack` → `Design Principles` → `Motion Rules` → `Constraints`
- **설계 의도**: AI가 "디자이너 페르소나"를 입고 일관된 미적 품질을 유지하도록 프레임을 설정합니다.

---

## 6. 설계 철학 및 원칙

### 6.1 AGENTS.md와의 정합성

스킬 시스템의 설계는 상위 `AGENTS.md`의 운영 원칙과 긴밀하게 연결되어 있습니다:

| AGENTS.md 원칙 | 스킬 시스템에서의 구현 |
|---------------|---------------------|
| "Delete before you optimize" | `Anti-patterns` 섹션으로 불필요한 복잡성 경고 |
| "Start with the simplest working version" | 단순 스킬(`ask-questions`)과 복잡 스킬(`task-intelligence`)의 계층적 분리 |
| "Favor explicitness over magic" | `Workflow`의 명확한 단계별 명령과 `Limitations`의 범위 명시 |
| "Communicate directly" | `When to Use`/`When NOT to Use`의 명확한 조건부 트리거 |
| "Correctness first, Clarity second" | `Checklist`를 통한 검증 단계와 `Goal`의 명확한 정의 |

### 6.2 안전성 중심 설계

- **`risk` 필드**: 모든 스킬은 위험도를 자체 선언하며, `critical` 스킬은 명시적 확인 단계를 포함합니다.
- **`Limitations` 섹션**: "Do not treat the output as a substitute for..." 문구로 AI의 과도한 추론을 제한합니다.
- **환경 감지**: `deploy-to-vercel`은 Claude.ai 샌드박스, Codex 샌드박스, 로컬 터미널 등 실행 환경에 따라 다른 전략을 사용하도록 설계되었습니다.

### 6.3 모듈성과 재사용성

- **`Related Skills`**: `@skill-name` 문법으로 스킬 간 연결을 명시하여 중복을 방지하고 조합을 장려합니다.
- **`references/`**: 공통 패턴이나 예시를 외부 파일로 분리하여 여러 스킬이 참조할 수 있게 합니다.
- **`templates/`**: 반복되는 작업(예: 스킬 생성 자체)의 템플릿을 제공합니다.

---

## 7. 확장성 및 생태계

### 7.1 플러그인 아키텍처와의 통합

`list_mcp_resources` 결과를 보면, Codex 앱은 `codex_apps` 서버를 통해 이러한 스킬들을 MCP(Model Context Protocol) 리소스로 등록하고 있습니다. 각 스킬은 `skill://{plugin-id}/{skill-name}` 형태의 URI로 참조되며, 메타데이터(`plugin_id`, `plugin_release_id`, `skill_name`, `contents` 등)를 포함합니다.

이는 파일 기반 스킬 시스템이 단순한 문서 모음이 아니라, **런타임에 발견되고 로드되는 플러그인 모듈**로 작동함을 의미합니다.

### 7.2 다국어 및 지역화

- 대부분의 스킬은 영어로 작성되었으나, `task-intelligence`와 같은 일부 스킬은 포르투갈어(브라질)로 작성되어 있습니다.
- 이는 특정 사용자 그룹이나 개발자 커뮤니티의 기여를 반영하며, 향후 다국어 스킬 레지스트리로 확장 가능성을 보여줍니다.

### 7.3 에이전트 간 상호운용성

- `task-intelligence`는 `007 (Security)`, `skill-sentinel (Quality)`, `agent-orchestrator`, `matematico-tao` 등 다양한 전문 에이전트를 호출할 수 있는 구조를 가정합니다.
- 이는 단일 AI의 "만능성"을 포기하고, **분산 전문가 시스템**을 지향하는 설계 철학을 보여줍니다.

---

## 8. 결론 및 제안

### 8.1 설계의 강점

1. **실용적이고 실행 중심**: 모든 스킬은 "설명"이 아닌 "행동"을 지향합니다.
2. **구조화된 자유도**: YAML 프론트매터와 표준 섹션은 일관성을 보장하면서도, 각 스킬의 특성에 맞는 유연한 콘텐츠를 허용합니다.
3. **안전성 내재화**: `risk` 필드와 `Limitations`는 안전 장치를 시스템의 메타 레벨에서 관리합니다.
4. **생태계적 사고**: `Related Skills`, `references/`, `scripts/`를 통해 개별 스킬이 아닌 스킬 네트워크를 구축합니다.

### 8.2 잠재적 개선 방향

1. **스키마 버전 관리**: YAML 프론트매터에 `schema_version` 필드를 추가하여, 향후 메타데이터 구조가 진화할 때 하위 호환성을 관리할 수 있습니다.
2. **의존성 선언**: `dependencies: [skill-a, skill-b]` 필드를 추가하여 스킬 간 실행 순서나 선행 조건을 명시적으로 정의할 수 있습니다.
3. **테스트 자동화**: `tests/` 폴더를 활용한 스킬 유효성 검증(메타데이터 스키마 체크, 워크플로우 단계 누락 여부 등)을 CI 파이프라인으로 추가할 수 있습니다.
4. **검색/매칭 최적화**: 현재 `tags` 기반 검색에 더해, `description`의 임베딩 벡터를 생성하여 의미 기반 스킬 추천을 구현할 수 있습니다.

---

**보고서 작성일**: 2026-06-27  
**분석 대상**: `/Users/modumaru/.kimi/skills/antigravity-awesome-skills/skills/` 내 400+ 스킬 디렉토리  
**샘플링**: `ask-questions-if-underspecified`, `react-component-performance`, `bug-hunter`, `task-intelligence`, `deploy-to-vercel`, `antigravity-design-expert` 등 다양한 유형의 SKILL.md 파일 분석
