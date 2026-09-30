// Shared access to the oxc native parser.
//
// Two consumers need it: the code indexer (`extract.ts`, which walks the AST
// for symbol records) and the post-edit syntax check (`syntax-check.ts`,
// which reads only the parse errors). Both pay the native-binding load, so it
// is lazy and cached here rather than duplicated per consumer.
//
// oxc-parser loads lazily so a missing native binding degrades to a catchable
// error instead of crashing the importing process (bundled CLI safety).
import { createRequire } from 'node:module';

/** An oxc parse error, narrowed to the fields we render. */
export interface OxcParseError {
  readonly message: string;
  readonly labels?: ReadonlyArray<{ readonly start: number; readonly end: number }>;
}

interface OxcParseResult {
  readonly program: unknown;
  readonly errors: readonly OxcParseError[];
}

type OxcParseSync = (fileName: string, source: string, options: { lang: string }) => OxcParseResult;

let cachedParseSync: OxcParseSync | undefined;

export function loadParseSync(): OxcParseSync {
  if (!cachedParseSync) {
    // H5: naming this binding `require` makes esbuild's CJS output emit a
    // self-referential `createRequire(require("url")…)` and throw
    // "Cannot access 'require' before initialization" in the SEA bundle.
    const requireFromHere = createRequire(import.meta.url);
    const mod = requireFromHere('oxc-parser') as { parseSync: OxcParseSync };
    cachedParseSync = mod.parseSync;
  }
  return cachedParseSync;
}

export function langForFile(fileName: string): 'ts' | 'tsx' | 'dts' | 'js' | 'jsx' {
  if (fileName.endsWith('.d.ts')) return 'dts';
  if (fileName.endsWith('.tsx')) return 'tsx';
  if (fileName.endsWith('.ts') || fileName.endsWith('.mts') || fileName.endsWith('.cts')) return 'ts';
  if (fileName.endsWith('.jsx') || fileName.endsWith('.mjsx')) return 'jsx';
  return 'js';
}

/** True for the extensions oxc can parse. */
export function isParseableSource(fileName: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/.test(fileName);
}

/**
 * Parse `source` and return oxc's errors, or `undefined` when the file is not
 * source oxc handles. Throws only if the native binding is missing, which
 * callers treat as "no diagnostics available" rather than a failed edit.
 */
export function parseSourceErrors(
  fileName: string,
  source: string,
): readonly OxcParseError[] | undefined {
  if (!isParseableSource(fileName)) return undefined;
  return loadParseSync()(fileName, source, { lang: langForFile(fileName) }).errors;
}
