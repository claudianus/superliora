const HOST_NAME = 'com.superliora.research_bridge';

/** @type {any} */
let port = null;

function connectNativeHost() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    console.error('[research-bridge] connectNative failed:', error);
    port = null;
    return;
  }

  port.onMessage.addListener((message) => {
    void handleHostMessage(message);
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    if (err !== undefined) {
      console.warn('[research-bridge] native host disconnected:', err.message);
    }
    port = null;
    setTimeout(connectNativeHost, 1_000);
  });

  port.postMessage({ type: 'ping' });
}

/**
 * @param {{ type?: string; query?: string; limit?: number; id?: string }} message
 */
async function handleHostMessage(message) {
  const type = message?.type;
  if (type === 'ping' || type === 'handshake') {
    port?.postMessage({ type: 'pong', extension: 'research-bridge', handshake: 'ok' });
    return;
  }
  if (type !== 'search') return;

  const query = typeof message.query === 'string' ? message.query.trim() : '';
  const limit = typeof message.limit === 'number' ? message.limit : 5;
  const id = typeof message.id === 'string' ? message.id : undefined;

  if (query.length === 0) {
    port?.postMessage({ type: 'search-result', id, results: [] });
    return;
  }

  const results = await searchHistory(query, limit);
  port?.postMessage({ type: 'search-result', id, results });
}

/**
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<{ title: string; url: string; snippet: string }>>}
 */
async function searchHistory(query, limit) {
  const cap = Math.min(Math.max(Number.isFinite(limit) ? limit : 5, 1), 20);
  const startTime = Date.now() - 365 * 24 * 60 * 60 * 1_000;

  /** @type {chrome.history.HistoryItem[]} */
  const items = await new Promise((resolve, reject) => {
    chrome.history.search(
      { text: query, startTime, maxResults: cap },
      (results) => {
        const err = chrome.runtime.lastError;
        if (err !== undefined) {
          reject(new Error(err.message));
          return;
        }
        resolve(results ?? []);
      },
    );
  });

  return items
    .filter((item) => typeof item.url === 'string' && item.url.length > 0)
    .slice(0, cap)
    .map((item) => ({
      title: (item.title ?? item.url ?? 'Untitled').trim(),
      url: item.url.trim(),
      snippet: buildSnippet(item, query),
    }));
}

/**
 * @param {chrome.history.HistoryItem} item
 * @param {string} query
 */
function buildSnippet(item, query) {
  const title = (item.title ?? '').trim();
  if (title.length > 0) {
    return `History hit for "${query}": ${title}`;
  }
  return `History hit for "${query}" at ${item.url ?? ''}`;
}

connectNativeHost();
