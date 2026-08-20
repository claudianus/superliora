#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

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

// Compile regexes for each blacklist word with word boundaries
const regexes = BLACKLIST.map(word => {
  const pattern = word.includes("'") || word.includes("-") || word.includes(" ")
    ? `\\b${word.replaceAll(/[-']/g, '\\$&')}\\b`
    : `\\b${word}\\b`;
  return {
    word,
    regex: new RegExp(pattern, 'i')
  };
});

function gitNameOnly(args) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function getFilesToCheck() {
  const files = [];

  // Staged markdown, plus markdown changed vs origin/main (or main).
  // Do not scan the whole pending changeset inventory — that is historical
  // release notes, not this PR's prose.
  const names = new Set([
    ...gitNameOnly('diff --name-only --cached'),
    ...gitNameOnly('diff --name-only origin/main...HEAD'),
    ...gitNameOnly('diff --name-only main...HEAD'),
  ]);

  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    if (name === '.changeset/README.md') continue;
    if (fs.existsSync(name)) files.push(path.resolve(name));
  }

  return Array.from(new Set(files));
}

function proseLines(filePath, content) {
  const lines = content.split('\n');
  const posixPath = filePath.replaceAll('\\', '/');
  const isChangeset = posixPath.includes('/.changeset/') || posixPath.includes('.changeset/');
  if (!isChangeset) {
    return lines.map((line, index) => ({ line, lineNum: index + 1 }));
  }
  // Changeset frontmatter lists package names (`@harness-kit/tui-renderer`).
  // Those are identifiers, not prose.
  if (lines[0]?.trim() !== '---') {
    return lines.map((line, index) => ({ line, lineNum: index + 1 }));
  }
  const end = lines.indexOf('---', 1);
  if (end < 0) return lines.map((line, index) => ({ line, lineNum: index + 1 }));
  return lines.slice(end + 1).map((line, index) => ({ line, lineNum: end + index + 2 }));
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];

  for (const { line, lineNum } of proseLines(filePath, content)) {
    regexes.forEach(({ word, regex }) => {
      const match = line.match(regex);
      if (match) {
        violations.push({
          lineNum,
          word,
          snippet: line.trim()
        });
      }
    });
  }

  return violations;
}

function main() {
  const files = getFilesToCheck();
  if (files.length === 0) {
    console.log('No markdown or changeset files to check for AI slop.');
    process.exit(0);
  }

  let totalViolations = 0;

  files.forEach(file => {
    const relativePath = path.relative(process.cwd(), file);
    const violations = checkFile(file);
    if (violations.length > 0) {
      console.error(`\x1B[31m[AI Slop Detected] ${relativePath}\x1B[0m`);
      violations.forEach(({ lineNum, word, snippet }) => {
        console.error(`  Line ${lineNum}: Found "${word}" -> "${snippet}"`);
      });
      totalViolations += violations.length;
    }
  });

  if (totalViolations > 0) {
    console.error(`\n\x1B[31mError: ${totalViolations} AI slop violations found. Please rewrite using natural, human-like language.\x1B[0m`);
    process.exit(1);
  } else {
    console.log('\x1B[32mAll checked files are free of AI slop!\x1B[0m');
    process.exit(0);
  }
}

main();
