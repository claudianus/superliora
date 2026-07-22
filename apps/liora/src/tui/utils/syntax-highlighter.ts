/**
 * SyntaxHighlighter — token-based syntax coloring for code display.
 *
 * Provides lightweight syntax highlighting for terminal rendering:
 * - Language detection from file extension or explicit hint
 * - Token-based lexer for common languages (TypeScript, Python, Rust, Go, JSON, YAML, Shell)
 * - Token categories: keyword, string, number, comment, type, function, operator, punctuation
 * - Theme-aware color mapping (token → color token)
 * - Line-by-line highlighting (streaming-friendly)
 * - Line number gutter with separator
 * - Highlight current line
 * - Diff-aware highlighting (for changed lines)
 *
 * Design:
 * - Regex-based tokenizer (not a full parser — fast and good enough for display)
 * - Each language has a token rule set (ordered patterns)
 * - Falls back to plain text for unknown languages
 * - Color output via callback (theme integration)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TokenCategory =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'type'
  | 'function'
  | 'operator'
  | 'punctuation'
  | 'variable'
  | 'constant'
  | 'decorator'
  | 'plain';

export interface Token {
  readonly category: TokenCategory;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface TokenRule {
  readonly category: TokenCategory;
  readonly pattern: RegExp;
}

export interface LanguageDef {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  readonly rules: readonly TokenRule[];
}

export interface HighlightOptions {
  readonly language?: string;
  readonly startLine?: number;
  readonly highlightLine?: number;
  readonly showLineNumbers?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Token-to-Color Mapping
// ---------------------------------------------------------------------------

const TOKEN_COLOR_MAP: Record<TokenCategory, string> = {
  keyword: 'accent',
  string: 'success',
  number: 'warning',
  comment: 'textMuted',
  type: 'primary',
  function: 'primary',
  operator: 'text',
  punctuation: 'textMuted',
  variable: 'text',
  constant: 'warning',
  decorator: 'accent',
  plain: 'text',
};

// ---------------------------------------------------------------------------
// Language Definitions
// ---------------------------------------------------------------------------

const LANG_TYPESCRIPT: LanguageDef = {
  id: 'typescript',
  name: 'TypeScript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
  rules: [
    { category: 'comment', pattern: /\/\/.*$|\/\*[\s\S]*?\*\// },
    { category: 'string', pattern: /`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/ },
    { category: 'decorator', pattern: /@\w+/ },
    { category: 'keyword', pattern: /\b(?:const|let|var|function|class|interface|type|enum|import|export|from|return|if|else|for|while|do|switch|case|break|continue|new|this|super|extends|implements|async|await|yield|try|catch|finally|throw|typeof|instanceof|in|of|as|is|keyof|readonly|declare|abstract|namespace|module|satisfies)\b/ },
    { category: 'constant', pattern: /\b(?:true|false|null|undefined|NaN|Infinity)\b/ },
    { category: 'type', pattern: /\b(?:string|number|boolean|void|never|any|unknown|object|symbol|bigint|Array|Map|Set|Promise|Record|Partial|Required|Readonly|Omit|Pick)\b/ },
    { category: 'number', pattern: /\b(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/ },
    { category: 'function', pattern: /\b[a-zA-Z_$][\w$]*(?=\s*\()/ },
    { category: 'operator', pattern: /=>|\.{3}|[+\-*/%=!<>&|^~?:]+/ },
    { category: 'punctuation', pattern: /[{}[\]();,.]/ },
  ],
};

