---
name: feature-flags
description: Feature flag management and progressive rollouts. Use when launching new features gradually, doing A/B testing, canarying releases, or needing kill switches for production safety.
catalogSource: ericgrill
catalogId: ericgrill-feature-flags
---

# Feature Flags

Comprehensive guide to implementing feature flags for safer deployments, progressive rollouts, and controlled experiments.

## Quick Start

### When to Use Feature Flags

| Scenario | Flag Type | Example |
|----------|-----------|---------|
| New feature development | Release flag | `new-checkout-flow` |
| Gradual rollout | Percentage rollout | `5% → 25% → 100%` |
| A/B testing | Experiment flag | `button-color-test` |
| Emergency kill switch | Kill switch | `disable-payment-processing` |
| Operational toggles | Ops flag | `enable-verbose-logging` |

### Basic Implementation

```python
# Simple feature flag check
if feature_flags.is_enabled('new-dashboard', user_id=user.id):
    return render_new_dashboard()
else:
    return render_old_dashboard()
```

```javascript
// Frontend feature flag
if (featureFlags.isEnabled('dark-mode', { userId: currentUser.id })) {
  enableDarkMode();
}
```

## Flag Types

### 1. Release Flags (Short-lived)

Used during development to merge incomplete code safely.

```python
# Backend
if flags.is_enabled('new-payment-gateway'):
    process_with_new_gateway()
else:
    process_with_old_gateway()
```

**Lifecycle:**
1. Create flag (default: OFF)
2. Implement feature behind flag
3. Test in staging
4. Enable for team/internal users
5. Gradual rollout
6. 100% rollout
7. Remove flag code
8. Delete flag

### 2. Kill Switches (Permanent)

Emergency off-switches for critical features.

```python
# Always have a way to disable problematic features
if not flags.is_enabled('payments-enabled', default=True):
    return Response("Payments temporarily unavailable", 503)
```

**Best Practices:**
- Keep simple (no targeting, just on/off)
- Default to ON (feature enabled)
- Fast evaluation (cached)
- Alert when triggered

### 3. Experiment Flags (A/B Testing)

Random assignment for controlled experiments.

```python
variant = flags.get_variant('checkout-button-test', user_id=user.id)
# Returns: 'control', 'variant-a', 'variant-b'

if variant == 'variant-a':
    show_blue_button()
elif variant == 'variant-b':
    show_green_button()
else:
    show_default_button()
```

### 4. Operational Flags

Runtime configuration without deployment.

```python
# Adjust behavior without code changes
if flags.is_enabled('aggressive-caching'):
    cache_ttl = 3600
else:
    cache_ttl = 300
```

## Rollout Strategies

### Percentage Rollout

```python
# Start with 1% of users
flags.set_rollout('new-feature', percentage=1)

# Increase gradually
flags.set_rollout('new-feature', percentage=5)
flags.set_rollout('new-feature', percentage=25)
flags.set_rollout('new-feature', percentage=50)
flags.set_rollout('new-feature', percentage=100)
```

### Targeted Rollout

```python
# Enable for specific segments
flags.enable_for('new-feature', 
    segments=['beta-users', 'internal-team'])

# Enable for specific users
flags.enable_for('new-feature',
    user_ids=[123, 456, 789])

# Enable for specific organizations
flags.enable_for('new-feature',
    org_ids=['acme-corp'])
```

### Canary Deployment

```python
# Enable for 5% of traffic, monitor metrics
flags.set_rollout('critical-change', percentage=5)

# If metrics look good after 30 minutes
flags.set_rollout('critical-change', percentage=25)

# Continue until 100%
```

## Implementation Examples

### LaunchDarkly (Managed)

```python
from ldclient import LDClient

ld = LDClient(sdk_key='your-sdk-key')

# Check flag
if ld.variation('show-new-ui', user_context, False):
    render_new_ui()
else:
    render_old_ui()
```

### Unleash (Self-hosted)

```python
from UnleashClient import UnleashClient

client = UnleashClient(
    url="http://unleash:4242/api",
    app_name="my-app",
    custom_headers={'Authorization': 'your-api-key'}
)
client.initialize_client()

if client.is_enabled("new-feature"):
    handle_new_feature()
```

### Simple In-Memory (For Testing)

```python
class SimpleFeatureFlags:
    def __init__(self):
        self._flags = {}
    
    def enable(self, flag):
        self._flags[flag] = True
    
    def disable(self, flag):
        self._flags[flag] = False
    
    def is_enabled(self, flag, default=False):
        return self._flags.get(flag, default)

# Usage
flags = SimpleFeatureFlags()
flags.enable('test-flag')
```

### Database-Backed Flags

```sql
-- Feature flags table
CREATE TABLE feature_flags (
    name VARCHAR(100) PRIMARY KEY,
    enabled BOOLEAN DEFAULT FALSE,
    rollout_percentage INTEGER DEFAULT 0,
    allowed_users JSONB DEFAULT '[]',
    allowed_orgs JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- User flag overrides
CREATE TABLE user_feature_overrides (
    user_id INTEGER REFERENCES users(id),
    flag_name VARCHAR(100) REFERENCES feature_flags(name),
    enabled BOOLEAN,
    PRIMARY KEY (user_id, flag_name)
);
```

```python
# Database-backed flag check
async def is_enabled(flag_name: str, user_id: int = None) -> bool:
    flag = await db.fetchrow(
        "SELECT * FROM feature_flags WHERE name = $1",
        flag_name
    )
    
    if not flag or not flag['enabled']:
        return False
    
    # Check user override
    if user_id:
        override = await db.fetchrow(
            """SELECT enabled FROM user_feature_overrides
               WHERE user_id = $1 AND flag_name = $2""",
            user_id, flag_name
        )
        if override:
            return override['enabled']
    
    # Percentage rollout
    if flag['rollout_percentage'] < 100:
        user_hash = hash(f"{flag_name}:{user_id}")
        return (user_hash % 100) < flag['rollout_percentage']
    
    return True
```

