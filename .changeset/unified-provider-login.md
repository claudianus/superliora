---
"@superliora/liora": minor
---

Add OAuth login for OpenAI Codex (ChatGPT) and xAI Grok alongside a unified provider picker.

Replace the split /login and /provider add flows with a single searchable provider picker. The picker lists every models.dev provider (Anthropic, OpenAI, Google, and 150+ others) with OAuth login options for the SuperLiora/Kimi account, OpenAI Codex, and xAI Grok, plus custom-endpoint/registry options. Each row shows the auth method, model count, and where to get an API key. The catalog is cached to disk with a 5-minute TTL so the picker opens instantly. On first run with no provider configured, the picker opens automatically.

When a catalog provider's env var (for example `ANTHROPIC_API_KEY`) is already set, the API key dialog pre-fills it so the user only needs to press Enter. OAuth browser flows open the authorization URL automatically. OAuth providers ship model presets so they are usable immediately after after login.

An Anthropic OAuth login is also implemented (PKCE browser flow) but disabled by default behind the `SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH` flag, since Anthropic does not currently authorize third-party CLIs to use its subscription OAuth. It can be enabled by flipping the flag if the policy changes.

For enterprise users, the provider picker also offers Anthropic via Amazon Bedrock (AWS IAM credentials) and Google Vertex AI (GCP Application Default Credentials) — the two official cloud-hosted Claude routes Anthropic sanctions for third-party tools. Run /login to connect a provider.
