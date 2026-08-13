export type SiteLang = 'ko' | 'en';

function withTrailingSlash(base: string): string {
  if (base.length === 0) return '/';
  return base.endsWith('/') ? base : `${base}/`;
}

export function landingHomeHref(lang: SiteLang, base: string): string {
  const root = withTrailingSlash(base);
  return lang === 'en' ? `${root}en/` : root;
}

export function landingDocsHref(lang: SiteLang, base: string): string {
  const root = withTrailingSlash(base);
  return lang === 'en' ? `${root}en/docs/getting-started.html` : `${root}docs/getting-started.html`;
}
