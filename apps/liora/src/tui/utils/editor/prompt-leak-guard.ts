/**
 * Detect diagnostic / compiler / stack-trace blobs that must never land
 * in the TUI prompt. Used by setText and restoreInputText.
 */

const COMPILE_UNSAFE = /compileUnsafe/i;
const DIST_NATIVE_INTERMEDIATE =
  /dist-native[/\\]+intermediates[/\\]+main\.cjs/i;
const AT_STACK_FRAME =
  /^\s*at\s+\S+(?:\s+\([^)\n]+\)|\s+\[[^\]]+\])?\s*$/m;
const NODE_INTERNAL_STACK = /(?:^|\n)\s*at\s+(?:node:|internal\/|Module\._)/;
const ERROR_PREFIX = /^(?:Error|TypeError|ReferenceError|RangeError|SyntaxError|URIError|EvalError): /m;

export function looksLikePromptLeak(text: string): boolean {
  if (text.length === 0) return false;
  if (COMPILE_UNSAFE.test(text)) return true;
  if (DIST_NATIVE_INTERMEDIATE.test(text)) return true;
  if (NODE_INTERNAL_STACK.test(text)) return true;
  if (ERROR_PREFIX.test(text) && AT_STACK_FRAME.test(text)) return true;
  const lines = text.split(/\r?\n/);
  if (lines.length >= 3) {
    let stackLines = 0;
    for (const line of lines) {
      if (/^\s*at\s+\S+/.test(line)) stackLines += 1;
    }
    if (stackLines >= 2) return true;
  }
  return false;
}
