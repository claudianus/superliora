Resolve a library or framework name to a Context7-compatible library ID before fetching version-specific docs.

Use for up-to-date API docs, setup steps, or code examples for a named library. Call before Context7Docs unless the user already gave a library ID in `/org/project` or `/org/project/version` form.

Provide both `library_name` (package/product name) and `query` (task/question — ranks matches by relevance). Pick the best match, then call Context7Docs with that library ID.
