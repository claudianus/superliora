---
'@superliora/liora': minor
---

`/search <pattern>`(별칭 `/grep`) 프로젝트 내용 검색을 추가했습니다. ripgrep이 있으면 그것을 사용하고(.gitignore 존중), 없으면 내장 스캐너로 폴백합니다. 결과를 파일별로 묶어 보여주고, 매치에서 Enter를 누르면 해당 줄로 스크롤된 코드 뷰어가 열리며 닫으면 검색 결과로 돌아옵니다. 코드 뷰어에 `initialLine` 이동이 추가됐습니다.
