Create, append to, or replace a file entirely.

- Missing parents are created automatically.
- Mode defaults to overwrite; append adds content at EOF without adding a newline.
- Write is NOT ALLOWED for incremental changes to existing files — use Edit. Use Write only when the file is missing, needs full replacement, or has little continuity with the old content.
- Do not create unsolicited documentation files unless the user asks or a task requires it.
- Read before overwriting. NEVER include line-number prefixes. Content is written literally.
- For content too large for one call, overwrite the first chunk, then append later chunks.
