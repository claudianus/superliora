---
'@superliora/oauth': patch
---

test(oauth): pin oauth/managed-feedback.kimiCodeFeedbackUrl regression cases

- Default call returns an `https://` URL ending in `/v1/feedback`.
- Custom `baseUrl` with a trailing slash keeps the host and adds the
  feedback suffix.
- Custom `baseUrl` host (`api.kimi.com`) is preserved in the result URL.
