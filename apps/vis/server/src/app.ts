import { timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import net from 'node:net';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { Hono } from 'hono';

import { SUPERLIORA_HOME, resolveHost } from './config';
import { serveWebAsset, type WebAsset } from './lib/web-asset';
import { blobsRoute } from './routes/blobs';
import { contextRoute } from './routes/context';
import { sessionDetailRoute } from './routes/session-detail';
import { sessionsRoute } from './routes/sessions';
import { subagentsRoute } from './routes/subagents';
import { wireRoute } from './routes/wire';

/** Resolve the SPA bundle directory next to the compiled server.mjs, if it
 * exists. Returns `null` in dev mode where the web bundle lives elsewhere. */
async function resolvePublicDir(): Promise<string | null> {
  try {
    const here = import.meta.dirname;
    const candidate = resolve(here, 'public');
    const s = await stat(candidate);
    if (s.isDirectory()) return candidate;
  } catch {
    // not present
  }
  return null;
}

const STATIC_EXT_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function mimeFor(path: string): string {
  const i = path.lastIndexOf('.');
  if (i < 0) return 'application/octet-stream';
  const ext = path.slice(i).toLowerCase();
  return STATIC_EXT_MIME[ext] ?? 'application/octet-stream';
}

export interface CreateAppOptions {
  readonly authToken?: string;
  readonly homeDir?: string;
  /** When provided, serve this single-file SPA from memory and skip the
   *  filesystem `public/` lookup. */
  readonly webAsset?: WebAsset;
  /** The host the server binds to; always allowed by the Host check. */
  readonly boundHost?: string;
}

/**
 * DNS-rebinding defense: reject requests whose `Host` is not a loopback
 * name/IP, an IP literal, the bound host, or an explicit extra. Without this,
 * a loopback instance with no `VIS_AUTH_TOKEN` would serve full session
 * transcripts to any website that rebinds a hostname at 127.0.0.1.
 */
export function isAllowedVisHost(
  host: string | undefined,
  boundHost: string,
  extras: readonly string[] = parseVisAllowedHosts(),
): boolean {
  if (host === undefined || host.trim().length === 0) return false;
  const h = stripVisPort(host.trim().toLowerCase());
  if (h.length === 0) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.startsWith('127.') || h === '::1' || h === '[::1]' || h === '0:0:0:0:0:0:0:1') return true;
  if (net.isIP(h) !== 0) return true;
  if (h === boundHost.trim().toLowerCase()) return true;
  for (const entry of extras) {
    if (entry.startsWith('.')) {
      if (h === entry.slice(1) || h.endsWith(entry)) return true;
    } else if (h === entry) {
      return true;
    }
  }
  return false;
}

/** Strip a trailing `:port` (including from bracketed IPv6) and lowercase. */
function stripVisPort(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return (end === -1 ? host : host.slice(0, end + 1)).toLowerCase();
  }
  const firstColon = host.indexOf(':');
  if (firstColon !== -1 && firstColon === host.lastIndexOf(':')) {
    const after = host.slice(firstColon + 1);
    if (/^\d+$/.test(after)) return host.slice(0, firstColon).toLowerCase();
  }
  return host.toLowerCase();
}

/** Extra allowed Host values: `VIS_ALLOWED_HOSTS` (comma-separated; a leading
 *  dot matches the domain and any subdomain). */
