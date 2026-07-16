Read a UTF-8 text file from the local filesystem.

If the user provides a concrete text-file path, call Read directly—no Glob/`ls` pre-check. Missing paths return handleable errors. Not for directories (use Bash `ls` or Glob). Use Grep when the location is unknown.

When you need several files, prefer parallel Reads in one response — not one file per turn.

- Relative paths use the working directory; outside paths must be absolute.
- Up to {{ MAX_LINES }} lines or {{ MAX_BYTES_KB }} KB per call; lines > {{ MAX_LINE_LENGTH }} chars truncate.
- Page with `line_offset` (1-based) and `n_lines`. Negative `line_offset` reads from the end (abs ≤ {{ MAX_LINES }}).
- Sensitive files (`.env`, credentials, SSH keys) and binary/NUL are refused—use `ReadMediaFile` for media.
- Output: `<line-number>	<content>` per line. Trailing `<tool_meta ...>` is after the file content; not part of the file.
- Pure CRLF files are displayed with LF; `Edit` matches that and preserves CRLF on write. Mixed/lone CR show as `\r` and need exact Edit escapes.
- After successful Edit/Write, do not re-read only to prove the write.
- When the task depends on an exact final external contract, inspect before finishing.
