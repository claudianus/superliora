---
'@superliora/oauth': patch
---

test(oauth): pin oauth/managed-feedback-upload URL builders regression cases

- `kimiCodeFeedbackUploadUrl` returns an `https://` URL ending in
  `/feedback/upload_url`.
- `kimiCodeFeedbackUploadCompleteUrl` returns an `https://` URL ending in
  `/feedback/upload_complete`.
- Both endpoints share the same host.
- Both endpoints honor a custom https base URL.
