import { beforeEach } from 'vitest';

import { setCliLocale } from '#/cli/i18n';

// The CLI locale is a module-level singleton. The runtime applies the user's
// locale in `main()` (`setCliLocale(detectCliLocale(process.env))`), and
// `main()` auto-runs when `#/main` is imported — which `test/cli/main.test.ts`
// does. Without a reset, that import would leak a non-English locale into
// other test files that share the worker and assert on English help text.
// Reset to English before every test so the singleton never leaks; tests that
// need a different locale set it inside the test body.
beforeEach(() => {
  setCliLocale('en');
});
