export interface LocalSearchDirectSources {
  readonly github?: boolean;
  readonly arxiv?: boolean;
  readonly npm?: boolean;
  readonly pypi?: boolean;
  readonly crates?: boolean;
}

export interface SearchIntent {
  readonly kind: 'tech' | 'package' | 'paper' | 'news' | 'general';
  readonly packageEcosystem?: 'npm' | 'pypi' | 'crates' | undefined;
}

export function classifySearchIntent(query: string): SearchIntent {
  const q = query.toLowerCase();
  if (/\b(arxiv|paper|doi|preprint|journal|citation)\b/.test(q)) {
    return { kind: 'paper' };
  }
  if (/\b(npm|node\.?js|typescript|javascript|react|vue|next\.?js|pnpm|yarn)\b/.test(q)) {
    return { kind: 'package', packageEcosystem: 'npm' };
  }
  if (/\b(pypi|pip|python|django|flask|fastapi)\b/.test(q)) {
    return { kind: 'package', packageEcosystem: 'pypi' };
  }
  if (/\b(crates?\.io|rustc?|cargo)\b/.test(q)) {
    return { kind: 'package', packageEcosystem: 'crates' };
  }
  if (
    /\b(github|gitlab|repo|library|sdk|api|framework|cli|package|crate|module|docs?|readme|release|changelog|cve|security|oss|open[- ]?source)\b/.test(
      q,
    )
  ) {
    return { kind: 'tech' };
  }
  if (/\b(news|today|breaking|headline|announced|released yesterday)\b/.test(q)) {
    return { kind: 'news' };
  }
  if (/[A-Za-z]+[A-Z][A-Za-z]+|[a-z]+_[a-z]+|\.[a-z]{1,4}\b|::|\(\)/.test(query)) {
    return { kind: 'tech' };
  }
  return { kind: 'general' };
}

export function shapeQueryForIntent(query: string, intent: SearchIntent): string {
  if (intent.kind === 'paper' && !/\barxiv\b/i.test(query)) {
    return `${query} arxiv OR paper`;
  }
  if (intent.kind === 'package') {
    if (intent.packageEcosystem === 'npm' && !/\bnpm\b/i.test(query)) return `${query} npm`;
    if (intent.packageEcosystem === 'pypi' && !/\bpypi|pip\b/i.test(query)) return `${query} pypi`;
    if (intent.packageEcosystem === 'crates' && !/\bcrate|cargo\b/i.test(query)) {
      return `${query} crates.io`;
    }
  }
  if (intent.kind === 'tech' && !/\b(docs?|github|api|sdk)\b/i.test(query)) {
    return `${query} docs OR github`;
  }
  return query;
}

export function selectDirectSourcesForIntent(
  configured: LocalSearchDirectSources,
  intent: SearchIntent,
): LocalSearchDirectSources {
  if (intent.kind === 'package') {
    if (intent.packageEcosystem === 'npm') {
      return {
        github: configured.github !== false,
        npm: configured.npm !== false,
        pypi: false,
        crates: false,
        arxiv: false,
      };
    }
    if (intent.packageEcosystem === 'pypi') {
      return {
        github: configured.github !== false,
        npm: false,
        pypi: configured.pypi !== false,
        crates: false,
        arxiv: false,
      };
    }
    if (intent.packageEcosystem === 'crates') {
      return {
        github: configured.github !== false,
        npm: false,
        pypi: false,
        crates: configured.crates !== false,
        arxiv: false,
      };
    }
  }
  if (intent.kind === 'paper') {
    return {
      github: configured.github !== false,
      npm: false,
      pypi: false,
      crates: false,
      arxiv: configured.arxiv !== false,
    };
  }
  if (intent.kind === 'news' || intent.kind === 'general') {
    return {
      github: false,
      npm: false,
      pypi: false,
      crates: false,
      arxiv: false,
    };
  }
  return configured;
}

export function hasAnyDirectSource(sources: LocalSearchDirectSources): boolean {
  return (
    sources.github !== false ||
    sources.npm !== false ||
    sources.pypi !== false ||
    sources.crates !== false ||
    sources.arxiv !== false
  );
}
