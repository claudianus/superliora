Perform exact replacements in existing files.

- Edit is mandatory for every incremental change. DO NOT use Write or Bash `sed`.
- Read the target file before every Edit. DO NOT call Edit from memory or a guessed `old_string`.
- Take `old_string`/`new_string` from the Read output. Drop the line-number prefix and tab; match only file content.
- `old_string` must be unique unless `replace_all` is set. Add surrounding context if ambiguous.
- Multiple Edit calls may run in one response only when they do not target the same file. DO NOT issue consecutive Edit calls on the same file without re-reading.
- Pure CRLF files: Read shows LF; use LF in strings; Edit writes CRLF back. Mixed/lone CR: include `\r` escapes.
