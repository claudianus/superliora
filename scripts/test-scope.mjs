/**
 * Change-scoped test selection over a static import graph.
 *
 * The monorepo's tests mostly import package barrels (`@superliora/oauth`,
 * `../src/index`, …), so a plain module-level reverse graph degenerates to
 * "everything imports everything": any change to any module re-exported by a
 * barrel marks every barrel importer as affected. This module adds the missing
 * name level:
 *
 *   1. For a changed source file F, compute the public names that F can
 *      influence: every exported name of any module in F's importer closure
 *      (deep `import` edges only — pure `export … from` re-export chains are
 *      attributed recursively instead).
 *   2. A test file is affected when it deep-imports F's cluster, or when one
 *      of the names it imports is influenced by F. Unresolvable names
 *      (cycles, unparsed syntax) fall back to "affected".
 *   3. A dependent workspace whose *source* uses an influenced name pulls its
 *      whole test suite (we do not model dependent-internal graphs), which the
 *      selector then recurses on — oauth → agent-core → liora chains resolve
 *      through the same rule.
 *
 * Everything is pure over an injected `tree` (Map<repoPath, content>) so the
 * self-check can feed fixtures without touching the filesystem. All fallbacks
 * fail open: anything the graph cannot answer widens the scope, never shrinks
 * it.
 */

import { posix } from 'node:path';

const SOURCE_RE = /\.(ts|tsx|mts)$/;
const TEST_RE = /\.(test|spec)\.(ts|tsx|mts)$/;

/** Parse one `import`/`export … from` statement's specifier list. */
function parseNames(raw) {
  const names = new Set();
  let star = false;
  let hasDefault = false;
  const inner = raw.trim();
  if (inner === '') return { names, star, hasDefault };
  const rest = inner.replace(/^\*\s+as\s+[\w$]+/, () => {
    star = true;
    return '';
  });
  if (rest.trim().startsWith('*') === true) {
    star = true;
  }
  const braceMatch = rest.match(/\{([^}]*)\}/);
  if (braceMatch !== null && braceMatch !== undefined) {
    for (const part of braceMatch[1].split(',')) {
      const piece = part.trim();
      if (piece.length === 0) continue;
      const asMatch = /^(?:type\s+)?[\w$]+\s+as\s+([\w$]+)$/.exec(piece);
      const name = asMatch !== null ? asMatch[1] : piece.replace(/^type\s+/, '');
      if (name.length > 0 && name !== 'type') names.add(name);
    }
  } else if (star !== true) {
    const defaultMatch = /^type\s+|^\s*([\w$]+)/.exec(rest);
    const name = defaultMatch?.[1];
    if (name !== undefined && name.length > 0) hasDefault = true;
  }
  return { names, star, hasDefault };
}

/**
 * All module references in a file: `{ spec, kind, names, star }` where kind is
 * `import` (runtime/type import), `reexport` (`export … from`), or `dynamic`.
 * Names for reexports carry `{ internal, public }` pairs.
 */
export function parseModuleRefs(content) {
  const refs = [];
  const statementRe =
    /(?:^|[;\n\s])(import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(statementRe)) {
    const keyword = match[1];
    const namesRaw = (match[3] ?? '').trim();
    const spec = match[4];
    if (keyword === 'export') {
      if (namesRaw === '*' || namesRaw.startsWith('* as')) {
        refs.push({ spec, kind: 'reexport', star: true, pairs: [] });
        continue;
      }
      const brace = namesRaw.match(/\{([^}]*)\}/);
      if (brace === null || brace === undefined) continue;
      const pairs = [];
      for (const part of brace[1].split(',')) {
        const piece = part.trim();
        if (piece.length === 0) continue;
        const asMatch = /^(?:type\s+)?([\w$]+)\s+as\s+([\w$]+)$/.exec(piece);
        if (asMatch !== null) pairs.push({ internal: asMatch[1], public: asMatch[2] });
        else pairs.push({ internal: piece.replace(/^type\s+/, ''), public: piece.replace(/^type\s+/, '') });
      }
      refs.push({
        spec,
        kind: 'reexport',
        star: false,
        pairs,
        names: new Set(pairs.map((pair) => pair.public)),
        hasDefault: false,
      });
      continue;
    }
    const parsed = parseNames(namesRaw);
    refs.push({
      spec,
      kind: 'import',
      names: parsed.names,
      star: parsed.star,
      hasDefault: parsed.hasDefault,
    });
  }
  for (const match of content.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    refs.push({ spec: match[1], kind: 'dynamic', names: new Set(), star: true, hasDefault: false });
  }
  return refs;
}

