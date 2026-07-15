Create, append to, or replace a file entirely.

- Missing parents are created automatically.
- Mode defaults to overwrite; append adds content at EOF without adding a newline.
- Write is NOT ALLOWED for incremental changes to existing files (including one-line/cosmetic edits) — use Edit. Use Write only when the file is missing, needs full replacement, or has little continuity with the old content.
- Do not create unsolicited documentation files (`*.md` write-ups, `README`s, summaries) just because a task finished — only when the user asks, or a task/project instruction requires it (e.g. plan-mode plan file, required changeset).
- Read before overwriting an existing file.
- Write ignores the Read/Edit line-number view. NEVER include line prefixes.
- Write outputs content literally, including supplied line endings: \n stays LF, \r\n stays CRLF.
- For content too large for one call, overwrite the first chunk, then append subsequent chunks. Never chunk Write to modify an existing file.
