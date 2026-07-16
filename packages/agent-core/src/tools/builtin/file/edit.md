Perform exact replacements in existing files.

- Edit is mandatory for every incremental change, especially small edits. DO NOT use Write or Bash `sed`.
- Read the target file before every Edit. DO NOT call Edit from memory, stale context, or a guessed `old_string`.
- Take `old_string`/`new_string` from the Read output view. Drop the line-number prefix and tab; match only file content.
- `old_string` must be unique unless `replace_all` is set. Add surrounding context if ambiguous. Use `replace_all` only when every occurrence should change (e.g. rename a symbol throughout the file).
- Multiple Edit calls may run in one response only when they do not target the same file. DO NOT issue consecutive Edit calls on the same file without re-reading — a previous Edit can invalidate a later `old_string`, causing `old_string not found`.
- A write lock serializes same-file edits in response order, but does not make stale `old_string` valid.
- Pure CRLF files: Read shows LF; use LF in strings; Edit writes CRLF back. Mixed/lone CR: Read shows `\r`; include `\r` escapes in those positions.
