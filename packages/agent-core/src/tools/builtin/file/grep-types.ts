export type GrepMode = 'content' | 'files_with_matches' | 'count_matches';

export type ParsedGrepLine =
  | {
      readonly kind: 'record';
      readonly filePath: string;
      readonly payload: string;
    }
  | {
      readonly kind: 'separator';
    }
  | {
      readonly kind: 'legacy';
      readonly text: string;
    };

export class GrepAbortedError extends Error {
  constructor() {
    super('Grep aborted');
    this.name = 'GrepAbortedError';
  }
}