## Frontend Feature Flags

### React

```jsx
import { useFeatureFlag } from './feature-flags';

function CheckoutButton() {
  const newCheckout = useFeatureFlag('new-checkout');
  
  return newCheckout ? <NewCheckout /> : <OldCheckout />;
}
```

```jsx
// Feature flag provider
function FeatureFlagProvider({ children }) {
  const [flags, setFlags] = useState({});
  
  useEffect(() => {
    fetch('/api/feature-flags')
      .then(r => r.json())
      .then(setFlags);
  }, []);
  
  return (
    <FeatureFlagContext.Provider value={flags}>
      {children}
    </FeatureFlagContext.Provider>
  );
}
```

### Vue

```vue
<template>
  <NewDashboard v-if="flags.newDashboard" />
  <OldDashboard v-else />
</template>

<script>
export default {
  computed: {
    flags() {
      return this.$featureFlags.getAll();
    }
  }
}
</script>
```

## Best Practices

### 1. Flag Naming

```
✅ Good:
- new-checkout-flow
- dark-mode-ui
- enable-api-v2
- experiment-button-color

❌ Bad:
- flag1
- new-feature
- johns-changes
- temp-flag
```

### 2. Default Values

```python
# Default to OFF for new features
if flags.is_enabled('new-risky-feature', default=False):
    ...

# Default to ON for kill switches
if not flags.is_enabled('service-enabled', default=True):
    ...
```

### 3. Context Passing

```python
# Pass context for proper targeting
flag_context = {
    'userId': user.id,
    'orgId': user.org_id,
    'email': user.email,
    'plan': user.subscription_plan,
    'createdAt': user.created_at.isoformat()
}

if flags.is_enabled('beta-feature', context=flag_context):
    ...
```

### 4. Cleanup Strategy

```python
# Add expiration dates to release flags
flag = {
    'name': 'new-feature',
    'type': 'release',
    'created_at': '2024-01-01',
    'expires_at': '2024-03-01',  # Reminder to remove
    'owner': 'team-backend'
}
```

### 5. Testing with Flags

```python
# Test both code paths
def test_feature_with_flag_on():
    flags.enable('new-feature')
    result = process_request()
    assert result.new_behavior

def test_feature_with_flag_off():
    flags.disable('new-feature')
    result = process_request()
    assert not result.new_behavior
```

## Monitoring & Alerting

### Flag Usage Metrics

```python
# Track flag evaluations
@metrics.histogram('flag_evaluation_duration_seconds')
def is_enabled(flag_name, context=None):
    start = time.time()
    result = evaluate_flag(flag_name, context)
    
    metrics.increment('flag_evaluation_total',
                     tags={'flag': flag_name, 'result': result})
    
    return result
```

### Alert on Stuck Flags

```sql
-- Find flags that have been at partial rollout too long
SELECT name, rollout_percentage, updated_at
FROM feature_flags
WHERE rollout_percentage BETWEEN 1 AND 99
  AND updated_at < NOW() - INTERVAL '7 days';
```

### Circuit Breaker Pattern

```python
# Disable feature automatically if error rate is high
class FeatureCircuitBreaker:
    def __init__(self, flag_name, error_threshold=0.1):
        self.flag_name = flag_name
        self.error_threshold = error_threshold
    
    def call(self, func):
        if not flags.is_enabled(self.flag_name):
            return None
        
        try:
            return func()
        except Exception as e:
            self.record_error()
            if self.error_rate() > self.error_threshold:
                flags.disable(self.flag_name)  # Auto-kill
            raise
```

## Security Considerations

### 1. Don't Expose Sensitive Flags

```python
# ❌ Don't expose internal flags to frontend
@app.route('/api/flags')
def get_flags():
    return jsonify(all_flags)  # Bad!

# ✅ Filter by visibility
@app.route('/api/flags')
def get_flags():
    user = get_current_user()
    visible = [f for f in all_flags 
               if f.visible_to(user)]
    return jsonify(visible)
```

### 2. Validate User IDs

```python
# Don't trust client-provided user IDs
# Use authenticated session
context = {'userId': current_user.id}  # Server-side
```

### 3. Rate Limit Flag Checks

```python
# Cache flag values to reduce load
@cache.memoize(timeout=60)
def get_user_flags(user_id):
    return calculate_flags_for_user(user_id)
```

## Troubleshooting

### Flag Not Working

```python
# Debug checklist
def debug_flag(flag_name, context):
    print(f"Flag: {flag_name}")
    print(f"Context: {context}")
    print(f"Raw value: {flags.get_raw(flag_name)}")
    print(f"Evaluated: {flags.is_enabled(flag_name, context)}")
    
    # Check if user in allowed list
    flag = flags.get(flag_name)
    if context.get('userId') in flag.allowed_users:
        print("User is in allowed list")
```

### Sticky Sessions

```python
# Ensure consistent experience
# Hash user ID to percentage, don't use random
def is_in_rollout(user_id, percentage):
    user_hash = hashlib.md5(str(user_id).encode()).hexdigest()
    user_number = int(user_hash, 16) % 100
    return user_number < percentage
```

## References

- [Martin Fowler: Feature Toggles](https://martinfowler.com/articles/feature-toggles.html)
- [LaunchDarkly Documentation](https://docs.launchdarkly.com/)
- [Unleash Documentation](https://docs.getunleash.io/)
- [GitHub: Scientist](https://github.com/github/scientist) - Ruby library for careful refactoring
