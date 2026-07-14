Read a UTF-8 text file from the local filesystem.

If the user provides a concrete file path to a text file, call Read directly. Do not Glob/`ls` pre-check known paths; missing paths return handleable errors. Not for directories — use `ls` via Bash or Glob. Use Grep only when searching for unknown content or locations.

When you need several files, prefer to read them in parallel: emit multiple `Read` calls in a single response instead of reading one file per turn.

- Relative paths resolve against the working directory; outside paths must be absolute.
- Returns up to {{ MAX_LINES }} lines or {{ MAX_BYTES_KB }} KB per call; lines longer than {{ MAX_LINE_LENGTH }} chars are truncated mid-line.
- Page with `line_offset` (1-based) and `n_lines`. Omit `n_lines` for the {{ MAX_LINES }}-line cap. Negative `line_offset` reads from the end (abs ≤ {{ MAX_LINES }}).
- Sensitive files (`.env`, credentials, SSH keys) and non-UTF-8/binary/NUL are refused — use `ReadMediaFile` for images/video.
- Output: `<line-number>\t<content>` per line. A trailing `<tool_meta ...>` block is appended after the file content; it summarizes how much was read and is not part of the file itself.
- Pure CRLF files are displayed with LF; `Edit` matches that and preserves CRLF on write. Mixed/lone CR show as `\r` and need exact `Edit.old_string` escapes.
- After a successful Edit/Write, do not re-read only to prove the write landed. When the task depends on an exact final external contract, inspect it before finishing.