const LANG_PYTHON: LanguageDef = {
  id: 'python',
  name: 'Python',
  extensions: ['.py', '.pyi'],
  rules: [
    { category: 'comment', pattern: /#.*$/ },
    { category: 'string', pattern: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/ },
    { category: 'decorator', pattern: /@\w+/ },
    { category: 'keyword', pattern: /\b(?:def|class|import|from|return|if|elif|else|for|while|break|continue|pass|raise|try|except|finally|with|as|yield|lambda|and|or|not|in|is|global|nonlocal|assert|del|async|await)\b/ },
    { category: 'constant', pattern: /\b(?:True|False|None)\b/ },
    { category: 'type', pattern: /\b(?:int|float|str|bool|list|dict|tuple|set|bytes|type|object)\b/ },
    { category: 'number', pattern: /\b(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?j?)\b/ },
    { category: 'function', pattern: /\b[a-zA-Z_]\w*(?=\s*\()/ },
    { category: 'operator', pattern: /[+\-*/%=!<>&|^~@]+/ },
    { category: 'punctuation', pattern: /[{}[\]();:,.]/ },
  ],
};

const LANG_RUST: LanguageDef = {
  id: 'rust',
  name: 'Rust',
  extensions: ['.rs'],
  rules: [
    { category: 'comment', pattern: /\/\/.*$|\/\*[\s\S]*?\*\// },
    { category: 'string', pattern: /"(?:[^"\\]|\\.)*"|r#*"[\s\S]*?"#*/ },
    { category: 'keyword', pattern: /\b(?:fn|let|mut|const|struct|enum|impl|trait|pub|use|mod|crate|self|super|return|if|else|for|while|loop|match|break|continue|move|ref|where|async|await|dyn|unsafe|extern|type|static)\b/ },
    { category: 'constant', pattern: /\b(?:true|false|Some|None|Ok|Err)\b/ },
    { category: 'type', pattern: /\b(?:i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|f32|f64|bool|char|str|String|Vec|Option|Result|Box|Rc|Arc|HashMap|HashSet)\b/ },
    { category: 'number', pattern: /\b(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?(?:f32|f64|i\d+|u\d+)?)\b/ },
    { category: 'decorator', pattern: /#!?\[[\w(,=\s"]*\]/ },
    { category: 'function', pattern: /\b[a-zA-Z_]\w*(?=\s*[!(])/ },
    { category: 'operator', pattern: /->|=>|\.{2,3}|[+\-*/%=!<>&|^~?]+/ },
    { category: 'punctuation', pattern: /[{}[\]();:,.]/ },
  ],
};

const LANG_GO: LanguageDef = {
  id: 'go',
  name: 'Go',
  extensions: ['.go'],
  rules: [
    { category: 'comment', pattern: /\/\/.*$|\/\*[\s\S]*?\*\// },
    { category: 'string', pattern: /`[^`]*`|"(?:[^"\\]|\\.)*"/ },
    { category: 'keyword', pattern: /\b(?:func|var|const|type|struct|interface|map|chan|go|select|case|default|if|else|for|range|switch|break|continue|return|defer|package|import|fallthrough|goto)\b/ },
    { category: 'constant', pattern: /\b(?:true|false|nil|iota)\b/ },
    { category: 'type', pattern: /\b(?:int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|complex64|complex128|byte|rune|string|bool|error|any)\b/ },
    { category: 'number', pattern: /\b(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?i?)\b/ },
    { category: 'function', pattern: /\b[a-zA-Z_]\w*(?=\s*\()/ },
    { category: 'operator', pattern: /:=|<-|[+\-*/%=!<>&|^~]+/ },
    { category: 'punctuation', pattern: /[{}[\]();:,.]/ },
  ],
};

const LANG_JSON: LanguageDef = {
  id: 'json',
  name: 'JSON',
  extensions: ['.json', '.jsonc'],
  rules: [
    { category: 'string', pattern: /"(?:[^"\\]|\\.)*"(?=\s*:)/ },
    { category: 'string', pattern: /"(?:[^"\\]|\\.)*"/ },
    { category: 'constant', pattern: /\b(?:true|false|null)\b/ },
    { category: 'number', pattern: /-?\d+\.?\d*(?:[eE][+-]?\d+)?/ },
    { category: 'punctuation', pattern: /[{}[\]:,]/ },
  ],
};

const LANG_SHELL: LanguageDef = {
  id: 'shell',
  name: 'Shell',
  extensions: ['.sh', '.bash', '.zsh'],
  rules: [
    { category: 'comment', pattern: /#.*$/ },
    { category: 'string', pattern: /"(?:[^"\\]|\\.)*"|'[^']*'/ },
    { category: 'keyword', pattern: /\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|local|export|source|alias|cd|echo|printf|read|set|unset|shift|trap)\b/ },
    { category: 'variable', pattern: /\$\{[^}]+\}|\$[a-zA-Z_]\w*|\$[#?@$!]/ },
    { category: 'number', pattern: /\b\d+\b/ },
    { category: 'operator', pattern: /[|&;<>(){}[\]!]+/ },
  ],
};

const LANG_YAML: LanguageDef = {
  id: 'yaml',
  name: 'YAML',
  extensions: ['.yml', '.yaml'],
  rules: [
    { category: 'comment', pattern: /#.*$/ },
    { category: 'keyword', pattern: /^[\s-]*[\w.-]+(?=\s*:)/ },
    { category: 'string', pattern: /"(?:[^"\\]|\\.)*"|'[^']*'/ },
    { category: 'constant', pattern: /\b(?:true|false|null|yes|no)\b/ },
    { category: 'number', pattern: /\b\d+\.?\d*\b/ },
    { category: 'punctuation', pattern: /[:\-\[\]{}>,|]/ },
  ],
};

export const LANGUAGES: readonly LanguageDef[] = [
  LANG_TYPESCRIPT, LANG_PYTHON, LANG_RUST, LANG_GO, LANG_JSON, LANG_SHELL, LANG_YAML,
];

// ---------------------------------------------------------------------------
// SyntaxHighlighter
// ---------------------------------------------------------------------------

export class SyntaxHighlighter {
  private languages: Map<string, LanguageDef> = new Map();
  private extensionMap: Map<string, LanguageDef> = new Map();

  constructor() {
    for (const lang of LANGUAGES) {
      this.languages.set(lang.id, lang);
      for (const ext of lang.extensions) {
        this.extensionMap.set(ext, lang);
      }
    }
  }

  // ─── Language Detection ──────────────────────────────────────────

  /** Detect language from file extension. */
  detectLanguage(filename: string): LanguageDef | null {
    const ext = filename.includes('.') ? '.' + filename.split('.').pop()!.toLowerCase() : '';
    return this.extensionMap.get(ext) ?? null;
  }

  /** Get a language by ID. */
  getLanguage(id: string): LanguageDef | null {
    return this.languages.get(id.toLowerCase()) ?? null;
  }

  /** Register a custom language. */
  registerLanguage(lang: LanguageDef): void {
    this.languages.set(lang.id, lang);
    for (const ext of lang.extensions) {
      this.extensionMap.set(ext, lang);
    }
  }

  // ─── Tokenization ────────────────────────────────────────────────

  /** Tokenize a single line of code. */
  tokenize(line: string, language: LanguageDef): Token[] {
    const tokens: Token[] = [];
    let remaining = line;
    let offset = 0;

    while (remaining.length > 0) {
      let matched = false;

      for (const rule of language.rules) {
        const regex = new RegExp(`^(?:${rule.pattern.source})`, rule.pattern.flags.replace('g', ''));
        const match = regex.exec(remaining);

        if (match && match[0].length > 0) {
          tokens.push({
            category: rule.category,
            text: match[0],
            start: offset,
            end: offset + match[0].length,
          });
          offset += match[0].length;
          remaining = remaining.slice(match[0].length);
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Consume one character as plain text
        const lastToken = tokens[tokens.length - 1];
        if (lastToken && lastToken.category === 'plain') {
          // Merge with previous plain token
          tokens[tokens.length - 1] = {
            ...lastToken,
            text: lastToken.text + remaining[0],
            end: lastToken.end + 1,
          };
        } else {
          tokens.push({
            category: 'plain',
            text: remaining[0]!,
            start: offset,
            end: offset + 1,
          });
        }
        offset++;
        remaining = remaining.slice(1);
      }
    }

    return tokens;
  }

  // ─── Highlighting ────────────────────────────────────────────────

  /** Highlight a single line and return the colored string. */
  highlightLine(line: string, language: LanguageDef | null, options: HighlightOptions): string {
    if (!language) return options.fg('text', line);

    const tokens = this.tokenize(line, language);
    let result = '';

    for (const token of tokens) {
      const colorToken = TOKEN_COLOR_MAP[token.category];
      switch (token.category) {
        case 'keyword':
        case 'decorator':
          result += options.boldFg(colorToken, token.text);
          break;
        case 'comment':
          result += options.dimFg(colorToken, token.text);
          break;
        default:
          result += options.fg(colorToken, token.text);
          break;
      }
    }

    return result;
  }

  /** Highlight multiple lines with optional line numbers. */
  highlight(code: string, options: HighlightOptions): string[] {
    const language = options.language
      ? this.getLanguage(options.language)
      : null;

    const lines = code.split('\n');
    const startLine = options.startLine ?? 1;
    const showLineNumbers = options.showLineNumbers ?? true;
    const gutterWidth = String(startLine + lines.length - 1).length + 1;
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const lineNo = startLine + i;
      const line = lines[i] ?? '';
      const highlighted = this.highlightLine(line, language, options);

      let prefix = '';
      if (showLineNumbers) {
        const isHighlight = lineNo === options.highlightLine;
        const noStr = String(lineNo).padStart(gutterWidth);
        prefix = isHighlight
          ? options.boldFg('accent', `${noStr}▎`)
          : options.dimFg('textMuted', `${noStr} `);
      }

      result.push(`${prefix}${highlighted}`);
    }

    return result;
  }

  /** Highlight a file (auto-detect language from filename). */
  highlightFile(code: string, filename: string, options: Omit<HighlightOptions, 'language'>): string[] {
    const language = this.detectLanguage(filename);
    return this.highlight(code, { ...options, language: language?.id });
  }
}
