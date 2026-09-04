---
"@superliora/liora": patch
---

Recover sessions instead of bricking them: a corrupted record in the middle of a session journal now replays everything before the corruption, drops the damaged tail, and reports the recovery on resume instead of failing the whole session; an unreadable session directory no longer hides every other session from the session list; and a lost session index rebuilds itself on the next listing.
