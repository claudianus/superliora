export const LIBRARY_DOCS_RESEARCH_GUIDANCE = [
  'For library/framework/API documentation: prefer Context7Resolve → Context7Docs (version-specific, indexed official docs) before WebSearch/FetchURL.',
  'Use WebSearch/FetchURL for papers, CVEs, release blogs, benchmarks without a clear library target, and facts outside indexed docs.',
  'When the user names a library ID (`/org/project`), skip Context7Resolve and call Context7Docs directly.',
].join(' ');
