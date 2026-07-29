/**
 * Semantic deduplication for conversation history.
 *
 * Removes redundant information from messages to improve token efficiency:
 * - File content deduplication: Replace repeated file contents with references
 * - Error consolidation: Group repeated errors into summaries
 * - Tool output deduplication: Remove duplicate tool outputs
 */

import { createHash } from 'node:crypto';
import type { ContentPart, Message } from '@superliora/kosong';
import { estimateTokens } from '../../utils/tokens';

export interface FileReference {
  path: string;
  contentHash: string;
  firstSeenIndex: number;
  lastSeenIndex: number;
  lineCount?: number;
}

export interface DeduplicationResult {
  messages: Message[];
  stats: DeduplicationStats;
}

export interface DeduplicationStats {
  originalTokens: number;
  deduplicatedTokens: number;
  savedTokens: number;
  fileDeduplications: number;
  errorConsolidations: number;
}

/**
 * Deduplicate file contents in messages.
 * When the same file content appears multiple times, replace subsequent
 * occurrences with a reference to the first occurrence.
 */
export function deduplicateFileContents(messages: Message[]): DeduplicationResult {
  const fileRefs = new Map<string, FileReference>();
  let fileDeduplications = 0;
  let savedTokens = 0;

  const deduplicated = messages.map((msg, idx) => {
    if (msg.role !== 'tool') return msg;

    const content = msg.content.map((part) => {
      if (part.type !== 'text') return part;

      // Try to extract file content from the text
      const fileMatch = extractFileContent(part.text);
      if (!fileMatch) return part;

      const { path, content: fileContent } = fileMatch;
      const contentHash = hashContent(fileContent);

      const existing = fileRefs.get(path);
      if (existing && existing.contentHash === contentHash) {
        // Duplicate: replace with reference
        fileDeduplications++;
        const originalTokens = estimateTokens(part.text);
        const reference = `[File ${path} content same as message ${existing.firstSeenIndex + 1}]`;
        savedTokens += originalTokens - estimateTokens(reference);
        return { ...part, text: reference };
      }

      // First occurrence: record it
      fileRefs.set(path, {
        path,
        contentHash,
        firstSeenIndex: idx,
        lastSeenIndex: idx,
        lineCount: fileContent.split('\n').length,
      });

      return part;
    });

    return { ...msg, content };
  });

  const originalTokens = messages.reduce((sum, msg) => sum + estimateTokensForMessage(msg), 0);
  const deduplicatedTokens = deduplicated.reduce((sum, msg) => sum + estimateTokensForMessage(msg), 0);

  return {
    messages: deduplicated,
    stats: {
      originalTokens,
      deduplicatedTokens,
      savedTokens: originalTokens - deduplicatedTokens,
      fileDeduplications,
      errorConsolidations: 0,
    },
  };
}

/**
 * Consolidate repeated error messages.
 * When the same error appears multiple times, group them into a summary.
 */
export function consolidateRepeatedErrors(messages: Message[]): DeduplicationResult {
  const errorGroups = new Map<string, { indices: number[]; message: string }>();
  let errorConsolidations = 0;
  let savedTokens = 0;

  // First pass: identify error messages and group them
  messages.forEach((msg, idx) => {
    if (msg.role !== 'tool') return;

    for (const part of msg.content) {
      if (part.type !== 'text') continue;

      const errorMatch = extractError(part.text);
      if (!errorMatch) continue;

      const errorKey = normalizeError(errorMatch);
      const existing = errorGroups.get(errorKey);
      if (existing) {
        existing.indices.push(idx);
      } else {
        errorGroups.set(errorKey, { indices: [idx], message: errorMatch });
      }
    }
  });

  // Second pass: consolidate groups with 3+ occurrences
  const consolidatedIndices = new Set<number>();
  const summaries: { index: number; summary: string }[] = [];

  for (const [, group] of errorGroups) {
    if (group.indices.length >= 3) {
      errorConsolidations++;
      const firstIndex = group.indices[0]!;
      const summary = `[Error occurred ${group.indices.length} times: "${group.message.slice(0, 100)}..."]`;

      // Mark all but first for replacement
      for (let i = 1; i < group.indices.length; i++) {
        consolidatedIndices.add(group.indices[i]!);
      }

      summaries.push({ index: firstIndex, summary });
      savedTokens += (group.indices.length - 1) * estimateTokens(group.message);
    }
  }

  // Apply consolidations
  const deduplicated = messages.map((msg, idx) => {
    if (!consolidatedIndices.has(idx)) return msg;

    const content = msg.content.map((part) => {
      if (part.type !== 'text') return part;
      const errorMatch = extractError(part.text);
      if (!errorMatch) return part;

      const errorKey = normalizeError(errorMatch);
      const group = errorGroups.get(errorKey);
      if (group && group.indices.length >= 3) {
        return { ...part, text: `[Duplicate error - see message ${group.indices[0]! + 1}]` };
      }
      return part;
    });

    return { ...msg, content };
  });

  const originalTokens = messages.reduce((sum, msg) => sum + estimateTokensForMessage(msg), 0);
  const deduplicatedTokens = deduplicated.reduce((sum, msg) => sum + estimateTokensForMessage(msg), 0);

  return {
    messages: deduplicated,
    stats: {
      originalTokens,
      deduplicatedTokens,
      savedTokens: originalTokens - deduplicatedTokens,
      fileDeduplications: 0,
      errorConsolidations,
    },
  };
}

/**
 * Apply all deduplication strategies.
 */
export function deduplicateMessages(messages: Message[]): DeduplicationResult {
  // Apply file deduplication first
  const fileResult = deduplicateFileContents(messages);

  // Then apply error consolidation
  const errorResult = consolidateRepeatedErrors(fileResult.messages);

  return {
    messages: errorResult.messages,
    stats: {
      originalTokens: fileResult.stats.originalTokens,
      deduplicatedTokens: errorResult.stats.deduplicatedTokens,
      savedTokens: fileResult.stats.savedTokens + errorResult.stats.savedTokens,
      fileDeduplications: fileResult.stats.fileDeduplications,
      errorConsolidations: errorResult.stats.errorConsolidations,
    },
  };
}

// Helper functions

function estimateTokensForMessage(message: Message): number {
  let total = estimateTokens(message.role);
  for (const part of message.content) {
    if (part.type === 'text') {
      total += estimateTokens(part.text);
    } else if (part.type === 'think') {
      total += estimateTokens(part.think);
    }
  }
  return total;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function extractFileContent(text: string): { path: string; content: string } | null {
  // Match patterns like "File: /path/to/file" or "Contents of /path/to/file:"
  const patterns = [
    /File:\s*([^\n]+)\n([\s\S]*)/,
    /Contents of ([^:]+):\n([\s\S]*)/,
    /```[^\n]*\n\/\/ ([^\n]+)\n([\s\S]*?)```/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return { path: match[1]!.trim(), content: match[2] ?? '' };
    }
  }

  return null;
}

function extractError(text: string): string | null {
  const patterns = [
    /Error:\s*([^\n]+)/,
    /error:\s*([^\n]+)/,
    /ERROR:\s*([^\n]+)/,
    /failed:\s*([^\n]+)/,
    /exception:\s*([^\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return match[1]!.trim();
    }
  }

  return null;
}

function normalizeError(error: string): string {
  // Remove variable parts (numbers, paths, timestamps)
  return error
    .replace(/\d+/g, 'N')
    .replace(/\/[^\s:]+/g, '/PATH')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, 'TIMESTAMP')
    .toLowerCase()
    .trim();
}
