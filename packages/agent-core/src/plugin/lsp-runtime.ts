import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

import type { PluginLspServerDef } from './lsp-bridge';

export interface LspDiagnostic {
  readonly severity: number;
  readonly message: string;
  readonly line: number;
  readonly character: number;
}

/**
 * Lazy stdio LSP pool for enabled plugin servers.
 * Collects `publishDiagnostics` after didOpen; degrades when binaries missing.
 */
export class PluginLspRuntime {
  private readonly clients = new Map<string, LspStdioClient>();
  private readonly failed = new Set<string>();

  constructor(
    private readonly servers: readonly PluginLspServerDef[],
    private readonly cwd: string,
  ) {}

  async collectForFile(filePath: string, text: string): Promise<string | undefined> {
    const server = matchServer(this.servers, filePath);
    if (server === undefined) return undefined;
    if (this.failed.has(server.name)) return undefined;
    try {
      const client = await this.ensureClient(server);
      const diags = await client.openAndWaitDiagnostics(filePath, text, 1_500);
      return formatDiagnostics(filePath, server.name, diags);
    } catch {
      this.failed.add(server.name);
      await this.disposeClient(server.name);
      return undefined;
    }
  }

  async dispose(): Promise<void> {
    const names = [...this.clients.keys()];
    await Promise.all(names.map((name) => this.disposeClient(name)));
  }

  private async ensureClient(server: PluginLspServerDef): Promise<LspStdioClient> {
    const existing = this.clients.get(server.name);
    if (existing !== undefined) return existing;
    const client = await LspStdioClient.start({
      command: server.command,
      args: server.args ?? [],
      cwd: this.cwd,
      rootUri: pathToFileUri(this.cwd),
    });
    this.clients.set(server.name, client);
    return client;
  }

  private async disposeClient(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client === undefined) return;
    this.clients.delete(name);
    await client.dispose();
  }
}

function matchServer(
  servers: readonly PluginLspServerDef[],
  filePath: string,
): PluginLspServerDef | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (ext.length === 0) return undefined;
  for (const server of servers) {
    const map = server.extensionToLanguage;
    if (map === undefined) {
      // No map → accept common defaults for known server names, else first server.
      if (DEFAULT_EXTENSIONS[server.name]?.includes(ext) === true) return server;
      continue;
    }
    if (Object.keys(map).some((key) => normalizeExt(key) === ext)) return server;
  }
  // Fallback: first server with no extension map.
  return servers.find((server) => server.extensionToLanguage === undefined);
}

const DEFAULT_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  typescript: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'],
  ['typescript-language-server']: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'],
  pyright: ['.py', '.pyi'],
  ['python-lsp-server']: ['.py', '.pyi'],
  gopls: ['.go'],
  ['rust-analyzer']: ['.rs'],
};

function normalizeExt(value: string): string {
  return value.startsWith('.') ? value.toLowerCase() : `.${value.toLowerCase()}`;
}

function formatDiagnostics(
  filePath: string,
  serverName: string,
  diags: readonly LspDiagnostic[],
): string | undefined {
  if (diags.length === 0) return undefined;
  const capped = diags.slice(0, 20);
  const lines = capped.map((diag) => {
    const sev = severityLabel(diag.severity);
    return `- ${sev} L${String(diag.line + 1)}:${String(diag.character + 1)} ${diag.message}`;
  });
  const more =
    diags.length > capped.length ? `\n…and ${String(diags.length - capped.length)} more` : '';
  return `LSP diagnostics (${serverName}) for ${filePath}:\n${lines.join('\n')}${more}`;
}

function severityLabel(severity: number): string {
  switch (severity) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    case 3:
      return 'info';
    case 4:
      return 'hint';
    default:
      return 'diag';
  }
}

function pathToFileUri(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (process.platform === 'win32') {
    return `file:///${resolved.replace(/\\/g, '/')}`;
  }
  return `file://${resolved}`;
}

