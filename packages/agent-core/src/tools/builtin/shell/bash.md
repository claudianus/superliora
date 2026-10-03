Execute a `{{ SHELL_NAME }}` command. Supports files, edits, search, network requests, git, builds, tests, and process management.

Each call starts a fresh shell. `cwd` defaults to the session directory. Standard input is closed; output streams live and large output is saved to a log.

`timeout` is seconds. Foreground default: {{ DEFAULT_TIMEOUT_S }}s. With `run_in_background=true`, provide `description`; the call returns a task ID. Background default: {{ DEFAULT_BACKGROUND_TIMEOUT_S }}s; `disable_timeout=true` removes that deadline. SessionControl can list, wait for output, or stop background tasks.

User permission and sandbox boundaries apply. Sensitive credential paths are protected.
