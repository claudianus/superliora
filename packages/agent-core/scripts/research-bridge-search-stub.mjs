/**
 * Deterministic Ch5 loopback search stub — no network in default serve mode.
 */

/** @typedef {{ title: string; url: string; snippet: string }} SearchHit */

/**
 * @param {string} query
 * @param {number} [limit]
 * @returns {SearchHit[]}
 */
export function stubSearchResults(query, limit = 5) {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const slug = trimmed
    .toLowerCase()
    .replaceAll(/[^\w\s-]/g, '')
    .replaceAll(/\s+/g, '-')
    .slice(0, 48);
  const cap = Math.min(Math.max(Number.isFinite(limit) ? limit : 5, 1), 10);
  const count = Math.min(cap, 3);

  return Array.from({ length: count }, (_, index) => ({
    title: `Stub: ${trimmed} (#${index + 1})`,
    url: `https://example.test/ch5/${slug || 'query'}/${index + 1}`,
    snippet: `Deterministic Ch5 fixture for "${trimmed}".`,
  }));
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ pathname?: string; searchFn?: (query: string, limit: number) => SearchHit[] | Promise<SearchHit[]> }} [options]
 */
export async function handleLoopbackSearchRequest(req, res, options = {}) {
  const pathname = options.pathname ?? '/search';
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (req.method !== 'POST' || url.pathname !== pathname) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const body = await readJsonBody(req);
  const query = typeof body.query === 'string' ? body.query : '';
  const limit = typeof body.limit === 'number' ? body.limit : 5;
  const searchFn = options.searchFn ?? stubSearchResults;
  const results = await searchFn(query, limit);

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ results }));
}
