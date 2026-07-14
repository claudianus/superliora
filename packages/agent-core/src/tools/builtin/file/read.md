Read a UTF-8 text file from the local filesystem.

If the user provides a concrete file path to a text file, call Read directly. Do not `Glob`, `ls`, or otherwise pre-check known text file paths; missing or invalid paths return errors you can handle. Do not use Read for directories; use `ls` via Bash for a known directory, or Glob for patterns. Use `Grep` only when searching for unknown content or locations.

When you need several files, prefer to read them in parallel: emit multiple `Read` calls in a single response instead of reading one file per turn.

- Relative paths resolve against the working directory; a path outside the working directory must be absolute.
- Returns up to {{ MAX_LINES }} lines or {{ MAX_BYTES_KB }} KB per call, whichever comes first; lines longer than {{ MAX_LINE_LENGTH }} chars are truncated mid-line.
- Page larger files with `line_offset` (1-based start line) and `n_lines`. Omit `n_lines` to read up to the {{ MAX_LINES }}-line cap. Negative `line_offset` reads from the end (absolute value ≤ {{ MAX_LINES }}).
- Sensitive files (`.env`, credential stores, SSH keys, and similar secrets) are refused. Only UTF-8 text is supported; non-UTF-8/binary/NUL files are refused — use `ReadMediaFile` for images or video.
- Output format: `<line-number>\t<content>` per line. A trailing `<tool_meta ...>` block is appended after the file content; it summarizes how much was read and is not part of the file itself.
- Pure CRLF files are displayed with LF line endings; `Edit` matches this output and preserves CRLF when writing back. Mixed or lone CR endings are shown as `\r` and require exact `Edit.old_string` escapes.
- After a successful `Edit`/`Write`, do not re-read solely to prove the write landed. When the task depends on an exact file, API, or output shape, inspect the final external contract before finishing.
