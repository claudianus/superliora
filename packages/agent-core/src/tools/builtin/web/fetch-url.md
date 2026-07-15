Fetch content from a URL. For an HTML page the main article text is extracted; for plain-text/markdown the full body is returned. The result states which form you received so you can judge completeness. Use when you need a specific page.

Only fully-formed public `http`/`https` URLs; other schemes and private/loopback addresses are not fetched. Very large pages may be truncated or refused.

If extracted content is incomplete because the page needs rendering or targeted selection, use an available Scrapling-compatible MCP/CLI/browser tool for authorized public-page observation instead of inventing ad-hoc scraping logic.
