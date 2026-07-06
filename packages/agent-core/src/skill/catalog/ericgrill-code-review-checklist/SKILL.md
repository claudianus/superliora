# Code Review Checklist

## Description

Systematic code review checklist to ensure quality, security, and maintainability. Use for every PR review.

## When to Use

- Reviewing pull requests
- Pre-commit self-review
- Code quality audits
- Team standardization

## The Checklist

### Functionality
- [ ] Code does what it claims to do
- [ ] Edge cases are handled
- [ ] Error paths are tested
- [ ] No obvious bugs or logic errors

### Readability
- [ ] Variable/function names are clear
- [ ] Complex logic is commented
- [ ] No magic numbers/strings
- [ ] Consistent code style

### Testing
- [ ] New code has tests
- [ ] Tests are meaningful (not just coverage theater)
- [ ] Edge cases are tested
- [ ] Existing tests still pass

### Security
- [ ] No hardcoded secrets
- [ ] Input is validated/sanitized
- [ ] No SQL injection risks
- [ ] No XSS vulnerabilities

### Performance
- [ ] No N+1 queries
- [ ] No unnecessary computation
- [ ] Memory leaks considered
- [ ] Algorithmic complexity appropriate

### Maintainability
- [ ] Functions are reasonably sized
- [ ] No code duplication (DRY)
- [ ] Dependencies are justified
- [ ] Documentation updated if needed

## Quick Commands

```bash
# Run tests
npm test

# Check linting
npm run lint

# Type check
npm run typecheck

# Security audit
npm audit
```

## Review Comments Template

```
**[Category]** Description of issue

**Suggestion:** How to fix it

**Why:** Explanation of the concern
```

Example:
```
**[Security]** User input passed directly to SQL query

**Suggestion:** Use parameterized queries

**Why:** Prevents SQL injection attacks
```

## Review Priority Levels

- 🔴 **Blocker:** Security issue, broken functionality, data loss risk
- 🟡 **Concern:** Performance issue, maintainability problem, missing tests
- 🟢 **Nitpick:** Style preference, minor suggestion

## Tags

code-review, quality, checklist, pr, standards