/** Names a module declares or re-exports, plus its re-export statements. */
export function parseExports(content) {
  const own = new Set();
  for (const match of content.matchAll(
    /\bexport\s+(?:async\s+)?(?:const|let|var|function\s*\*?|class|enum|type|interface)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    own.add(match[1]);
  }
  for (const match of content.matchAll(/(?:^|[;\n\s])export\s+\{([^}]*)\}\s*;/g)) {
    for (const part of match[1].split(',')) {
      const piece = part.trim();
      if (piece.length === 0) continue;
      const asMatch = /^(?:type\s+)?[\w$]+\s+as\s+([\w$]+)$/.exec(piece);
      own.add(asMatch !== null ? asMatch[1] : piece.replace(/^type\s+/, ''));
    }
  }
  const refs = parseModuleRefs(content).filter((ref) => ref.kind === 'reexport');
  return { own, reexports: refs };
}

/**
 * Builds the workspace graph.
 *
 * `workspaces`: `{ dir, name, imports, entry }[]` — `imports` is the
 * package.json `imports` map (or `{}`), `entry` the resolved repo path of the
 * package's public entry (exports "."). Returns edges (import vs reexport),
 * per-file module refs, and lookup indexes.
 */
export function buildGraph(tree, workspaces) {
  const files = new Set();
  for (const path of tree.keys()) {
    if (!SOURCE_RE.test(path) || TEST_RE.test(path) === true) {
      if (TEST_RE.test(path)) files.add(path);
      continue;
    }
    files.add(path);
  }
  const pkgOf = new Map();
  const metaByDir = new Map();
  for (const ws of workspaces) metaByDir.set(ws.dir, ws);
  for (const path of files) {
    const dir = ownerDir(path, metaByDir);
    if (dir !== undefined) pkgOf.set(path, dir);
  }
  const nameToMeta = new Map();
  for (const ws of workspaces) nameToMeta.set(ws.name, ws);
  const ctx = {
    tree,
    files,
    metaByDir,
    nameToMeta,
    pkgOf,
    edgesImport: new Map(),
    edgesReexport: new Map(),
    refsByFile: new Map(),
    resolvedByFile: new Map(),
  };
  for (const path of files) {
    const refs = parseModuleRefs(tree.get(path) ?? '');
    const resolvedRefs = [];
    for (const ref of refs) {
      const target = resolveSpecifier(ref.spec, path, ctx);
      if (target === undefined || !files.has(target)) continue;
      resolvedRefs.push({ ref, target });
      const edges = ref.kind === 'reexport' ? ctx.edgesReexport : ctx.edgesImport;
      let set = edges.get(path);
      if (set === undefined) {
        set = new Set();
        edges.set(path, set);
      }
      set.add(target);
    }
    ctx.resolvedByFile.set(path, resolvedRefs);
  }
  // Package importer index: files holding at least one edge into a package.
  ctx.importersOfPkg = new Map();
  for (const [from, resolved] of ctx.resolvedByFile) {
    const fromPkg = ctx.pkgOf.get(from);
    for (const { target } of resolved) {
      const targetPkg = ctx.pkgOf.get(target);
      let set = ctx.importersOfPkg.get(targetPkg);
      if (set === undefined) {
        set = new Set();
        ctx.importersOfPkg.set(targetPkg, set);
      }
      set.add(from);
    }
  }
  return ctx;
}

function ownerDir(path, metaByDir) {
  for (const dir of metaByDir.keys()) {
    if (path.startsWith(`${dir}/`)) return dir;
  }
  return undefined;
}

/** Resolves a specifier to a repo path in the tree, or `undefined` (external). */
export function resolveSpecifier(spec, fromPath, ctx) {
  const pkgDir = ctx.pkgOf.get(fromPath);
  if (spec.startsWith('#/')) {
    const meta = pkgDir === undefined ? undefined : ctx.metaByDir.get(pkgDir);
    if (meta === undefined) return undefined;
    return resolveSubpathImport(spec, meta, ctx);
  }
  if (spec.startsWith('.')) {
    const base = posix.join(posix.dirname(fromPath), spec);
    return firstExisting(ctx, candidatePaths(base));
  }
  if (spec.startsWith('@superliora/')) {
    const target = ctx.nameToMeta.get(spec);
    if (target !== undefined) return target.entry;
    // Subpath import `@superliora/pkg/sub`: resolve through that package's dir.
    const meta = [...ctx.nameToMeta.values()].find((ws) => spec.startsWith(`${ws.name}/`));
    if (meta === undefined) return undefined;
    const rest = spec.slice(meta.name.length + 1);
    const entryDir = posix.dirname(meta.entry);
    return firstExisting(ctx, candidatePaths(posix.join(entryDir, rest)));
  }
  return undefined;
}

