---
name: claude-security-best-practices
description: Security review and hardening workflows for Claude Code. Use when reviewing code for vulnerabilities, implementing authentication, or handling sensitive data. Provides OWASP-aligned security patterns optimized for AI-assisted security audits.
catalogSource: ericgrill
catalogId: ericgrill-claude-security-best-practices
---

# Security Best Practices (Claude Code)

Security workflows designed for Claude Code users. Review code for vulnerabilities, implement secure patterns, and don't get pwned.

## Quick Security Audits

### Code Review with Claude

```bash
# Security review a file
/claude "Security review this code: $(cat src/auth/login.js)"

# Check for common vulnerabilities
/claude "Check for SQL injection in: $(cat src/api/users.js)"

# Review authentication implementation
/claude "Review this JWT implementation for security: $(cat src/middleware/auth.js)"
```

### Vulnerability Scanning

```bash
# OWASP Top 10 check
/claude "Check this code against OWASP Top 10: $(cat src/routes/*.js)"

# Input validation review
/claude "Are all user inputs properly validated here? $(cat src/controllers/*.js)"
```

## Claude-Specific Patterns

### Security Context Sharing

```bash
# Full security audit context
/claude "Security audit:

Code to review:
$(cat src/api/payment.js)

Threat model:
- Public API
- Handles credit card data
- PCI DSS requirements

Focus areas:
- Input validation
- SQL injection
- XSS prevention
- Authentication bypass"
```

### Remediation Workflow

```bash
# Step 1: Find
/claude "Find security issues in $(cat src/auth.js)"

# Step 2: Fix
/claude "Fix the SQL injection vulnerability you found"

# Step 3: Verify
/claude "Verify the fix is correct and complete"
```

## Security Checklist

Before shipping, ask Claude:

```bash
/claude "Check this PR for:
1. Hardcoded secrets
2. SQL injection risks
3. XSS vulnerabilities
4. Missing auth checks
5. Insecure dependencies

$(git diff HEAD~1)"
```

## See Also

- [Universal Security Guide](../universal/security-best-practices/SKILL.md)
