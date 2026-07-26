---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/user-configured-rules regression cases

- `UserConfiguredDenyPermissionPolicy` — pin the `undefined` return when no deny rule matches, the `deny` decision with the human-readable reason message for project-scope deny rules, the sub-agent message variant (`Try a different approach …`) when `agent.type === 'sub'`, the rejection of non-project scopes (`session` / `repo`), and the documented policy name (`user-configured-deny`).
- `UserConfiguredAllowPermissionPolicy` — pin the `approve` decision when an allow rule matches, the `undefined` return for non-matching tools, and the documented policy name (`user-configured-allow`).
- `UserConfiguredAskPermissionPolicy` — pin the `ask` decision when an ask rule matches, the `undefined` return for non-matching tools, and the documented policy name (`user-configured-ask`).
