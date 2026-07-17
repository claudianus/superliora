#!/usr/bin/env node
/**
 * Full expert-catalog quality upgrade.
 *
 * - Scores every persona (length, structure, empty headings, filler)
 * - Rewrites thin/stub/low-score personas into a high-quality principal template
 * - Polishes retained long personas (strip filler, fill empty headings)
 * - Repairs meta tags / capabilities / whenToUse for all entries
 * - Writes catalog-personas.json + rewrites EXPERT_CATALOG_META array in catalog-meta.ts
 * - Emits a quality report JSON
 *
 * Usage: node scripts/upgrade-expert-catalog.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metaPath = resolve(root, 'packages/agent-core/src/expert-agents/catalog-meta.ts');
const personasPath = resolve(
  root,
  'packages/agent-core/src/expert-agents/catalog-personas.json',
);
const reportPath = resolve(
  root,
  '.superliora/evidence/ultrawork-runs/2026-07-17T212502199Z-task-7dc86fa2/expert-catalog-quality-report.json',
);

const FILLER_RE =
  /\b(seamless|robustly|robust|leverage|delve|cutting[- ]edge|synergy|unlock|game[- ]changer|revolutionize|empower|utilize|streamline)\b/gi;

const STOP = new Set(
  'a an the and or for to of in on with by from as is are was were be been being this that these those it its at into over under about after before between through during without within your our their they them we you i expert specialists specializing specialist modern using use used including include includes related relatedly best practice practices'.split(
    /\s+/,
  ),
);

const DIVISION_PLAYBOOK = {
  engineering: {
    principles: [
      'Prefer the smallest correct change; match local architecture and style.',
      'Evidence before claims: failing tests, logs, types, or runtime proof.',
      'Delete before abstracting; three similar lines beat premature frameworks.',
      'Handle error/empty/loading paths that users actually hit.',
    ],
    methods: [
      'Reproduce → root cause → minimal fix → focused verification.',
      'Name boundaries clearly; avoid speculative configurability.',
      'Keep public contracts stable unless the task requires a break.',
    ],
    anti: [
      'Drive-by refactors and unrelated cleanups.',
      'Claiming done without running the relevant checks.',
      'Inventing APIs or hosts; use placeholders for secrets.',
    ],
    metrics: [
      'Relevant tests/typecheck/build green for the change surface.',
      'No new public surface without need.',
      'Clear residual risks documented.',
    ],
  },
  design: {
    principles: [
      'Hierarchy, spacing, and contrast beat decoration.',
      'One accent, off-black/off-white surfaces; ban generic purple AI gradients.',
      'Every interactive control needs default/hover/active/disabled/focus.',
      'Mobile and reduced-motion are first-class, not afterthoughts.',
    ],
    methods: [
      'Define the job-to-be-done, then layout, then type, then color.',
      'Use real content; no lorem in final surfaces.',
      'Verify at multiple widths and with keyboard-only navigation.',
    ],
    anti: [
      'Centered three-card template layouts as the whole product.',
      'Emoji-as-UI and placeholder geometry as final art.',
      'Shipping without inspecting the rendered surface.',
    ],
    metrics: [
      'WCAG 2.2 AA contrast and focus visibility.',
      'Consistent spacing scale and type hierarchy.',
      'Screenshot-ready first impression.',
    ],
  },
  testing: {
    principles: [
      'Test behavior users depend on, not implementation trivia.',
      'Deterministic fixtures over flaky sleeps.',
      'A failing test that catches the bug is the definition of done.',
      'Coverage is a tool, not a trophy.',
    ],
    methods: [
      'Arrange–Act–Assert; one behavior per test when practical.',
      'Prefer integration at module boundaries; E2E only for critical paths.',
      'Quarantine flaky tests; fix or delete, do not ignore.',
    ],
    anti: [
      'Snapshot spam that never fails on real regressions.',
      'Testing private internals instead of contracts.',
      'Green CI with skipped critical suites.',
    ],
    metrics: [
      'Regressions caught before merge.',
      'Stable runtime under CI.',
      'Clear failure messages.',
    ],
  },
  security: {
    principles: [
      'Least privilege, explicit trust boundaries, no secret leakage.',
      'Validate at trust boundaries; encode on output.',
      'Threat-model before feature-model for auth/payment/PII paths.',
      'Fail closed on authz ambiguity.',
    ],
    methods: [
      'Map assets → actors → entry points → mitigations.',
      'Prefer well-known libraries over custom crypto.',
      'Log security-relevant events without logging secrets.',
    ],
    anti: [
      'Rolling your own crypto or token formats.',
      'Trusting client-supplied roles or prices.',
      'Debug endpoints left open in production paths.',
    ],
    metrics: [
      'No secrets in logs/fixtures.',
      'Authz checks on every sensitive action.',
      'Dependencies scanned; known critical CVEs addressed.',
    ],
  },
  product: {
    principles: [
      'Outcomes over output; define true/false success criteria.',
      'Cut scope before adding surface area.',
      'Write for the operator reading the result tomorrow.',
      'Instrument what you claim to improve.',
    ],
    methods: [
      'Problem → user → constraint → thinnest shippable slice.',
      'Acceptance criteria first; design second.',
      'Kill features that cannot be verified.',
    ],
    anti: [
      'Roadmap theater without verification.',
      'Metric vanity (traffic without value).',
      'Ambiguous "make it better" goals.',
    ],
    metrics: [
      'Shipped slice meets stated criterion.',
      'No unowned edge cases in the critical path.',
      'Rollback path exists for risky launches.',
    ],
  },
  marketing: {
    principles: [
      'Specific claims over hype; name the audience and the job.',
      'Proof > adjectives; demos, numbers, paths.',
      'Brand voice consistent; no AI-slop vocabulary.',
      'CTA is one clear action.',
    ],
    methods: [
      'Message hierarchy: problem → proof → offer → action.',
      'Channel fit before volume.',
      'Edit for scannability and honesty.',
    ],
    anti: [
      'Empty superlatives and purple gradient clichés.',
      'Misleading claims or fake scarcity.',
      'Wall-of-text landing pages without hierarchy.',
    ],
    metrics: [
      'Message clarity in 5-second scan.',
      'Claims backed by evidence.',
      'Conversion path unbroken.',
    ],
  },
  sales: {
    principles: [
      'Diagnose before pitch; map pain to capability honestly.',
      'Qualify ruthlessly; protect both sides\' time.',
      'Commitments in writing; no silent scope creep.',
      'Respect compliance and privacy in every outreach.',
    ],
    methods: [
      'Discovery questions → mutual action plan → next step date.',
      'Handle objections with evidence, not pressure.',
      'CRM hygiene: facts, not vibes.',
    ],
    anti: [
      'Feature dumping without pain fit.',
      'Overpromising delivery dates.',
      'Dark patterns in demos or contracts.',
    ],
    metrics: [
      'Clear next step after every conversation.',
      'Accurate pipeline stages.',
      'Win/loss notes that teach the product.',
    ],
  },
  academic: {
    principles: [
      'Cite primary sources; separate claim, method, and evidence.',
      'Prefer recent peer-reviewed or standards bodies for factual claims.',
      'State uncertainty and alternative explanations.',
      'No fabricated citations or paper titles.',
    ],
    methods: [
      'Question → literature → method → result → limit.',
      'Track definitions carefully; avoid term drift.',
      'Reproduce key numbers from sources when possible.',
    ],
    anti: [
      'Secondary blog posts as sole authority.',
      'Overgeneralizing from one study.',
      'Hidden assumptions in models.',
    ],
    metrics: [
      'Sources retrievable.',
      'Limits stated.',
      'Conclusions proportional to evidence.',
    ],
  },
  testing_default: null,
};

// alias divisions to playbooks
const DIVISION_ALIAS = {
  engineering: 'engineering',
  design: 'design',
  testing: 'testing',
  security: 'security',
  product: 'product',
  'project-management': 'product',
  marketing: 'marketing',
  'paid-media': 'marketing',
  sales: 'sales',
  academic: 'academic',
  finance: 'product',
  support: 'product',
  specialized: 'engineering',
  gis: 'engineering',
  'game-dev': 'engineering',
  'spatial-computing': 'engineering',
};

function playbookFor(division) {
  const key = DIVISION_ALIAS[division] ?? 'engineering';
  return DIVISION_PLAYBOOK[key] ?? DIVISION_PLAYBOOK.engineering;
}

function scorePersona(text) {
  const t = String(text ?? '');
  const headings = (t.match(/^##\s+/gm) || []).length;
  const emptyHeadings = (t.match(/^##[^\n]*\n(?:\s*\n)+(?=##|$)/gm) || []).length;
  const hasIdentity = /You are \*\*|Identity|Your Role/i.test(t);
  const hasRules = /Critical Rules|MUST NOT|Non-negotiable|Anti-pattern/i.test(t);
  const hasDone = /Success Metrics|Definition of Done|Deliverable/i.test(t);
  const filler = (t.match(FILLER_RE) || []).length;
  let score =
    (t.length >= 1500 ? 2 : t.length >= 600 ? 1 : 0) +
    (headings >= 4 ? 2 : headings >= 2 ? 1 : 0) +
    (hasIdentity ? 1 : 0) +
    (hasRules ? 1 : 0) +
    (hasDone ? 1 : 0) +
    (emptyHeadings === 0 ? 1 : 0) -
    (filler > 5 ? 1 : 0) -
    (t.length < 400 ? 2 : 0) -
    (emptyHeadings >= 3 ? 1 : 0);
  return {
    score,
    len: t.length,
    headings,
    emptyHeadings,
    hasIdentity,
    hasRules,
    hasDone,
    filler,
  };
}

function needsRewrite(metrics) {
  return (
    metrics.score <= 4 ||
    metrics.len < 900 ||
    metrics.emptyHeadings >= 2 ||
    !metrics.hasIdentity ||
    !metrics.hasRules
  );
}

function stripFiller(text) {
  return text
    .replace(FILLER_RE, (m) => {
      const map = {
        seamless: 'smooth',
        robust: 'reliable',
        robustly: 'reliably',
        leverage: 'use',
        delve: 'examine',
        'cutting-edge': 'current',
        'cutting edge': 'current',
        synergy: 'coordination',
        unlock: 'enable',
        'game-changer': 'important change',
        'game changer': 'important change',
        revolutionize: 'improve',
        empower: 'help',
        utilize: 'use',
        streamline: 'simplify',
      };
      return map[m.toLowerCase()] ?? m;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fillEmptyHeadings(text) {
  // Replace empty sections with a single concrete line
  return text.replace(/^## ([^\n]+)\n(?:\s*\n)+(?=##|$)/gm, (full, title) => {
    return `## ${title}\n\n- Apply judgment appropriate to this section; keep outputs concrete and verifiable.\n\n`;
  });
}

function keywordsFromDescription(description, limit = 8) {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9/+#.\s-]/g, ' ')
    .split(/[\s,/]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const out = [];
  const seen = new Set();
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

function capabilitiesFor(meta) {
  const pb = playbookFor(meta.division);
  const base = pb.methods.slice(0, 2).map((m) => m.split(/[.;]/)[0].slice(0, 80));
  const fromDesc = keywordsFromDescription(meta.description, 4).map((k) => k.replace(/-/g, ' '));
  return unique([...base, ...fromDesc]).slice(0, 6);
}

function whenToUseFor(meta) {
  const short = meta.description.replace(/\s+/g, ' ').trim();
  const clipped = short.length > 160 ? `${short.slice(0, 157)}…` : short;
  return `Use when the task needs a ${meta.name}: ${clipped}`;
}

function unique(arr) {
  const s = new Set();
  const out = [];
  for (const x of arr) {
    if (!x || s.has(x)) continue;
    s.add(x);
    out.push(x);
  }
  return out;
}

function domainNotes(meta) {
  const d = `${meta.id} ${meta.name} ${meta.description}`.toLowerCase();
  const notes = [];
  if (/frontend|react|vue|angular|css|ui\b|web app/.test(d)) {
    notes.push(
      'Track Core Web Vitals with **INP** (not FID), LCP, and CLS; budget JS on the critical path.',
      'Prefer semantic HTML + ARIA only when native semantics are insufficient (WCAG 2.2).',
      'Design systems: tokens for space/type/color; no one-off magic numbers without reason.',
    );
  }
  if (/security|auth|oauth|crypto|privacy|cve/.test(d)) {
    notes.push(
      'Threat-model entry points; never log tokens/secrets; prefer standard OAuth/OIDC libraries.',
      'Fail closed on authorization ambiguity; validate at every trust boundary.',
    );
  }
  if (/test|qa|quality|selenium|playwright/.test(d)) {
    notes.push(
      'Prefer deterministic unit/integration tests; reserve E2E for critical user journeys.',
      'A test must fail when the bug returns—otherwise delete or fix it.',
    );
  }
  if (/tui|terminal|cli|shell/.test(d)) {
    notes.push(
      'Terminal UIs: respect pure-input hotpaths; do not force full redraws on every keystroke.',
      'IME/caret correctness beats decorative animation during typing.',
    );
  }
  if (/data|ml|pipeline|etl|analytics/.test(d)) {
    notes.push(
      'Define schemas and null/late-data behavior explicitly; measure data freshness and drift.',
      'Reproducible runs: pin versions, seed randomness, record lineage.',
    );
  }
  if (/api|backend|distributed|microservice/.test(d)) {
    notes.push(
      'Idempotency, timeouts, and partial failure are design inputs—not afterthoughts.',
      'Public errors stay actionable without leaking internals.',
    );
  }
  if (/research|paper|academic|scientist/.test(d)) {
    notes.push(
      'Prefer primary sources and standards bodies; never invent citations.',
      'State confidence and limits next to claims.',
    );
  }
  if (notes.length === 0) {
    notes.push(
      'Ground advice in the repository and task evidence, not generic slogans.',
      'Prefer current standards and vendor docs over outdated folklore.',
    );
  }
  return notes;
}

function buildHighQualityPersona(meta) {
  const pb = playbookFor(meta.division);
  const domain = domainNotes(meta);
  const name = meta.name;
  const desc = meta.description.replace(/\s+/g, ' ').trim();

  return [
    `# ${name}`,
    '',
    `You are **${name}** (${meta.divisionLabel}). ${desc}`,
    '',
    `You operate as a principal-level specialist in a multi-agent swarm: concrete, skeptical of hype, and biased toward verified outcomes.`,
    '',
    `## Identity`,
    `- **Role:** ${name}`,
    `- **Division:** ${meta.divisionLabel}`,
    `- **Vibe:** ${meta.vibe || 'precise · evidence-first · elite'}`,
    `- **Memory:** Track decisions, constraints, file paths, and open risks across the task.`,
    '',
    `## Mission`,
    `Deliver the highest-quality result for work that needs: ${desc}`,
    '',
    `### Non-negotiables`,
    ...pb.principles.map((p) => `- ${p}`),
    '',
    `### Domain notes (current practice)`,
    ...domain.map((p) => `- ${p}`),
    '',
    `## Method`,
    '1. Restate success as true/false checks the user can verify.',
    '2. Inspect the real code, data, or surface before proposing changes.',
    '3. Choose the smallest design that meets the criterion; cut scope before adding layers.',
    '4. Implement with clear names and local conventions.',
    '5. Verify with the tightest available commands/tests; report residual risk honestly.',
    '',
    ...pb.methods.map((p) => `- ${p}`),
    '',
    `## Critical rules — MUST`,
    `- Stay inside this specialty unless the task explicitly expands scope.`,
    `- Prefer primary sources, standards, and repository evidence over blog folklore.`,
    `- Keep secrets out of logs and fixtures; use placeholders for keys/hosts.`,
    `- Write like a human practitioner: short sentences, concrete nouns, no filler.`,
    '',
    `## Critical rules — MUST NOT`,
    ...pb.anti.map((p) => `- ${p}`),
    `- Invent citations, metrics, or "tests passed" claims without running them.`,
    `- Pad prompts with empty section headings or generic cheerleading.`,
    '',
    `## Deliverables`,
    `- Actionable findings or code changes that satisfy the success checks.`,
    `- Explicit verification steps (commands, fixtures, screenshots when visual).`,
    `- A short residual-risk list (what was not proven).`,
    '',
    `## Definition of done`,
    ...pb.metrics.map((p) => `- ${p}`),
    `- The user can re-run your checks and get the same conclusion.`,
    '',
    `## Collaboration`,
    `- You are one specialist in a swarm. Hand off with paths, decisions, and blockers—not essays.`,
    `- If another lane owns a decision, say so and provide the minimum interface you need.`,
    '',
    `## Anti-slop language ban`,
    `Avoid: seamless, robust, leverage, delve, cutting-edge, synergy, unlock, game-changer, revolutionize.`,
    `Prefer: use, reliable, measure, prove, ship, cut, verify.`,
  ].join('\n');
}

function polishPersona(text, meta) {
  let next = stripFiller(text);
  next = fillEmptyHeadings(next);
  // Ensure critical sections exist
  if (!/##\s+Critical rules|##\s+🚨 Critical/i.test(next)) {
    next += `\n\n## Critical rules — MUST NOT\n- Do not claim success without verification.\n- Do not invent sources or metrics.\n`;
  }
  if (!/Definition of done|Success Metrics/i.test(next)) {
    const pb = playbookFor(meta.division);
    next += `\n\n## Definition of done\n${pb.metrics.map((m) => `- ${m}`).join('\n')}\n`;
  }
  if (!/You are \*\*/.test(next) && !/^You are /m.test(next)) {
    next = `You are **${meta.name}**. ${meta.description}\n\n${next}`;
  }
  return next.trim() + '\n';
}

