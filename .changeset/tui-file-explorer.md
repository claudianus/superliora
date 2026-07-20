---
'@superliora/liora': minor
---

`/files`(별칭 `/tree`, `/explorer`) 프로젝트 파일 탐색기를 추가했습니다. git 저장소에서는 `git ls-files`로 .gitignore를 존중해 파일 목록을 만들고, git이 없으면 node_modules·빌드 산출물 등을 가지치기하는 파일시스템 탐색으로 폴백합니다(20,000개 캡). 방향키/j·k로 이동, enter로 디렉터리 펼치기·접기, 파일 선택 시 상대 경로가 입력창에 삽입됩니다.