function resolveSubpathImport(spec, meta, ctx) {
  const imports = meta.imports ?? {};
  if (imports[spec] !== undefined) {
    const resolved = expandImportValue(imports[spec], meta.dir);
    const found = firstExisting(ctx, resolved);
    if (found !== undefined) return found;
  }
  // Longest `#/*` prefix match against the map, then the generic `#/*`.
  const rest = spec.slice(1); // keep leading '/'
  const keys = Object.keys(imports)
    .filter((key) => key.endsWith('/*') && spec.startsWith(key.slice(0, -1)))
    .toSorted((a, b) => b.length - a.length);
  for (const key of keys) {
    const tail = spec.slice(key.length - 1);
    const resolved = expandImportValue(imports[key], meta.dir).map((candidate) =>
      candidate.replaceAll('*', tail),
    );
    const found = firstExisting(ctx, resolved);
    if (found !== undefined) return found;
  }
  const generic = imports['#/*'];
  if (generic !== undefined) {
    const tail = spec.slice(2);
    const resolved = expandImportValue(generic, meta.dir).map((candidate) =>
      candidate.replaceAll('*', tail),
    );
    const found = firstExisting(ctx, resolved);
    if (found !== undefined) return found;
  }
  return undefined;
}

function expandImportValue(value, dir) {
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => posix.join(dir, entry));
}

function candidatePaths(base) {
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.mjs$/, '.mts'),
  ];
}

