#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BLACKLIST = [
  'delve',
  'leverage',
  'utilize',
  'pivotal',
  'robust',
  'streamline',
  'cutting-edge',
  'landscape',
  'testament',
  'foster',
  'underscore',
  'realm',
  'meticulous',
  'comprehensive',
  'embark',
  'seamless',
  'bespoke',
  'game-changer',
  'revolutionary',
  'dynamic',
  'holistic',
  'actionable',
  'impactful',
  'navigate',
  'elevate',
  'harness',
  'at its core',
  'in order to',
  "in today's",
  'it is worth noting',
  'in conclusion',
  'to sum up'
];

const regexes = BLACKLIST.map(word => {
  const pattern = word.includes("'") || word.includes("-") || word.includes(" ")
    ? `\\b${word.replaceAll(/[-']/g, '\\$&')}\\b`
    : `\\b${word}\\b`;
  return {
    word,
    regex: new RegExp(pattern, 'i')
  };
});

function gitOut(args) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

/**
 * Parse `git diff -U0` and return added lines keyed by path.
 * Unchanged prose in a touched file is ignored — PREMIUM.md already
 * uses "navigate" in hint copy and "harness" inside `@harness-kit/…`.
 */
export function addedLinesFromUnifiedDiff(diff) {
  /** @type {Map<string, Array<{ line: string, lineNum: number }>>} */
  const files = new Map();
  let currentFile = null;
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const target = raw.slice(4);
      currentFile = target === '/dev/null' ? null : target.replace(/^b\//, '');
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (currentFile === null) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      if (!files.has(currentFile)) files.set(currentFile, []);
      files.get(currentFile).push({ line: raw.slice(1), lineNum: newLine });
      newLine += 1;
      continue;
    }
    if (raw.startsWith(' ')) {
      newLine += 1;
    }
  }
  return files;
}

/** Identifiers in `backticks` are not changelog prose. */
export function stripInlineCode(line) {
  return line.replaceAll(/`[^`]*`/g, '');
}

export function slopHits(line) {
  const prose = stripInlineCode(line);
  /** @type {string[]} */
  const hits = [];
  for (const { word, regex } of regexes) {
    if (regex.test(prose)) hits.push(word);
  }
  return hits;
}

function changesetFrontmatterLineNums(content) {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return new Set();
  const end = lines.indexOf('---', 1);
  if (end < 0) return new Set();
  return new Set(Array.from({ length: end + 1 }, (_, i) => i + 1));
}

function collectAddedByFile() {
  const diffs = [
    gitOut('diff --cached -U0 -- "*.md"'),
    gitOut('diff -U0 origin/main...HEAD -- "*.md"'),
    gitOut('diff -U0 main...HEAD -- "*.md"'),
  ];
  /** @type {Map<string, Map<number, string>>} */
  const files = new Map();
  for (const diff of diffs) {
    for (const [file, lines] of addedLinesFromUnifiedDiff(diff)) {
      if (!file.endsWith('.md')) continue;
      if (file === '.changeset/README.md') continue;
      if (!files.has(file)) files.set(file, new Map());
      const dest = files.get(file);
      for (const { lineNum, line } of lines) dest.set(lineNum, line);
    }
  }
  return files;
}

function checkAddedLines(filePath, added) {
  const posixPath = filePath.replaceAll('\\', '/');
  const isChangeset = posixPath.includes('/.changeset/') || posixPath.includes('.changeset/');
  const skip = isChangeset && fs.existsSync(filePath)
    ? changesetFrontmatterLineNums(fs.readFileSync(filePath, 'utf8'))
    : new Set();
  const violations = [];
  for (const [lineNum, line] of added) {
    if (skip.has(lineNum)) continue;
    for (const word of slopHits(line)) {
      violations.push({ lineNum, word, snippet: line.trim() });
    }
  }
  return violations;
}

function main() {
  const files = collectAddedByFile();
  if (files.size === 0) {
    console.log('No markdown or changeset additions to check for AI slop.');
    process.exit(0);
  }

  let totalViolations = 0;

  for (const [file, added] of files) {
    const violations = checkAddedLines(file, added);
    if (violations.length === 0) continue;
    console.error(`\u001B[31m[AI Slop Detected] ${file}\u001B[0m`);
    for (const { lineNum, word, snippet } of violations) {
      console.error(`  Line ${lineNum}: Found "${word}" -> "${snippet}"`);
    }
    totalViolations += violations.length;
  }

  if (totalViolations > 0) {
    console.error(`\n\u001B[31mError: ${totalViolations} AI slop violations found. Please rewrite using natural, human-like language.\u001B[0m`);
    process.exit(1);
  }
  console.log('\u001B[32mAll checked files are free of AI slop!\u001B[0m');
  process.exit(0);
}

const isDirectRun = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === import.meta.filename;
if (isDirectRun) main();
