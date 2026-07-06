Resolve a library or framework name to a Context7-compatible library ID before fetching version-specific documentation.

Use this when you need up-to-date API docs, setup steps, or code examples for a named library. Call this before Context7Docs unless the user already gave a library ID in `/org/project` or `/org/project/version` form.

Provide both `library_name` (the package or product name) and `query` (the task or question — used to rank matches by relevance). Pick the best match from the results, then call Context7Docs with that library ID.

Prefer this over WebSearch/FetchURL when the goal is library or framework documentation rather than blog posts, papers, or security advisories.
