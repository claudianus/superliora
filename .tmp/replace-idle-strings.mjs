import fs from 'fs';

const path = '/Users/modumaru/.superliora/worktrees/superliora-5eccc730/conductor-jmsn3sgwk1ragpk/apps/liora/src/cli/i18n/strings-tui.ts';
let content = fs.readFileSync(path, 'utf8');

// EN replacements (lines ~93-100)
content = content.replace("'tui.idle.title': 'jewel tank'", "'tui.idle.title': 'aquarium'");
content = content.replace("'tui.idle.mood.bubbles': 'a silver plume climbs the glass'", "'tui.idle.mood.bubbles': 'idle'");
content = content.replace("'tui.idle.mood.swim': 'the lead fish draws a slow arc'", "'tui.idle.mood.swim': 'listening'");
content = content.replace("'tui.idle.mood.ready': 'clear water · prompt open'", "'tui.idle.mood.ready': 'ready'");
content = content.replace("'tui.idle.mood.tank': 'coral hush, waiting for a line'", "'tui.idle.mood.tank': 'waiting'");
content = content.replace("'tui.idle.mood.quiet': 'caustic light, soft current'", "'tui.idle.mood.quiet': 'idle'");

// KO replacements (lines ~490-497)
content = content.replace("'tui.idle.title': '보석 수조'", "'tui.idle.title': 'aquarium'");
content = content.replace("'tui.idle.mood.bubbles': '은빛 기포가 유리를 타고 오른다'", "'tui.idle.mood.bubbles': 'idle'");
content = content.replace("'tui.idle.mood.swim': '주연 물고기가 느린 호를 그린다'", "'tui.idle.mood.swim': 'listening'");
content = content.replace("'tui.idle.mood.ready': '맑은 물 · 프롬프트 열림'", "'tui.idle.mood.ready': 'ready'");
content = content.replace("'tui.idle.mood.tank': '산호가 고요하다, 한 줄을 기다린다'", "'tui.idle.mood.tank': 'waiting'");
content = content.replace("'tui.idle.mood.quiet': '캐우스틱 빛, 잔잔한 흐름'", "'tui.idle.mood.quiet': 'idle'");

fs.writeFileSync(path, content, 'utf8');
console.log('strings-tui.ts updated successfully');
