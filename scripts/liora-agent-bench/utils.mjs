import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function commandRecord(name, taskId, result, extra) {
  return {
    name,
    taskId,
    command: result.command,
    args: result.args.map(redactOutput),
    cwd: result.cwd,
    startedAt: result.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: result.durationMs,
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: redactOutput(result.stdout),
    stderr: redactOutput(result.stderr),
    error: redactOutput(result.error),
    ...redactRecord(extra),
  };
}

export function runBoundedCommand(command, args, { cwd, timeoutMs, env = process.env }) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return {
    command,
    args,
    cwd,
    startedAt,
    status: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message,
    timedOut: result.error?.code === 'ETIMEDOUT',
    durationMs: Date.now() - startedMs,
  };
}

export function resolveSourceCheckout() {
  const result = runBoundedCommand('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  if (result.status === 0 && result.stdout.trim() !== '') return path.resolve(result.stdout.trim());
  return path.resolve(process.cwd());
}

export function resolveInside(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error(`Path escapes benchmark workspace: ${relativePath}`);
  }
  return target;
}

export function readJsonPointer(value, pointer) {
  if (pointer === '' || pointer === '/') return value;
  const segments = String(pointer ?? '').split('/').slice(1);
  let current = value;
  for (const raw of segments) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    current = current?.[segment];
  }
  return current;
}

export function safeFileName(value) {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, '_');
}

export function estimateTokens(value) {
  return Math.ceil(String(value ?? '').length / 4);
}

export function round(value) {
  return Math.round(value * 1000) / 1000;
}

export function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export function unique(values) {
  return [...new Set(values)];
}

export function hasNonBlankEnv(env, name) {
  return typeof env[name] === 'string' && env[name].trim().length > 0;
}

export async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readFileIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

export async function appendJsonl(filePath, record) {
  const previous = (await readFileIfExists(filePath)) ?? '';
  await writeFile(filePath, `${previous}${JSON.stringify(redactRecord(record))}\n`, 'utf8');
}

export async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(redactRecord(data), null, 2)}\n`, 'utf8');
}

function redactRecord(value) {
  if (Array.isArray(value)) return value.map(redactRecord);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        isSensitiveKey(key) ? '<redacted>' : redactRecord(entry),
      ]),
    );
  }
  if (typeof value === 'string') return redactOutput(value);
  return value;
}

const SECRET_ASSIGNMENT_PATTERN =
  /((?:^|[^\w])["'`]?[A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|oauth|bearer|auth|client[_-]?secret)[A-Za-z0-9_.-]*["'`]?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|`[^`\r\n]*`|[^\s"',;]+)/gi;

const SENSITIVE_KEY_PATTERN =
  /(?:^|[_\-.])(?:api[_-]?key|token|secret|password|oauth|bearer|auth|client[_-]?secret)(?:$|[_\-.])/i;

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function redactOutput(value) {
  return String(value ?? '')
    .replaceAll(/sk-[A-Za-z0-9_-]{20,}/g, '<redacted>')
    .replaceAll(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer <redacted>')
    .replaceAll(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '<redacted-private-key>')
    .replaceAll(SECRET_ASSIGNMENT_PATTERN, (match, prefix, secretValue) => {
      const quote = secretValue[0];
      if (quote === '"' || quote === "'" || quote === '`') {
        return `${prefix}${quote}<redacted>${quote}`;
      }
      return `${prefix}<redacted>`;
    })
    .replaceAll(
      /\b(api[_-]?key|token|secret|password|oauth|bearer|auth|client[_-]?secret)\b(\s*[:=]\s*)[^\s"'`]+/gi,
      '$1$2<redacted>',
    )
    .slice(0, 50_000);
}
