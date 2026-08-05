#!/usr/bin/env node

/**
 * Dataset-free retrieval adapter for LoCoMo/LongMemEval-style exports.
 *
 * The benchmark data stays outside this repository. The adapter normalizes
 * either the small canonical format below or the common conversation/haystack
 * shapes used by LoCoMo and LongMemEval, then measures the deterministic
 * Memory store only:
 *
 *   {
 *     "records": [{ "content": "...", "subject": "...", "evidence_refs": [...] }],
 *     "cases": [{ "query": "...", "expected_evidence_ids": ["..."] }]
 *   }
 *
 * Run with `pnpm run bench:memory -- --help`.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const { LioraMemoryStore } = await import('../packages/agent-core/src/memory/store.ts');

const DEFAULT_LIMIT = 5;

const args = parseArgs(process.argv.slice(2));
if (args.help || args.input === undefined) {
  printHelp();
  process.exitCode = args.help ? 0 : 2;
} else {
  const root = args.home ?? mkdtempSync(join(tmpdir(), 'liora-memory-bench-'));
  try {
    const source = readDataset(args.input);
    const normalized = normalizeDataset(source, args.format);
    const result = await runBenchmark(normalized, root, args.limit);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (args.home === undefined) rmSync(root, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const result = { format: 'auto', limit: DEFAULT_LIMIT, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--') {
      continue;
    } else if (value === '--help' || value === '-h') {
      result.help = true;
    } else if (value === '--format') {
      result.format = argv[++index] ?? 'auto';
    } else if (value === '--limit') {
      result.limit = positiveInteger(argv[++index], DEFAULT_LIMIT);
    } else if (value === '--home') {
      result.home = argv[++index];
    } else if (value?.startsWith('-')) {
      throw new Error(`Unknown option: ${value}`);
    } else if (result.input === undefined) {
      result.input = value;
    }
  }
  return result;
}

function printHelp() {
  process.stdout.write(`Usage: pnpm run bench:memory -- <dataset.json|dataset.jsonl> [options]

Formats:
  auto          Detect canonical, LoCoMo, or LongMemEval-like input (default)
  canonical     { records: [...], cases: [...] }
  locomo       Conversation turns + qa/questions
  longmemeval  Haystack/context turns + question/query

Options:
  --format <name>  Select an adapter explicitly
  --limit <n>      Recall limit per case (default: ${String(DEFAULT_LIMIT)})
  --home <dir>     Keep the temporary Liora Memory store at this path
  --help           Show this help

No benchmark dataset is downloaded or stored by this command.
`);
}

function readDataset(input) {
  const raw = readFileSync(input, 'utf8').trim();
  if (raw.length === 0) throw new Error(`Benchmark input is empty: ${input}`);
  if (input.endsWith('.jsonl')) {
    return raw
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => parseJson(line, `${input}:${String(index + 1)}`));
  }
  return parseJson(raw, input);
}

function parseJson(raw, source) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function normalizeDataset(source, requestedFormat) {
  const format = requestedFormat === 'auto' ? detectFormat(source) : requestedFormat;
  if (format === 'canonical') return normalizeCanonical(source);
  if (format === 'locomo') return normalizeConversationDataset(source, 'locomo');
  if (format === 'longmemeval') return normalizeConversationDataset(source, 'longmemeval');
  throw new Error(`Unsupported benchmark format: ${format}`);
}

function detectFormat(source) {
  const sample = Array.isArray(source) ? source[0] : source;
  if (isObject(source) && Array.isArray(source.records) && Array.isArray(source.cases)) return 'canonical';
  if (isObject(sample) && (Array.isArray(sample.qa) || Array.isArray(sample.questions))) return 'locomo';
  if (isObject(sample) && (Array.isArray(sample.haystack) || Array.isArray(sample.context))) return 'longmemeval';
  throw new Error('Could not detect format; pass --format canonical|locomo|longmemeval.');
}

function normalizeCanonical(source) {
  const records = source.records.map((record, index) => normalizeRecord(record, `record-${String(index)}`));
  const cases = source.cases.map((item, index) => normalizeCase(item, `case-${String(index)}`));
  return { adapter: 'canonical', records, cases };
}

function normalizeConversationDataset(source, adapter) {
  const samples = Array.isArray(source) ? source : [source];
  const records = [];
  const cases = [];
  for (const [sampleIndex, sample] of samples.entries()) {
    const sampleId = stringValue(sample.sample_id ?? sample.id) ?? String(sampleIndex);
    const turns = adapter === 'locomo' ? conversationTurns(sample) : haystackTurns(sample);
    for (const [turnIndex, turn] of turns.entries()) {
      const content = textValue(turn);
      if (content === undefined) continue;
      const evidenceId =
        stringValue(turn.dia_id ?? turn.id ?? turn.message_id ?? turn.session_id) ??
        `${adapter}:${sampleId}:turn:${String(turnIndex)}`;
      records.push({
        type: 'event',
        subject: `${adapter} ${sampleId} ${evidenceId}`,
        content,
        source: { kind: 'import', messageId: evidenceId },
        evidenceRefs: [{ kind: 'message', id: evidenceId }],
      });
    }
    const questions = adapter === 'locomo' ? sample.qa ?? sample.questions : [sample];
    for (const [caseIndex, item] of questions.entries()) {
      if (!isObject(item)) continue;
      const query = stringValue(item.question ?? item.query);
      if (query === undefined) continue;
      const evidenceIds = [
        ...(stringArray(item.evidence) ?? []),
        ...(stringArray(item.evidence_ids) ?? []),
        ...(stringArray(item.answer_session_ids) ?? []),
      ];
      cases.push({
        id: `${adapter}:${sampleId}:case:${String(caseIndex)}`,
        query,
        expectedEvidenceIds: evidenceIds,
        expectedText: stringValue(item.answer),
        asOf: numberValue(item.as_of),
      });
    }
  }
  return { adapter, records, cases };
}

function conversationTurns(sample) {
  if (Array.isArray(sample.conversation)) return sample.conversation;
  if (Array.isArray(sample.dialogue)) return sample.dialogue;
  if (isObject(sample.conversation)) {
    return Object.values(sample.conversation).flatMap((value) => (Array.isArray(value) ? value : []));
  }
  return [];
}

function haystackTurns(sample) {
  const value = sample.haystack ?? sample.context ?? sample.memories;
  return Array.isArray(value) ? value : [];
}

function normalizeRecord(record, fallbackId) {
  if (!isObject(record)) throw new Error(`Invalid ${fallbackId}: expected an object.`);
  const content = textValue(record);
  if (content === undefined) throw new Error(`Invalid ${fallbackId}: missing content/text.`);
  const evidenceRefs = Array.isArray(record.evidence_refs)
    ? record.evidence_refs.filter(isObject).map((ref) => ({
        kind: ref.kind ?? 'message',
        id: String(ref.id ?? fallbackId),
        ...(ref.excerpt === undefined ? {} : { excerpt: String(ref.excerpt) }),
      }))
    : [{ kind: 'message', id: fallbackId }];
  return {
    type: record.type ?? 'event',
    subject: String(record.subject ?? fallbackId),
    content,
    source: { kind: 'import', messageId: fallbackId },
    evidenceRefs,
    ...(numberValue(record.valid_from) === undefined
      ? {}
      : { validFrom: numberValue(record.valid_from) }),
    ...(numberValue(record.valid_to) === undefined ? {} : { validTo: numberValue(record.valid_to) }),
  };
}

function normalizeCase(item, fallbackId) {
  if (!isObject(item)) throw new Error(`Invalid ${fallbackId}: expected an object.`);
  const query = stringValue(item.query ?? item.question);
  if (query === undefined) throw new Error(`Invalid ${fallbackId}: missing query/question.`);
  return {
    id: String(item.id ?? fallbackId),
    query,
    expectedEvidenceIds: [
      ...(stringArray(item.expected_evidence_ids) ?? []),
      ...(stringArray(item.evidence_ids) ?? []),
    ],
    expectedText: stringValue(item.expected_text ?? item.answer),
    asOf: numberValue(item.as_of),
  };
}

async function runBenchmark(dataset, homeDir, limit) {
  const store = new LioraMemoryStore({ homeDir });
  const saved = [];
  for (const record of dataset.records) {
    saved.push(await store.remember(record));
  }

  const measurements = [];
  for (const item of dataset.cases) {
    const started = performance.now();
    const results = await store.recall({
      query: item.query,
      limit,
      ...(item.asOf === undefined ? {} : { asOf: item.asOf }),
    });
    const latencyMs = performance.now() - started;
    const hit = results.some((result) => matchesCase(result.memory, item));
    const stale = item.asOf === undefined ? false : results.some((result) => result.memory.recordedAt > item.asOf);
    const retrievedTokens = results.reduce(
      (total, result) => total + Math.ceil((result.memory.subject.length + result.memory.content.length) / 4),
      0,
    );
    measurements.push({
      id: item.id,
      hit,
      abstained: results.every((result) => result.abstained === true),
      falseRecall: item.expectedEvidenceIds.length === 0 && item.expectedText === undefined && results.length > 0,
      staleRecall: stale,
      latencyMs,
      retrievedTokens,
      resultCount: results.length,
    });
  }

  const total = measurements.length;
  return {
    adapter: dataset.adapter,
    records: saved.length,
    cases: total,
    metrics: {
      hitRateAtK: ratio(measurements.filter((item) => item.hit).length, total),
      abstentionRate: ratio(measurements.filter((item) => item.abstained).length, total),
      falseRecallRate: ratio(measurements.filter((item) => item.falseRecall).length, total),
      staleRecallRate: ratio(measurements.filter((item) => item.staleRecall).length, total),
      averageLatencyMs: average(measurements.map((item) => item.latencyMs)),
      averageRetrievedTokens: average(measurements.map((item) => item.retrievedTokens)),
    },
  };
}

function matchesCase(memory, item) {
  if (item.expectedEvidenceIds.some((id) => memory.evidenceRefs.some((ref) => ref.id === id))) return true;
  const expected = item.expectedText?.trim().toLowerCase();
  return expected !== undefined && expected.length > 0 && memory.content.toLowerCase().includes(expected);
}

function ratio(value, total) {
  return total === 0 ? 0 : value / total;
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function textValue(value) {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!isObject(value)) return undefined;
  const text = value.text ?? value.content ?? value.message;
  return typeof text === 'string' && text.trim().length > 0 ? text.trim() : undefined;
}

function stringValue(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : undefined;
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
