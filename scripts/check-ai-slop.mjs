#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

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
    ? `\\b${word.replace(/[-']/g, '\\$&')}\\b`
    : `\\b${word}\\b`;
  return {
    word,
    regex: new RegExp(pattern, 'i')
  };
});

function getFilesToCheck() {
  const files = [];

  // 1. Scan .changeset/*.md (except README.md)
  const changesetDir = path.resolve('.changeset');
  if (fs.existsSync(changesetDir)) {
    const changesetFiles = fs.readdirSync(changesetDir)
      .filter(f => f.endsWith('.md') && f !== 'README.md')
      .map(f => path.join(changesetDir, f));
    files.push(...changesetFiles);
  }

  // 2. Scan modified/staged markdown files in git
  try {
    const gitDiff = execSync('git diff --name-only --cached', { encoding: 'utf8' });
    const stagedMd = gitDiff.split('\n')
      .map(f => f.trim())
      .filter(f => f.endsWith('.md') && fs.existsSync(f));
    files.push(...stagedMd);
  } catch (err) {
    // Git command might fail if not inside a git repo or no staged changes
  }

  // Remove duplicates
  return Array.from(new Set(files));
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, index) => {
    regexes.forEach(({ word, regex }) => {
      const match = line.match(regex);
      if (match) {
        violations.push({
          lineNum: index + 1,
          word,
          snippet: line.trim()
        });
      }
    });
  });

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
      console.error(`\x1b[31m[AI Slop Detected] ${relativePath}\x1b[0m`);
      violations.forEach(({ lineNum, word, snippet }) => {
        console.error(`  Line ${lineNum}: Found "${word}" -> "${snippet}"`);
      });
      totalViolations += violations.length;
    }
  });

  if (totalViolations > 0) {
    console.error(`\n\x1b[31mError: ${totalViolations} AI slop violations found. Please rewrite using natural, human-like language.\x1b[0m`);
    process.exit(1);
  } else {
    console.log('\x1b[32mAll checked files are free of AI slop!\x1b[0m');
    process.exit(0);
  }
}

main();
