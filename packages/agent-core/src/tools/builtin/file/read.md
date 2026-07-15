Read a UTF-8 text file from the local filesystem.

If the user provides a concrete file path to a text file, call Read directly—no Glob/`ls` pre-check. Missing paths return handleable errors. Not for directories (use Bash `ls` or Glob). Use Grep when the location is unknown.

When you need several files, prefer to read them in parallel: emit multiple `Read` calls in a single response instead of one file per turn.

- Relative paths use the working directory; outside paths must be absolute.
- Up to {{ MAX_LINES }} lines or {{ MAX_BYTES_KB }} KB per call; lines > {{ MAX_LINE_LENGTH }} chars truncate.
- Page with `line_offset` (1-based) and `n_lines`. Negative `line_offset` reads from the end (abs ≤ {{ MAX_LINES }}).
- Sensitive files (`.env`, credentials, SSH keys) and binary/NUL are refused—use `ReadMediaFile` for media.
- Output: `<line-number>	<content>` per line. A trailing `<tool_meta ...>` block is appended after the file content; it is not part of the file itself.
- Pure CRLF files are displayed with LF; `Edit` matches that and preserves CRLF on write. Mixed/lone CR show as `` and need exact Edit escapes.
- After a successful Edit/Write, do not re-read only to prove the write landed.
- When the task depends on an exact final external contract, inspect it before finishing.
