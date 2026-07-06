---
name: claude-performance-optimization
description: Performance optimization workflows for Claude Code. Use when diagnosing slow code, optimizing bottlenecks, or improving application speed. Provides profiling techniques, caching strategies, and algorithm improvements specifically for AI-assisted optimization sessions.
catalogSource: ericgrill
catalogId: ericgrill-claude-performance-optimization
---

# Performance Optimization (Claude Code)

Performance optimization workflows designed for Claude Code users. Find bottlenecks fast and fix them faster.

## Quick Commands

### Profile with Claude

```bash
# Share performance issue with Claude
/claude "This endpoint is slow, help me profile it: $(cat src/api/slow-endpoint.js)"

# Analyze a function
/claude "Optimize this function for performance: $(cat src/utils/heavy-computation.js)"

# Database query optimization
/claude "These queries are slow, add indexes: $(cat src/models/queries.sql)"
```

### Common Bottlenecks

**N+1 Query Detection:**
```bash
# Claude will spot these patterns
/claude "Check for N+1 queries in: $(cat src/services/user-service.js)"
```

**Memory Leak Analysis:**
```bash
# Share heap snapshot analysis
/claude "Help me analyze this memory profile: $(cat heap-profile.txt)"
```

## Claude-Specific Patterns

### Request Context Sharing

```bash
# Full context for complex optimization
/claude "Optimize this:

Current code:
$(cat src/bottleneck.js)

Flame graph hotspots:
$(cat profile.txt | head -50)

Requirements:
- Must handle 10k req/s
- Memory limit 512MB
- P95 latency < 100ms"
```

### Iterative Optimization

```bash
# Step 1: Identify
/claude "Find the performance bottleneck in $(cat src/api.js)"

# Step 2: Fix
/claude "Apply the optimization you suggested"

# Step 3: Verify
/claude "The query is still slow, profile this: $(cat query.log)"
```

## See Also

- [Universal Performance Guide](../universal/performance-optimization/SKILL.md)
