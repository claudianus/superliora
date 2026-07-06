---
name: database-migrations
description: Safe database migration patterns and best practices. Use when planning schema changes, running migrations in production, rolling back changes, or ensuring zero-downtime deployments with database modifications.
catalogSource: ericgrill
catalogId: ericgrill-database-migrations
---

# Database Migrations

Safe, reliable database migration patterns for production systems. Zero-downtime strategies, rollback procedures, and common pitfalls to avoid.

## Quick Start

### Checklist Before Running Migrations
- [ ] Tested on staging environment with production-like data
- [ ] Rollback plan documented and tested
- [ ] Maintenance window scheduled (if needed)
- [ ] Database backup completed
- [ ] Migration is backward compatible (for zero-downtime)
- [ ] Application code is ready for new schema
- [ ] Monitoring and alerting in place

### Migration Safety Levels

| Level | Description | Use When |
|-------|-------------|----------|
| 🟢 Safe | Additive changes only | High traffic, no maintenance window |
| 🟡 Caution | Mixed changes with compatibility layer | Medium traffic, short maintenance window |
| 🔴 Risky | Destructive changes | Low traffic, planned maintenance |

## Migration Patterns

### Pattern 1: Additive-Only (Zero Downtime)

**Safe changes that don't break running applications:**

```sql
-- ✅ SAFE: Adding a new table
CREATE TABLE user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    theme VARCHAR(20) DEFAULT 'light',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ✅ SAFE: Adding a new column (nullable with default)
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL;

-- ✅ SAFE: Adding an index (CONCURRENTLY in PostgreSQL)
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

-- ✅ SAFE: Creating a new index on existing column
CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status) 
WHERE status IN ('pending', 'processing');
```

### Pattern 2: Expand-Contract Pattern

**For changing column types or constraints:**

```sql
-- Step 1: Expand - Add new column (deploy 1)
ALTER TABLE users ADD COLUMN email_normalized VARCHAR(255);

-- Step 2: Dual-write - App writes to both columns (deploy 2)
-- Step 3: Backfill - Migrate data (deploy 3)
UPDATE users SET email_normalized = LOWER(email) 
WHERE email_normalized IS NULL;

-- Step 4: Switch reads - App reads from new column (deploy 4)
-- Step 5: Contract - Remove old column (deploy 5)
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users RENAME COLUMN email_normalized TO email;
```

### Pattern 3: Online Schema Changes (Large Tables)

**For large tables where ALTER TABLE would lock:**

```sql
-- Using pt-online-schema-change (Percona Toolkit)
pt-online-schema-change \
    --alter "ADD COLUMN phone VARCHAR(20)" \
    --execute \
    D=mydb,t=users

-- Using gh-ost (GitHub's online schema migration)
gh-ost \
    --database=mydb \
    --table=users \
    --alter="ADD COLUMN phone VARCHAR(20)" \
    --execute
```

## Framework-Specific Migration

### Django

```python
# Generated migration
python manage.py makemigrations

# Run with verification
python manage.py migrate --plan  # Preview changes
python manage.py migrate          # Execute

# Rollback (if needed)
python manage.py migrate app_name zero  # All the way back
python manage.py migrate app_name 0007   # Specific migration
```

### Rails

```bash
# Generate migration
rails generate migration AddPhoneToUsers phone:string

# Run migrations
rails db:migrate

# Check status
rails db:migrate:status

# Rollback
rails db:rollback              # One step
rails db:rollback STEP=3       # Multiple steps
```

### Node.js / Knex

```javascript
// Migration file
exports.up = async function(knex) {
  await knex.schema.table('users', table => {
    table.string('phone', 20).nullable();
    table.index(['email', 'created_at']);
  });
};

exports.down = async function(knex) {
  await knex.schema.table('users', table => {
    table.dropIndex(['email', 'created_at']);
    table.dropColumn('phone');
  });
};
```

```bash
# Run migrations
npx knex migrate:latest

# Rollback
npx knex migrate:rollback

# List
npx knex migrate:list
```

### Prisma

```bash
# Generate migration
npx prisma migrate dev --name add_phone_to_users

# Deploy to production
npx prisma migrate deploy

# Resolve issues
npx prisma migrate resolve --rolled-back migration_name
```

## Production Migration Strategies

### Strategy 1: Blue-Green Migration

```
1. Green environment: Run migrations
2. Test green with new schema
3. Switch traffic to green
4. Monitor for issues
5. Rollback: Switch back to blue
```

### Strategy 2: Maintenance Window

For destructive changes requiring downtime:

```bash
# 1. Announce maintenance window
# 2. Enable maintenance mode (if applicable)
# 3. Create final backup
pg_dump -Fc mydb > backup_$(date +%Y%m%d_%H%M%S).dump

# 4. Run migration
psql mydb < migration.sql

# 5. Verify
psql mydb -c "\d users"

# 6. Disable maintenance mode
```

### Strategy 3: Online with Replication Lag

