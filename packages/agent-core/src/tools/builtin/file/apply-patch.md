Apply multi-hunk patches to one or more files in a single call.

Use OpenCode-style patch text (not raw unified diff):

```
*** Begin Patch
*** Update File: path/to/file.ts
@@
-old line
+new line
*** Add File: path/new.ts
+first line
*** Delete File: path/remove.ts
*** End Patch
```

Rules:
- Always Read affected files before patching; build hunks from fresh Read output.
- Each `@@` starts a hunk. Prefix lines with space (context), `-` (remove), or `+` (add).
- Update hunks must match exactly once; add surrounding context if ambiguous.
- Prefer ApplyPatch for multi-file or multi-hunk edits; use Edit for a single small replacement.
- On failure, the error includes a hint to Re-Read — do not retry from memory.
