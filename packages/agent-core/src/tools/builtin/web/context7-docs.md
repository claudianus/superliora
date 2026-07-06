Fetch up-to-date, version-specific documentation and code examples for a library using its Context7-compatible ID.

Use after Context7Resolve unless you already have a library ID such as `/vercel/next.js` or `/mongodb/docs`. Provide `library_id` exactly as returned by Context7Resolve (or from the user) and a focused `query` describing the task or API surface you need.

This returns LLM-optimized snippets from indexed official docs — prefer it over WebSearch/FetchURL for library APIs, configuration, and code patterns. Use WebSearch/FetchURL for release announcements, CVEs, papers, and non-library facts.