export function parseVisAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env['VIS_ALLOWED_HOSTS'];
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function bearerToken(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() ?? null;
}

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** Build a Hono app mounting /api/* routes, plus SPA static fallback. */
export async function createApp(options: CreateAppOptions = {}): Promise<Hono> {
  const app = new Hono();

  // Host-header check (DNS-rebinding defense) — before every route. The
  // `VIS_DISABLE_HOST_CHECK` escape hatch is test-only and expected to be
  // accompanied by a token in any real deployment.
  const boundHost = options.boundHost ?? resolveHost();
  if (process.env['VIS_DISABLE_HOST_CHECK'] !== '1') {
    app.use('*', async (c, next) => {
      if (isAllowedVisHost(c.req.header('host'), boundHost)) {
        await next();
        return;
      }
      return c.text(
        `invalid Host header: ${c.req.header('host') ?? '<missing>'}; allow it with VIS_ALLOWED_HOSTS`,
        403,
      );
    });
  }

  // Security headers on every response. The vis UI renders agent session
  // content (prompts, tool output, fetched pages), so the CSP keeps any
  // injected markup from loading remote script or exfiltrating the bearer
  // token the SPA holds.
  app.use('*', async (c, next) => {
    await next();
    c.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    c.header('x-content-type-options', 'nosniff');
    c.header('x-frame-options', 'DENY');
    c.header('referrer-policy', 'no-referrer');
  });

  // /api/* handlers.
  const api = new Hono();
  const authToken = options.authToken;
  const home = options.homeDir ?? SUPERLIORA_HOME;
  if (authToken !== undefined && authToken.length > 0) {
    api.use('*', async (c, next) => {
      const token = bearerToken(c.req.header('authorization'));
      if (token !== null && tokenMatches(token, authToken)) {
        await next();
        return;
      }
      c.header('www-authenticate', 'Bearer realm="liora-vis"');
      return c.json({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401);
    });
  }
  api.route('/sessions', sessionsRoute(home));
  api.route('/sessions', sessionDetailRoute(home));
  api.route('/sessions', wireRoute(home));
  api.route('/sessions', subagentsRoute(home));
  api.route('/sessions', blobsRoute(home));
  // Mount contextRoute last because it currently uses a catch-all stub
  // (Phase C scope) that would otherwise shadow more specific routes
  // registered below it.
  api.route('/sessions', contextRoute(home));

  app.route('/api', api);

  // Static + SPA fallback.
  if (options.webAsset !== undefined) {
    // Serve the embedded single-file SPA from memory for any non-/api GET.
    const asset = options.webAsset;
    app.get('*', (c) => {
      const pathname = new URL(c.req.url).pathname;
      if (pathname.startsWith('/api')) {
        // Should have been routed above; 404 here.
        return c.json({ error: `api route not found: ${pathname}`, code: 'NOT_FOUND' }, 404);
      }
      return serveWebAsset(asset);
    });
  } else {
    // Filesystem static serving (production standalone only).
    const publicDir = await resolvePublicDir();
    if (publicDir !== null) {
      app.get('*', async (c) => {
        const url = new URL(c.req.url);
        let pathname: string;
        try {
          pathname = decodeURIComponent(url.pathname);
        } catch {
          return c.text('bad request', 400);
        }
        if (pathname.startsWith('/api')) {
          // Should have been routed above; 404 here.
          return c.json({ error: `api route not found: ${pathname}`, code: 'NOT_FOUND' }, 404);
        }
        if (pathname === '/' || pathname === '') pathname = '/index.html';
        const resolved = resolve(publicDir, `.${pathname}`);
        // Containment via `relative`: a bare startsWith prefix check admits
        // sibling directories whose names share the prefix (`publicX`).
        const rel = relative(publicDir, resolved);
        if (rel.startsWith('..') || isAbsolute(rel)) {
          return c.text('forbidden', 403);
        }
        try {
          const s = await stat(resolved);
          if (s.isFile()) {
            const buf = await readFile(resolved);
            const body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
            return new Response(body, {
              headers: { 'content-type': mimeFor(resolved) },
            });
          }
        } catch {
          // fall through to SPA fallback
        }
        // SPA fallback — index.html for any unknown GET so client-side
        // React Router can resolve the route.
        try {
          const indexHtml = await readFile(join(publicDir, 'index.html'));
          const body = new Uint8Array(indexHtml.buffer, indexHtml.byteOffset, indexHtml.byteLength);
          return new Response(body, {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        } catch {
          return c.text('not found', 404);
        }
      });
    }
  }

  return app;
}
