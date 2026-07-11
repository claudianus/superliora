#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THEMES_PATH = resolve(__dirname, '..', 'src', 'tui', 'theme', 'bundled-themes.ts');

// --- sRGB utilities ---
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const linearize = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// --- Read and parse ---
const source = readFileSync(THEMES_PATH, 'utf-8');

// Find all bundled theme blocks: from "name: 'superliora-" to the closing "  },"
const themeBlocks = [];
const nameRegex = /name: 'superliora-[^']*'/g;
let match;
while ((match = nameRegex.exec(source)) !== null) {
  themeBlocks.push(match[0]);
}

if (themeBlocks.length !== 7) {
  console.error(`ERROR: expected 7 bundled themes, found ${themeBlocks.length}`);
  process.exit(1);
}
console.log(`Found ${themeBlocks.length} bundled theme entries.`);

// Extract full theme objects by finding the surrounding braces
const themes = [];
const themeNamePattern = /name: '(superliora-[^']*)'/g;
let themeMatch;
while ((themeMatch = themeNamePattern.exec(source)) !== null) {
  const name = themeMatch[1];
  // Find the enclosing object: search backward for "name:" line, forward for "  },"
  const namePos = themeMatch.index;
  // Find the "colors:" opening
  const colorsIdx = source.indexOf('colors:', namePos);
  if (colorsIdx === -1) continue;
  // Find the closing of the theme object (two consecutive "  }" lines, then "  },")
  // We need to find the matching brace after "colors: {"
  let depth = 0;
  let pos = colorsIdx;
  let inObj = false;
  for (let i = colorsIdx; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
      if (!inObj) inObj = true;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        pos = i;
        break;
      }
    }
  }
  // Extract the colors block
  const colorsBlock = source.slice(colorsIdx, pos + 1);

  // Extract all color tokens
  const colors = {};
  const tokenRegex = /(\w+):\s*'(#[0-9A-Fa-f]{6})'/g;
  let tokenMatch;
  while ((tokenMatch = tokenRegex.exec(colorsBlock)) !== null) {
    colors[tokenMatch[1]] = tokenMatch[2].toUpperCase();
  }

  if (Object.keys(colors).length === 40) {
    themes.push({ name, colors });
  }
}

if (themes.length !== 7) {
  console.error(`ERROR: extracted ${themes.length} themes (expected 7)`);
  process.exit(1);
}
console.log(`Extracted ${themes.length} themes with full color tokens.`);

// --- Contrast verification ---
const checks = [];
let allPass = true;

for (const theme of themes) {
  const c = theme.colors;
  const pairs = [
    { label: 'primary/background', fg: c.primary, bg: c.background },
    { label: 'text/background', fg: c.text, bg: c.background },
    { label: 'textDim/background', fg: c.textDim, bg: c.background },
  ];

  for (const { label, fg, bg } of pairs) {
    const ratio = contrastRatio(fg, bg);
    const pass = ratio >= 4.5;
    if (!pass) allPass = false;
    checks.push({
      Theme: theme.name,
      Pair: label,
      Foreground: fg,
      Background: bg,
      Ratio: ratio.toFixed(2),
      Status: pass ? 'PASS' : 'FAIL',
    });
  }
}

// --- Output ---
console.table(checks);

if (allPass) {
  console.log('\nAll 36 contrast checks passed (≥ 4.5:1).');
  process.exit(0);
} else {
  const failed = checks.filter((c) => c.Status === 'FAIL');
  console.error(`\n${failed.length} contrast check(s) FAILED:`);
  for (const f of failed) {
    console.error(`  ${f.Theme} ${f.Pair}: ${f.Foreground} vs ${f.Background} = ${f.Ratio}:1`);
  }
  process.exit(1);
}
