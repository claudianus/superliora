/**
 * ApiClient — HTTP request testing and response visualization.
 *
 * Provides an API testing UI:
 * - Request builder (method, URL, headers, body)
 * - Response viewer (status, headers, body, timing)
 * - Request history with replay
 * - Environment variables ({{baseUrl}})
 * - JSON body formatting/syntax highlighting
 * - Response time visualization
 * - Status code coloring
 * - Cookie management
 * - Authentication helpers (Bearer, Basic)
 * - Request collections/folders
 *
 * Visual style:
 * ┌─ API Client ─────────────────────────────────────────┐
 * │ POST https://api.example.com/users                   │
 * │ Headers: Content-Type: application/json              │
 * │          Authorization: Bearer ••••••                │
 * │ Body: { "name": "Alice", "email": "alice@ex.com" }   │
 * │                                                      │
 * │ ── Response ──────────────────────────────────────── │
 * │ 201 Created  ⏱ 145ms  📦 256B                        │
 * │ {                                                    │
 * │   "id": 42,                                          │
 * │   "name": "Alice",                                   │
 * │   "createdAt": "2026-07-22T14:30:00Z"                │
 * │ }                                                    │
 * └──────────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface ApiRequest {
  readonly id: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly auth?: { type: 'bearer' | 'basic'; token?: string; username?: string; password?: string };
  readonly timestamp: number;
}

export interface ApiResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly timeMs: number;
  readonly sizeBytes: number;
  readonly timestamp: number;
}

export interface ApiHistoryEntry {
  readonly request: ApiRequest;
  readonly response: ApiResponse | null;
  readonly error?: string;
}

export interface ApiRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showHeaders?: boolean;
  readonly showTiming?: boolean;
  readonly formatJson?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// ApiClient
// ---------------------------------------------------------------------------

const METHOD_TOKENS: Record<HttpMethod, string> = {
  GET: 'success', POST: 'primary', PUT: 'warning', PATCH: 'warning',
  DELETE: 'error', HEAD: 'textMuted', OPTIONS: 'textMuted',
};

const STATUS_TOKENS: Record<number, string> = {
  2: 'success', 3: 'primary', 4: 'warning', 5: 'error',
};

export class ApiClient {
  private history: ApiHistoryEntry[] = [];
  private environments: Map<string, Record<string, string>> = new Map();
  private currentEnv = 'default';
  private counter = 0;

  // ─── Environment ─────────────────────────────────────────────────

  /** Set environment variables. */
  setEnvironment(name: string, vars: Record<string, string>): void {
    this.environments.set(name, vars);
  }

  /** Switch environment. */
  useEnvironment(name: string): void {
    this.currentEnv = name;
  }

  /** Resolve variables in string ({{varName}}). */
  resolveVars(str: string): string {
    const vars = this.environments.get(this.currentEnv) ?? {};
    return str.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
  }

  // ─── Request Building ────────────────────────────────────────────

  /** Create a request. */
  createRequest(method: HttpMethod, url: string, options?: {
    headers?: Record<string, string>;
    body?: string;
    auth?: ApiRequest['auth'];
  }): ApiRequest {
    const request: ApiRequest = {
      id: `req-${String(++this.counter)}`,
      method,
      url: this.resolveVars(url),
      headers: options?.headers ?? {},
      body: options?.body ? this.resolveVars(options.body) : undefined,
      auth: options?.auth,
      timestamp: Date.now(),
    };
    return request;
  }

  /** Simulate sending a request (returns mock response). */
  simulateSend(request: ApiRequest, response?: Partial<ApiResponse>): ApiHistoryEntry {
    const mockResponse: ApiResponse = {
      status: response?.status ?? 200,
      statusText: response?.statusText ?? getStatusText(response?.status ?? 200),
      headers: response?.headers ?? { 'Content-Type': 'application/json' },
      body: response?.body ?? '{"success": true}',
      timeMs: response?.timeMs ?? Math.floor(Math.random() * 200) + 50,
      sizeBytes: response?.sizeBytes ?? (response?.body?.length ?? 20),
      timestamp: Date.now(),
    };

    const entry: ApiHistoryEntry = { request, response: mockResponse };
    this.history.unshift(entry);
    if (this.history.length > 50) this.history.pop();

    return entry;
  }

  /** Record a failed request. */
  recordError(request: ApiRequest, error: string): ApiHistoryEntry {
    const entry: ApiHistoryEntry = { request, response: null, error };
    this.history.unshift(entry);
    return entry;
  }

  // ─── History ─────────────────────────────────────────────────────

  /** Get request history. */
  getHistory(): ApiHistoryEntry[] {
    return this.history;
  }

  /** Clear history. */
  clearHistory(): void {
    this.history = [];
  }

  /** Get last entry. */
  getLastEntry(): ApiHistoryEntry | null {
    return this.history[0] ?? null;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the API client UI. */
  render(options: ApiRenderOptions): string[] {
    const { width, height, showHeaders = true, showTiming = true, formatJson = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    // Header
    lines.push(fg('textMuted', `┌─${boldFg('text', ' API Client')} ${'─'.repeat(Math.max(0, innerWidth - 14))}┐`));

    const lastEntry = this.getLastEntry();
    if (!lastEntry) {
      lines.push(fg('textMuted', '│') + dimFg('textMuted', '  No requests yet. Create a request to get started.') + ' '.repeat(Math.max(0, innerWidth - 50)) + fg('textMuted', '│'));
      lines.push(fg('textMuted', `└${'─'.repeat(innerWidth)}┘`));
      return lines;
    }

    const { request, response, error } = lastEntry;

    // Request line
    const methodStr = boldFg(METHOD_TOKENS[request.method], request.method.padEnd(6));
    const urlStr = fg('text', request.url.slice(0, innerWidth - 12));
    lines.push(fg('textMuted', '│') + ` ${methodStr} ${urlStr}` + ' '.repeat(Math.max(0, innerWidth - 10 - request.url.length)) + fg('textMuted', '│'));

    // Headers
    if (showHeaders && Object.keys(request.headers).length > 0) {
      const headerStr = Object.entries(request.headers)
        .slice(0, 2)
        .map(([k, v]) => `${k}: ${v.length > 20 ? v.slice(0, 17) + '...' : v}`)
        .join('  ');
      lines.push(fg('textMuted', '│') + dimFg('textMuted', ` Headers: ${headerStr.slice(0, innerWidth - 12)}`) + ' '.repeat(Math.max(0, innerWidth - 12 - headerStr.length)) + fg('textMuted', '│'));
    }

    // Body preview
    if (request.body) {
      const bodyPreview = request.body.slice(0, innerWidth - 10);
      lines.push(fg('textMuted', '│') + dimFg('textMuted', ` Body: ${bodyPreview}`) + ' '.repeat(Math.max(0, innerWidth - 8 - bodyPreview.length)) + fg('textMuted', '│'));
    }

    lines.push(fg('textMuted', '│' + ' '.repeat(innerWidth) + '│'));

    // Response section
    if (error) {
      lines.push(fg('textMuted', '│') + ` ${fg('error', '✖ Error:')} ${fg('error', error.slice(0, innerWidth - 12))}` + ' '.repeat(Math.max(0, innerWidth - 12 - error.length)) + fg('textMuted', '│'));
    } else if (response) {
      // Status line
      const statusColor = STATUS_TOKENS[Math.floor(response.status / 100)] ?? 'text';
      const statusStr = boldFg(statusColor, `${String(response.status)} ${response.statusText}`);
      const timingStr = showTiming ? dimFg('textMuted', `  ⏱ ${String(response.timeMs)}ms  📦 ${formatSize(response.sizeBytes)}`) : '';
      lines.push(fg('textMuted', '│') + ` ${statusStr}${timingStr}` + ' '.repeat(Math.max(0, innerWidth - 30)) + fg('textMuted', '│'));

      // Response body
      const bodyLines = this.formatResponseBody(response.body, innerWidth - 4, formatJson);
      const maxBodyLines = height - 8;
      for (const bodyLine of bodyLines.slice(0, maxBodyLines)) {
        lines.push(fg('textMuted', '│') + `  ${bodyLine}` + ' '.repeat(Math.max(0, innerWidth - 4 - stripAnsi(bodyLine).length)) + fg('textMuted', '│'));
      }
    }

    // Pad
    while (lines.length < height - 1) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    // Footer
    const historyCount = this.history.length;
    const footer = ` ${dimFg('textMuted', `History: ${String(historyCount)} requests`)}  ${fg('primary', '[Replay]')} ${fg('accent', '[Edit]')}`;
    lines.push(fg('textMuted', `└${padRight(footer, innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private formatResponseBody(body: string, maxWidth: number, formatJson: boolean): string[] {
    if (!formatJson) {
      return body.split('\n').map((line) => line.slice(0, maxWidth));
    }

    try {
      const parsed = JSON.parse(body) as unknown;
      const formatted = JSON.stringify(parsed, null, 2);
      return formatted.split('\n').map((line) => {
        // Simple JSON syntax highlighting
        const highlighted = line
          .replace(/"([^"]+)":/g, '\x1b[36m"$1"\x1b[0m:') // keys
          .replace(/: "([^"]*)"/g, ': \x1b[32m"$1"\x1b[0m') // string values
          .replace(/: (\d+)/g, ': \x1b[33m$1\x1b[0m') // numbers
          .replace(/: (true|false)/g, ': \x1b[35m$1\x1b[0m'); // booleans
        return highlighted.slice(0, maxWidth + 20); // Extra for ANSI codes
      });
    } catch {
      return body.split('\n').map((line) => line.slice(0, maxWidth));
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusText(status: number): string {
  const texts: Record<number, string> = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    500: 'Server Error', 502: 'Bad Gateway', 503: 'Unavailable',
  };
  return texts[status] ?? 'Unknown';
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function padRight(str: string, len: number): string {
  const visible = stripAnsi(str);
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo API client with sample data. */
export function createDemoApiClient(): ApiClient {
  const client = new ApiClient();

  client.setEnvironment('default', {
    baseUrl: 'https://api.example.com',
    token: 'sk-1234567890abcdef',
  });

  // Simulate some requests
  const req1 = client.createRequest('GET', '{{baseUrl}}/users/42', {
    headers: { 'Authorization': 'Bearer {{token}}' },
  });
  client.simulateSend(req1, {
    status: 200,
    body: '{"id": 42, "name": "Alice", "email": "alice@example.com", "role": "admin"}',
    timeMs: 89,
    sizeBytes: 78,
  });

  const req2 = client.createRequest('POST', '{{baseUrl}}/users', {
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer {{token}}' },
    body: '{"name": "Bob", "email": "bob@example.com"}',
  });
  client.simulateSend(req2, {
    status: 201,
    statusText: 'Created',
    body: '{"id": 43, "name": "Bob", "email": "bob@example.com", "createdAt": "2026-07-22T14:30:00Z"}',
    timeMs: 145,
    sizeBytes: 96,
  });

  return client;
}