function firstExisting(ctx, candidates) {
  for (const candidate of candidates) {
    if (ctx.tree.has(candidate) || ctx.files.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Files that (transitively) `import` the given file through runtime import
 * edges. Pure re-export chains (`export … from`) do not count — they are
 * handled at the name level.
 */
export function deepImporters(ctx, file) {
  if (ctx.reverseImport === undefined) {
    const reverse = new Map();
    for (const [from, targets] of ctx.edgesImport) {
      for (const target of targets) {
        let set = reverse.get(target);
        if (set === undefined) {
          set = new Set();
          reverse.set(target, set);
        }
        set.add(from);
      }
    }
    ctx.reverseImport = reverse;
  }
  const reverse = ctx.reverseImport;
  const seen = new Set();
  const queue = [file];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const importer of reverse.get(current) ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      queue.push(importer);
    }
  }
  seen.delete(file);
  return seen;
}

/** Names a module exposes to its importers, mapped to the defining module. */
function nameMapOf(ctx, module, cache, visiting) {
  const cached = cache.get(module);
  if (cached !== undefined) return cached;
  if (visiting.has(module)) return { names: new Map(), unknown: true };
  visiting.add(module);
  const content = ctx.tree.get(module) ?? '';
  const parsed = parseExports(content);
  const names = new Map();
  let unknown = false;
  for (const name of parsed.own) names.set(name, module);
  for (const ref of parsed.reexports) {
    const target = resolveSpecifier(ref.spec, module, ctx);
    if (target === undefined || !ctx.files.has(target)) {
      unknown = true;
      continue;
    }
    const child = nameMapOf(ctx, target, cache, visiting);
    if (child.unknown === true) unknown = true;
    if (ref.star === true) {
      for (const [name, defModule] of child.names) names.set(name, defModule);
      if (child.unknown === true) unknown = true;
      continue;
    }
    for (const pair of ref.pairs) {
      const resolved = child.names.get(pair.internal);
      if (resolved === undefined) {
        names.set(pair.public, 'unknown');
        unknown = true;
      } else {
        names.set(pair.public, resolved);
      }
    }
  }
  visiting.delete(module);
  const result = { names, unknown };
  cache.set(module, result);
  return result;
}

/**
 * Selects the test files affected by the changed files.
 *
 * `changed`: repo paths (existing or deleted). Returns
 * `{ kind: 'related', testFiles }`, `{ kind: 'closure' }` (fall back to
 * workspace-level filtering: deleted or meta files), or
 * `{ kind: 'full' | 'none', reason }`.
 */
export function selectRelatedTests(ctx, changed) {
  // Files outside the graph cannot be attributed: deleted code and package
  // meta widen to the workspace closure, anything else (scripts, root configs)
  // widens to the full suite.
  const nonGraph = changed.filter((file) => ctx.files.has(file) === false);
  if (nonGraph.some((file) => looksLikeCode(file) === true)) {
    return { kind: 'closure', reason: `deleted files changed (${nonGraph[0]})` };
  }
  const meta = nonGraph.filter((file) => /(^|\/)(package\.json|vitest\.config\.ts|tsconfig[^/]*\.json|vitest\.setup\.[cm]?ts)$/.test(file));
  if (meta.length > 0) return { kind: 'closure', reason: `package meta changed (${meta[0]})` };
  if (nonGraph.length > 0) return { kind: 'full', reason: `file outside the graph (${nonGraph[0]})` };

  const code = changed.filter((file) => TEST_RE.test(file) === true || SOURCE_RE.test(file) === true);
  if (code.length === 0) return { kind: 'none', reason: 'no code changes' };

  ctx.nameCache = new Map();
  const testFiles = new Set();
  const visitedSrc = new Set();
  const queue = [];
  for (const file of code) {
    if (TEST_RE.test(file) === true) testFiles.add(file);
    else queue.push(file);
  }
  while (queue.length > 0) {
    const file = queue.pop();
    if (visitedSrc.has(file) === true) continue;
    visitedSrc.add(file);
    const pkgDir = ctx.pkgOf.get(file);
    if (pkgDir === undefined) return { kind: 'full', reason: `changed file outside a workspace (${file})` };

    // 1. Deep import chain: tests whose module chain reaches the changed file
    //    through runtime imports.
    for (const importer of deepImporters(ctx, file)) {
      if (TEST_RE.test(importer) === true) testFiles.add(importer);
    }
    // 2. Name level: tests (and source files, which recurse) that import a
    //    name whose defining module is the changed file or its importer chain.
    matchTestsByNames(ctx, pkgDir, file, testFiles, queue, visitedSrc);
    // 3. Floor: no test reaches the change inside its own package — run the
    //    package's own tests rather than nothing.
    if (hasTestFor(ctx, pkgDir, testFiles) === false) {
      addWorkspaceTests(ctx, pkgDir, testFiles);
    }
  }
  return { kind: 'related', testFiles: [...testFiles].toSorted((a, b) => a.localeCompare(b)) };
}

/**
 * Files whose imports reference the changed file's package: a test matches
 * when a name it imports is defined by the changed file or its importer chain;
 * a source file match recurses so multi-hop chains (oauth -> agent-core ->
 * liora) stay precise.
 */
function matchTestsByNames(ctx, pkgDir, changedFile, testFiles, queue, visitedSrc) {
  const importers = deepImporters(ctx, changedFile);
  const candidates = ctx.importersOfPkg.get(pkgDir) ?? new Set();
  for (const file of candidates) {
    const resolvedRefs = ctx.resolvedByFile.get(file) ?? [];
    let touched = false;
    for (const { ref, target } of resolvedRefs) {
      const targetPkg = ctx.pkgOf.get(target);
      if (targetPkg !== pkgDir) continue;
      if (ref.kind === 'import' && (target === changedFile || importers.has(target) === true)) {
        touched = true;
        break;
      }
      if (ref.kind === 'dynamic' || ref.star === true || ref.hasDefault === true) {
        touched = true;
        break;
      }
      const map = nameMapOf(ctx, target, ctx.nameCache, new Set());
      if (map.unknown === true) {
        touched = true;
        break;
      }
      for (const name of ref.names) {
        const source = map.names.get(name);
        if (source === undefined) continue;
        if (source === changedFile || importers.has(source) === true) {
          touched = true;
          break;
        }
      }
      if (touched === true) break;
    }
    if (touched === false) continue;
    if (TEST_RE.test(file) === true) {
      testFiles.add(file);
      continue;
    }
    if (ctx.pkgOf.get(file) === pkgDir) {
      // Same-package source influenced by name. Tests that deep-import it
      // exercise the changed behavior; pure re-export barrels are skipped —
      // their importers are matched by name instead.
      if (parseExports(ctx.tree.get(file) ?? '').own.size === 0) continue;
      for (const importer of deepImporters(ctx, file)) {
        if (TEST_RE.test(importer) === true) testFiles.add(importer);
      }
      continue;
    }
    if (visitedSrc.has(file) === false) queue.push(file);
  }
}

function looksLikeCode(file) {
  return SOURCE_RE.test(file) || TEST_RE.test(file);
}

function hasTestFor(ctx, pkgDir, testFiles) {
  for (const file of testFiles) {
    if (ctx.pkgOf.get(file) === pkgDir) return true;
  }
  return false;
}

function addWorkspaceTests(ctx, pkgDir, testFiles) {
  for (const file of ctx.files) {
    if (TEST_RE.test(file) === true && ctx.pkgOf.get(file) === pkgDir) testFiles.add(file);
  }
}

