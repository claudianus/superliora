Fetch version-specific docs and code examples for a library via its Context7-compatible ID.

Use after Context7Resolve unless you already have a library ID. Provide `library_id` exactly as returned by Context7Resolve and a `query` for the task/API surface.

Returns LLM-optimized snippets from indexed official docs — prefer over WebSearch/FetchURL for library APIs. Use WebSearch/FetchURL for release notes, CVEs, papers, and non-library facts.
