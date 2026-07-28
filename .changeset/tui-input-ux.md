---
'@superliora/liora': minor
---

Add snippet/template system to the TUI autocomplete engine

- `Snippet` / `SnippetExpansion` types and `expandSnippetBody()` for
  VSCode-style tabstop expansion (`${1:default}`, `$1`); cursor lands at
  the lowest-numbered tabstop after expansion
- `createSnippetProvider()` — completion provider that matches snippet
  prefixes in general/command context and carries the template body in
  the new `CompletionItem.expansion` field
- `AutocompleteEngine.acceptWithExpansion()` — accepts the selected item
  and returns `{ text, cursor }`; snippet items are expanded with cursor
  placement, plain items insert text with cursor at the end
- `DEFAULT_SNIPPETS` — four built-in templates: `fix`, `test`, `review`,
  `explain`
- 22 new unit tests covering expansion, provider filtering/scoring, and
  engine acceptance