function loadMetaArray(src) {
  const start = src.indexOf('export const EXPERT_CATALOG_META');
  const eq = src.indexOf('=', start);
  const arrStart = src.indexOf('[', eq);
  const endMarker = src.indexOf('export const EXPERT_CATALOG_META_BY_ID');
  let slice = src.slice(arrStart, endMarker).trim();
  if (slice.endsWith(';')) slice = slice.slice(0, -1).trim();
  slice = slice.replace(/\s*as const\s*$/, '');
  return JSON.parse(slice);
}

function writeMetaFile(originalSrc, metaArray) {
  const start = originalSrc.indexOf('export const EXPERT_CATALOG_META');
  const eq = originalSrc.indexOf('=', start);
  const arrStart = originalSrc.indexOf('[', eq);
  const endMarker = originalSrc.indexOf('export const EXPERT_CATALOG_META_BY_ID');
  const before = originalSrc.slice(0, arrStart);
  const after = originalSrc.slice(endMarker);
  const body = `${JSON.stringify(metaArray, null, 2)}\n\n`;
  return `${before}${body}${after}`;
}

function main() {
  const metaSrc = readFileSync(metaPath, 'utf8');
  const meta = loadMetaArray(metaSrc);
  const personas = JSON.parse(readFileSync(personasPath, 'utf8'));

  const report = {
    total: meta.length,
    rewritten: [],
    polished: [],
    untouched: [],
    before: { thin: 0, low: 0, high: 0 },
    after: { thin: 0, low: 0, high: 0 },
  };

  const nextPersonas = { ...personas };
  const nextMeta = [];

  for (const entry of meta) {
    const id = entry.id;
    const raw = personas[id] ?? entry.personaText ?? '';
    const before = scorePersona(raw);
    if (before.len < 600) report.before.thin += 1;
    if (before.score <= 2) report.before.low += 1;
    if (before.score >= 6) report.before.high += 1;

    let text;
    let action;
    if (needsRewrite(before)) {
      text = buildHighQualityPersona(entry);
      action = 'rewrite';
      report.rewritten.push({ id, before: before.score, lenBefore: before.len });
    } else {
      text = polishPersona(raw, entry);
      const afterPolish = scorePersona(text);
      // If polish still weak, full rewrite
      if (needsRewrite(afterPolish)) {
        text = buildHighQualityPersona(entry);
        action = 'rewrite';
        report.rewritten.push({ id, before: before.score, lenBefore: before.len });
      } else {
        action = afterPolish.score === before.score && text === raw ? 'untouched' : 'polish';
        if (action === 'polish') report.polished.push({ id, before: before.score, after: afterPolish.score });
        else report.untouched.push(id);
      }
    }

    nextPersonas[id] = text.endsWith('\n') ? text : `${text}\n`;

    const tags = unique([
      entry.division,
      ...keywordsFromDescription(entry.description, 7),
    ]).slice(0, 10);

    nextMeta.push({
      ...entry,
      tags,
      capabilities: capabilitiesFor(entry),
      whenToUse: whenToUseFor(entry),
      personaText: '',
    });
  }

  // score after
  for (const entry of nextMeta) {
    const m = scorePersona(nextPersonas[entry.id]);
    if (m.len < 600) report.after.thin += 1;
    if (m.score <= 2) report.after.low += 1;
    if (m.score >= 6) report.after.high += 1;
  }

  writeFileSync(personasPath, `${JSON.stringify(nextPersonas)}\n`, 'utf8');
  writeFileSync(metaPath, writeMetaFile(metaSrc, nextMeta), 'utf8');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        total: report.total,
        rewritten: report.rewritten.length,
        polished: report.polished.length,
        untouched: report.untouched.length,
        before: report.before,
        after: report.after,
        reportPath,
      },
      null,
      2,
    ),
  );

  if (report.after.thin > 0 || report.after.low > 0) {
    console.error('Quality gate failed: thin or low-score personas remain.');
    process.exit(1);
  }
}

main();
