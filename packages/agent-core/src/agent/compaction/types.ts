export interface CompactionInput {
  readonly summary: string;
  readonly contextSummary?: string;
  readonly compactedCount: number;
  readonly tokensBefore: number;
}

export interface CompactionResult extends CompactionInput {
  readonly tokensAfter: number;
  readonly keptUserMessageCount: number;
}

export type CompactionSource = 'manual' | 'agent';

export interface CompactionBeginData {
  readonly source: CompactionSource;
  readonly instruction?: string;
  readonly summary?: string;
}
