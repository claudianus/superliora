# Performance Optimization

## Description

Identify and fix performance bottlenecks in your code. From algorithmic improvements to caching strategies, make your code fast enough that users don't notice it running.

## When to Use

- Slow API responses or page loads
- High memory usage
- CPU-intensive operations
- Database query optimization
- Scaling bottlenecks

## Quick Diagnosis

### Find the Bottleneck

```bash
# Profile Node.js app
node --prof app.js
node --prof-process isolate-*.log > profile.txt

# Quick timing
console.time('operation');
doSomething();
console.timeEnd('operation');

# Memory usage
console.log(process.memoryUsage());
```

### Common Culprits Checklist

- [ ] N+1 database queries
- [ ] Nested loops (O(n²) or worse)
- [ ] Synchronous file I/O in request handlers
- [ ] Large unoptimized images/assets
- [ ] Missing database indexes
- [ ] No caching for repeated operations
- [ ] Loading entire tables into memory

## Optimization Patterns

### Database Queries

**Bad (N+1):**
```javascript
const users = await db.users.findAll();
for (const user of users) {
  user.orders = await db.orders.find({ userId: user.id }); // N queries!
}
```

**Good (Eager Loading):**
```javascript
const users = await db.users.findAll({
  include: [{ model: db.orders }] // 1 query with join
});
```

**Add Indexes:**
```sql
-- Find slow queries
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 123;

-- Add index if missing
CREATE INDEX idx_orders_user_id ON orders(user_id);
```

### Caching Strategies

**In-Memory Cache:**
```javascript
const cache = new Map();

async function getUser(id) {
  if (cache.has(id)) {
    return cache.get(id);
  }
  const user = await db.users.findById(id);
  cache.set(id, user);
  return user;
}
```

**Redis for Distributed Caching:**
```javascript
const redis = require('redis');
const client = redis.createClient();

async function getExpensiveData(key) {
  const cached = await client.get(key);
  if (cached) return JSON.parse(cached);
  
  const data = await computeExpensiveData();
  await client.setex(key, 3600, JSON.stringify(data)); // 1 hour TTL
  return data;
}
```

### Algorithm Optimization

**Bad (O(n²) lookup):**
```javascript
// Finding duplicates
const duplicates = [];
for (let i = 0; i < arr.length; i++) {
  for (let j = i + 1; j < arr.length; j++) {
    if (arr[i] === arr[j]) duplicates.push(arr[i]);
  }
}
```

**Good (O(n) with Set):**
```javascript
const seen = new Set();
const duplicates = [];
for (const item of arr) {
  if (seen.has(item)) duplicates.push(item);
  seen.add(item);
}
```

### Async Patterns

**Bad (Sequential awaits):**
```javascript
const user = await getUser();
const posts = await getPosts();  // waits for user
const comments = await getComments();  // waits for posts
```

**Good (Parallel):**
```javascript
const [user, posts, comments] = await Promise.all([
  getUser(),
  getPosts(),
  getComments()
]);
```

## Language-Specific Tips

### JavaScript/Node.js

```bash
# Use fast libraries
npm install fast-json-stringify  # vs JSON.stringify
npm install piscina              # worker threads pool

# Stream large files
const fs = require('fs');
fs.createReadStream('huge.csv')
  .pipe(parse())
  .pipe(transform())
  .pipe(fs.createWriteStream('output.csv'));
```

### Python

```python
# Use built-in functions
sum_list = sum(my_list)  # Faster than manual loop

# List comprehensions
squares = [x**2 for x in range(1000)]  # Faster than map()

# Generators for large data
def read_large_file():
    for line in open('huge.txt'):
        yield line
```

## Profiling Tools

### Browser DevTools

1. **Performance Tab** - Record and analyze runtime performance
2. **Memory Tab** - Find memory leaks
3. **Network Tab** - Analyze request timing
4. **Lighthouse** - Automated performance audit

### Node.js Profiling

```bash
# CPU profiling
node --prof app.js
node --prof-process isolate-*.log > profile.txt

# Heap snapshots
node --inspect app.js
# Then use Chrome DevTools Memory tab

# Clinic.js suite
npm install -g clinic
doctor  # Collect diagnostics
bubbleprof  # Async flow analysis
flame  # Flame graphs
```

### Database Profiling

```sql
-- PostgreSQL slow query log
SHOW log_min_duration_statement;
SET log_min_duration_statement = 1000; -- Log queries > 1s

-- MySQL slow query log
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;
```

## Optimization Workflow

```bash
# 1. Measure baseline
ab -n 1000 -c 10 http://localhost:3000/api/endpoint

# 2. Profile to find bottleneck
node --prof app.js

# 3. Optimize the hot path
# ... make changes ...

# 4. Measure again
ab -n 1000 -c 10 http://localhost:3000/api/endpoint

# 5. Repeat until good enough
```

## When NOT to Optimize

- Premature optimization is the root of all evil
- Don't optimize what you haven't measured
- Working code > fast code (initially)
- Only optimize hot paths (20% of code causing 80% of slowness)

## Tags

performance, optimization, profiling, caching, scalability, bottleneck