export interface ContextFile {
  readonly path: string;
  readonly displayPath: string;
  readonly content: string;
  readonly lineCount: number;
}

export interface SymbolEntry {
  readonly line: number;
  readonly kind: string;
  readonly name: string;
  readonly signature: string;
}

export interface MatchEntry {
  readonly line: number;
  readonly text: string;
}

export interface RelationshipEntry {
  readonly line: number;
  readonly kind: 'import' | 'export';
  readonly target: string;
  readonly confidence: 'EXTRACTED';
  readonly text: string;
}

export interface TestHintEntry {
  readonly confidence: 'EXTRACTED' | 'INFERRED';
  readonly path: string;
  readonly reason: string;
}

export interface RankedFile {
  readonly file: ContextFile;
  readonly score: number;
  readonly symbols: readonly SymbolEntry[];
  readonly matches: readonly MatchEntry[];
  readonly relationships: readonly RelationshipEntry[];
  readonly testHints: readonly TestHintEntry[];
}
