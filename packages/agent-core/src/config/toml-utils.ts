import { TomlError } from 'smol-toml';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function cloneRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  return cloneUnknown(value);
}

export function cloneUnknown<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneObjectValue(value: unknown): unknown {
  return isPlainObject(value) ? cloneUnknown(value) : value;
}

export function setDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  } else {
    delete target[key];
  }
}

export function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'EEXIST'
  );
}

export function describeUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One-line summary of a smol-toml parse error: first message line plus the
 * line/column location, without the multi-line code-frame block.
 */
export function describeTomlSyntaxError(error: unknown): string {
  const firstLine = describeUnknownError(error).split('\n', 1)[0] ?? '';
  if (error instanceof TomlError) {
    return `${firstLine} (line ${error.line}, column ${error.column})`;
  }
  return firstLine;
}