class LspStdioClient {
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly diagnostics = new Map<string, LspDiagnostic[]>();
  private readonly waiters = new Map<string, Array<(diags: LspDiagnostic[]) => void>>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private disposed = false;

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.consume();
    });
    child.stderr.on('data', () => {
      // Ignore stderr noise; failures surface via initialize/timeout.
    });
    child.on('exit', () => {
      this.rejectAll(new Error('LSP server exited'));
    });
  }

  static async start(input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly rootUri: string;
  }): Promise<LspStdioClient> {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    const spawnError = await new Promise<Error | undefined>((resolve) => {
      const onError = (error: Error): void => {
        cleanup();
        resolve(error);
      };
      const onSpawn = (): void => {
        cleanup();
        resolve(undefined);
      };
      const cleanup = (): void => {
        child.off('error', onError);
        child.off('spawn', onSpawn);
      };
      child.once('error', onError);
      child.once('spawn', onSpawn);
    });
    if (spawnError !== undefined) {
      throw spawnError;
    }
    const client = new LspStdioClient(child);
    await client.request('initialize', {
      processId: process.pid,
      rootUri: input.rootUri,
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
        },
      },
      clientInfo: { name: 'superliora-plugin-lsp', version: '0.0.0' },
    });
    client.notify('initialized', {});
    return client;
  }

  async openAndWaitDiagnostics(
    filePath: string,
    text: string,
    timeoutMs: number,
  ): Promise<LspDiagnostic[]> {
    const uri = pathToFileUri(filePath);
    this.diagnostics.delete(uri);
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: languageIdForPath(filePath),
        version: 1,
        text,
      },
    });
    return new Promise<LspDiagnostic[]>((resolve) => {
      const timer = setTimeout(() => {
        const waiters = this.waiters.get(uri) ?? [];
        this.waiters.set(
          uri,
          waiters.filter((waiter) => waiter !== onDiag),
        );
        resolve(this.diagnostics.get(uri) ?? []);
      }, timeoutMs);
      const onDiag = (diags: LspDiagnostic[]): void => {
        clearTimeout(timer);
        resolve(diags);
      };
      const list = this.waiters.get(uri) ?? [];
      list.push(onDiag);
      this.waiters.set(uri, list);
      const existing = this.diagnostics.get(uri);
      if (existing !== undefined) {
        onDiag(existing);
      }
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.notify('exit', null);
    } catch {
      // ignore
    }
    this.child.kill('SIGTERM');
    this.rejectAll(new Error('LSP client disposed'));
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(message: Record<string, unknown>): void {
    if (this.disposed) return;
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${String(body.length)}\r\n\r\n`, 'utf8');
    this.child.stdin.write(Buffer.concat([header, body]));
  }

  private consume(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (match?.[1] === undefined) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number.parseInt(match[1], 10);
      const total = headerEnd + 4 + length;
      if (this.buffer.length < total) return;
      const body = this.buffer.subarray(headerEnd + 4, total).toString('utf8');
      this.buffer = this.buffer.subarray(total);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let message: unknown;
    try {
      message = JSON.parse(body) as unknown;
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const msg = message as Record<string, unknown>;
    if (typeof msg['id'] === 'number' && this.pending.has(msg['id'])) {
      const pending = this.pending.get(msg['id'])!;
      this.pending.delete(msg['id']);
      if (msg['error'] !== undefined) {
        pending.reject(new Error(JSON.stringify(msg['error'])));
      } else {
        pending.resolve(msg['result']);
      }
      return;
    }
    if (msg['method'] === 'textDocument/publishDiagnostics' && isObject(msg['params'])) {
      const params = msg['params'] as Record<string, unknown>;
      const uri = typeof params['uri'] === 'string' ? params['uri'] : undefined;
      if (uri === undefined) return;
      const rawDiags = Array.isArray(params['diagnostics']) ? params['diagnostics'] : [];
      const diags = rawDiags.map(parseDiagnostic).filter((d): d is LspDiagnostic => d !== undefined);
      this.diagnostics.set(uri, diags);
      const waiters = this.waiters.get(uri) ?? [];
      this.waiters.delete(uri);
      for (const waiter of waiters) waiter(diags);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function parseDiagnostic(value: unknown): LspDiagnostic | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const message = typeof raw['message'] === 'string' ? raw['message'] : undefined;
  if (message === undefined) return undefined;
  const severity = typeof raw['severity'] === 'number' ? raw['severity'] : 1;
  const range = isObject(raw['range']) ? (raw['range'] as Record<string, unknown>) : undefined;
  const start = range !== undefined && isObject(range['start'])
    ? (range['start'] as Record<string, unknown>)
    : undefined;
  const line = typeof start?.['line'] === 'number' ? start['line'] : 0;
  const character = typeof start?.['character'] === 'number' ? start['character'] : 0;
  return { severity, message, line, character };
}

function languageIdForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.ts':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.tsx':
      return 'typescriptreact';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.jsx':
      return 'javascriptreact';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    default:
      return 'plaintext';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