```sql
-- Check replication lag before migration
SELECT 
    client_addr,
    state,
    pg_size_pretty(pg_wal_lsn_diff(sent_lsn, flush_lsn)) as lag
FROM pg_stat_replication;

-- Run only if lag < 1GB
```

## Common Migration Types

### Adding Columns

```sql
-- ✅ Safe approach
ALTER TABLE users 
ADD COLUMN preferences JSONB DEFAULT '{}'::jsonb;

-- ⚠️  Caution: Adding NOT NULL without default on large table
-- Do in two steps:
ALTER TABLE users ADD COLUMN newsletter_opt_in BOOLEAN NULL;
UPDATE users SET newsletter_opt_in = false;
ALTER TABLE users ALTER COLUMN newsletter_opt_in SET NOT NULL;
```

### Adding Indexes

```sql
-- PostgreSQL: Use CONCURRENTLY (no table lock)
CREATE INDEX CONCURRENTLY idx_users_created_at ON users(created_at);

-- MySQL: Use ALGORITHM=INPLACE
ALTER TABLE users 
ADD INDEX idx_created_at (created_at), 
ALGORITHM=INPLACE, LOCK=NONE;
```

### Renaming Columns

```sql
-- ❌ DANGEROUS: Direct rename breaks running apps
-- ALTER TABLE users RENAME COLUMN email TO email_address;

-- ✅ SAFE: Expand-contract pattern
ALTER TABLE users ADD COLUMN email_address VARCHAR(255);
-- Deploy app changes to write both columns
UPDATE users SET email_address = email;
-- Deploy app changes to read new column
ALTER TABLE users DROP COLUMN email;
```

### Dropping Columns

```sql
-- ✅ SAFE: Mark unused first, then drop later
ALTER TABLE users ALTER COLUMN unused_field DROP DEFAULT;
COMMENT ON COLUMN users.unused_field IS 'DEPRECATED: Will be removed in v2.1';

-- After 2+ releases, drop
ALTER TABLE users DROP COLUMN unused_field;
```

## Rollback Procedures

### Before Migration Checklist

```bash
# 1. Verify backup exists and is restorable
pg_restore --list backup.dump | head -20

# 2. Document rollback commands
# Save these for emergency use

# 3. Test rollback on staging
```

### Emergency Rollback

```bash
# PostgreSQL: Restore from backup
pg_restore -d mydb --clean --if-exists backup.dump

# MySQL: Restore from dump
mysql mydb < backup.sql

# Or use framework rollback
rails db:rollback STEP=1
npx knex migrate:rollback
```

### Partial Rollback (Data Fix)

```sql
-- If migration had data transformation errors
BEGIN;
-- Fix specific rows
UPDATE users SET status = 'active' WHERE status IS NULL;
COMMIT;
```

## Monitoring During Migrations

### Key Metrics to Watch

```sql
-- PostgreSQL: Active queries and locks
SELECT pid, state, query_start, query 
FROM pg_stat_activity 
WHERE state = 'active';

-- Lock waits
SELECT * FROM pg_locks WHERE NOT granted;

-- Table size growth
SELECT pg_size_pretty(pg_total_relation_size('users'));
```

### Application Metrics
- Error rate (should not spike)
- Response time (may temporarily increase)
- Database connection pool utilization
- Queue depth (if using async workers)

## Troubleshooting

### Migration is Stuck

```bash
# PostgreSQL: Find blocking queries
SELECT * FROM pg_stat_activity WHERE wait_event_type = 'Lock';

# Kill blocking query (careful!)
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE ...
```

### Migration Failed Mid-Run

```bash
# Check current state
rails db:migrate:status  # Rails
npx prisma migrate status  # Prisma

# Mark as resolved manually (if partially applied)
INSERT INTO schema_migrations (version) VALUES ('20240115120000');
```

### Performance Issues

```sql
-- Cancel long-running migration
SELECT pg_cancel_backend(pid);

-- Or terminate if necessary
SELECT pg_terminate_backend(pid);
```

## Best Practices

1. **Always test on production-like data** - Migrations that run in seconds on empty DB may take hours with millions of rows

2. **Make migrations reversible** - Always provide down/rollback methods

3. **Keep migrations small** - One logical change per migration

4. **Avoid data manipulation in migrations** - Use data migrations separately

5. **Use transactions when safe** - But know when to commit incrementally for large changes

6. **Document destructive changes** - Clearly mark migrations that can't be rolled back easily

7. **Schedule wisely** - Run large migrations during low-traffic periods

8. **Have a rollback plan** - Know how to undo every migration before running it

## References

- [PostgreSQL Migration Best Practices](https://www.postgresql.org/docs/current/sql-altertable.html)
- [MySQL Online DDL](https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-operations.html)
- [gh-ost GitHub](https://github.com/github/gh-ost)
- [Percona pt-online-schema-change](https://www.percona.com/doc/percona-toolkit/3.0/pt-online-schema-change.html)
