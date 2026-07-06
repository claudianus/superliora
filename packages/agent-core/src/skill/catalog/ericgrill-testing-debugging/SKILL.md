---
name: testing-debugging
description: Testing and debugging workflows for software development. Use when writing tests, debugging failing tests, analyzing error logs, troubleshooting code issues, or setting up test infrastructure. Provides practical patterns for test-driven development, test organization, debugging strategies, and error analysis optimized for Claude Code sessions.
catalogSource: ericgrill
catalogId: ericgrill-testing-debugging
---

# Testing & Debugging (Claude Code)

Practical testing and debugging workflows for developers using Claude Code. Focuses on efficient patterns that leverage AI assistance for faster debugging and better test coverage across multiple languages and frameworks.

## Quick Start

### Run Tests
```bash
# JavaScript/TypeScript (Jest)
npm test
npm test -- src/utils/helpers.test.js
npm test -- --watch
npm test -- --coverage

# Python (pytest)
pytest
pytest tests/test_utils.py -v
pytest -xvs  # verbose, stop on first failure
pytest --cov=src --cov-report=html

# Go
go test ./...
go test -v ./pkg/utils
go test -race ./...

# Rust
cargo test
cargo test -- --nocapture
cargo test module_name
```

### Debug a Failing Test
```bash
# Run specific failing test
npm test -- --testNamePattern="should calculate total"
pytest -k "test_calculate_total"
go test -run TestCalculateTotal -v

# Ask Claude to analyze
claude "This test is failing, help me debug it"
```

## Test Writing Patterns

### JavaScript/TypeScript (Jest)

```javascript
// Unit Test Template
import { calculateTotal, applyDiscount } from './calculator';

describe('calculateTotal', () => {
  it('should sum item prices correctly', () => {
    const items = [{ price: 10 }, { price: 20 }];
    expect(calculateTotal(items)).toBe(30);
  });

  it('should handle empty cart', () => {
    expect(calculateTotal([])).toBe(0);
  });

  it('should handle decimal prices', () => {
    const items = [{ price: 10.99 }, { price: 5.50 }];
    expect(calculateTotal(items)).toBeCloseTo(16.49);
  });
});

// Async Testing
it('should fetch user data', async () => {
  const user = await fetchUser(123);
  expect(user.id).toBe(123);
  expect(user.name).toBeDefined();
});

// Mocking
import { jest } from '@jest/globals';
const mockFn = jest.fn();
mockFn.mockReturnValue('mocked');
mockFn.mockResolvedValue({ data: [] });
expect(mockFn).toHaveBeenCalledWith('arg1');
```

### Python (pytest)

```python
# Unit Test
import pytest
from calculator import calculate_total, apply_discount

class TestCalculateTotal:
    def test_sum_item_prices(self):
        items = [{"price": 10}, {"price": 20}]
        assert calculate_total(items) == 30

    def test_handle_empty_cart(self):
        assert calculate_total([]) == 0

    def test_decimal_prices(self):
        items = [{"price": 10.99}, {"price": 5.50}]
        assert calculate_total(items) == pytest.approx(16.49)

# Fixtures
@pytest.fixture
def sample_user():
    return {"id": 1, "name": "Test User", "email": "test@example.com"}

def test_user_properties(sample_user):
    assert sample_user["name"] == "Test User"

# Parametrized Tests
@pytest.mark.parametrize("input,expected", [
    ([10, 20], 30),
    ([], 0),
    ([5.5, 4.5], 10.0),
])
def test_calculate_total(input, expected):
    assert calculate_total(input) == expected

# Mocking
from unittest.mock import Mock, patch

def test_fetch_user():
    with patch('module.requests.get') as mock_get:
        mock_get.return_value.json.return_value = {"id": 1}
        result = fetch_user(1)
        assert result["id"] == 1
```

### Go

```go
package utils

import (
    "testing"
    "github.com/stretchr/testify/assert"
)

func TestCalculateTotal(t *testing.T) {
    tests := []struct {
        name     string
        items    []Item
        expected float64
    }{
        {"sum prices", []Item{{Price: 10}, {Price: 20}}, 30},
        {"empty cart", []Item{}, 0},
        {"decimals", []Item{{Price: 10.99}, {Price: 5.50}}, 16.49},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := CalculateTotal(tt.items)
            assert.InDelta(t, tt.expected, result, 0.01)
        })
    }
}

// Table-Driven with testify
func TestDivide(t *testing.T) {
    assert := assert.New(t)
    
    result, err := Divide(10, 2)
    assert.NoError(err)
    assert.Equal(5, result)
    
    _, err = Divide(10, 0)
    assert.Error(err)
}

// Benchmarks
func BenchmarkCalculateTotal(b *testing.B) {
    items := []Item{{Price: 10}, {Price: 20}}
    for i := 0; i < b.N; i++ {
        CalculateTotal(items)
    }
}
```

### Rust

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_total() {
        let items = vec![
            Item { price: 10.0 },
            Item { price: 20.0 },
        ];
        assert_eq!(calculate_total(&items), 30.0);
    }

    #[test]
    fn test_empty_cart() {
        let items: Vec<Item> = vec![];
        assert_eq!(calculate_total(&items), 0.0);
    }

    #[test]
    #[should_panic(expected = "division by zero")]
    fn test_divide_by_zero() {
        divide(10, 0);
    }

    // Async test
    #[tokio::test]
    async fn test_fetch_user() {
        let user = fetch_user(1).await;
        assert_eq!(user.id, 1);
    }
}
```

## Test Organization

### Directory Structure
```
# JavaScript/TypeScript
src/
  components/
    Button.tsx
    Button.test.tsx          # Co-located tests
  utils/
    helpers.ts
    helpers.test.ts
  __mocks__/                 # Mock files
    api.ts
  e2e/                       # E2E tests
    checkout.spec.ts

# Python
src/
  calculator.py
tests/
  unit/
    test_calculator.py
  integration/
    test_api.py
  conftest.py                # Shared fixtures

# Go
calculator/
  calculator.go
  calculator_test.go         # Same package

# Rust
src/
  lib.rs
tests/
  integration_test.rs        # Integration tests
```

### Test Configuration

**Jest (package.json):**
```json
{
  "jest": {
    "testEnvironment": "node",
    "collectCoverageFrom": ["src/**/*.js"],
    "coverageThreshold": {
      "global": {
        "branches": 80,
        "functions": 80,
        "lines": 80,
        "statements": 80
      }
    },
    "setupFilesAfterEnv": ["<rootDir>/jest.setup.js"]
  }
}
```

**pytest (pytest.ini):**
```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short --strict-markers
markers =
    slow: marks tests as slow
    integration: marks tests as integration tests
```

## Debugging Workflows

### The DEBUG Loop

```bash
# 1. REPRODUCE - Get the error
npm test 2>&1 | head -50
pytest -xvs 2>&1 | tee test-output.txt

# 2. ISOLATE - Run just that test
npm test -- --testNamePattern="failing test"
pytest -k "test_name" -xvs

# 3. INSPECT - Add logging or ask Claude
# Add console.log, print, or log statements
echo "Debug this: $(cat failing-test-output.txt)" | claude

# 4. FIX - Implement solution
claude "Fix this failing test based on the error"

# 5. VERIFY - Run test again
npm test -- --testNamePattern="failing test"
```

### Reading Error Logs

**Parse Stack Traces:**
```bash
# JavaScript - Get just the error
npm test 2>&1 | grep -A 10 "FAIL\|Error\|expected"

# Python - Get traceback
pytest -xvs 2>&1 | grep -A 20 "FAILED\|Error"

# Go - Get test output
go test -v 2>&1 | grep -A 5 "FAIL\|--- FAIL"
```

**Common Error Patterns:**

| Error | Meaning | Solution |
|-------|---------|----------|
| `Test suite failed to run` | Missing import or syntax error | Check imports and syntax |
| `expect(received).toBe(expected)` | Assertion failed | Check actual vs expected values |
| `Cannot find module` | Missing dependency | Install package, check import path |
| `Async callback was not invoked` | Missing await/done() | Add await or use done callback |
| `Network Error` | Unmocked API call | Mock the API call |
| `fixture not found` | Missing pytest fixture | Define fixture in conftest.py |

### Debugging with Claude Code

**Share Context Efficiently:**
```bash
# Share function + test + error (JavaScript)
claude "Debug this:
Function: $(cat src/utils/api.ts)
Test: $(cat src/utils/api.test.ts)
Error: $(npm test -- api.test 2>&1 | tail -30)"

# Share function + test + error (Python)
claude "Debug this:
Function: $(cat src/utils/api.py)
Test: $(cat tests/test_api.py)
Error: $(pytest tests/test_api.py -xvs 2>&1 | tail -40)"
```

**Ask Specific Questions:**
```bash
# Bad: "Fix this"
# Good: "Why is this async test timing out?"
# Good: "What's wrong with this mock setup?"
# Good: "How do I test this error case?"
# Good: "Why is this assertion failing with undefined?"
```

## Test-Driven Development (TDD)

### Red-Green-Refactor with Claude

**1. Red - Write Failing Test:**
```bash
claude "Write a test for a function that validates email addresses"
# Creates validator.test.js with failing tests
```

**2. Green - Implement to Pass:**
```bash
claude "Implement the validateEmail function to pass these tests: $(cat validator.test.js)"
```

**3. Refactor - Clean Up:**
```bash
claude "Refactor this code while keeping tests passing: $(cat validator.js)"
```

### TDD Workflow Commands

```bash
# Watch mode for rapid TDD
npm test -- --watch --testPathPattern=validator
pytest -f tests/test_validator.py  # pytest-watch

# Run only changed files
npm test -- --changedSince=main
pytest --picked  # pytest-picked

# Run related to changed files
npm test -- --findRelatedTests src/utils/validator.js
```

## Integration & E2E Testing

### API Integration Tests

**JavaScript (with MSW):**
```javascript
import { setupServer } from 'msw/node';
import { rest } from 'msw';

const server = setupServer(
  rest.get('/api/user', (req, res, ctx) => {
    return res(ctx.json({ id: 1, name: 'Test' }));
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('fetches user from API', async () => {
  const user = await getUser();
  expect(user.name).toBe('Test');
});
```

**Python (with pytest + responses):**
```python
import responses
import requests

@responses.activate
def test_api_call():
    responses.add(
        responses.GET,
        'https://api.example.com/user',
        json={"id": 1, "name": "Test"},
        status=200
    )
    
    user = fetch_user()
    assert user["name"] == "Test"
```

### E2E with Playwright

```javascript
// e2e/checkout.spec.ts
import { test, expect } from '@playwright/test';

test('user can complete checkout', async ({ page }) => {
  await page.goto('/shop');
  await page.click('[data-testid="add-to-cart"]');
  await page.click('[data-testid="checkout"]');
  await page.fill('[name="email"]', 'test@example.com');
  await page.click('[type="submit"]');
  
  await expect(page).toHaveURL('/checkout/success');
});
```

**Run E2E Tests:**
```bash
npx playwright test
npx playwright test checkout.spec.ts
npx playwright test --ui
npx playwright test --debug
```

## Test Coverage

### Coverage Reports

```bash
# JavaScript
npm test -- --coverage
open coverage/lcov-report/index.html

# Python
pytest --cov=src --cov-report=html
open htmlcov/index.html

# Go
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

**Focus on What Matters:**
```bash
# View uncovered lines (Python)
pytest --cov=src --cov-report=term-missing

# View uncovered lines (JavaScript)
cat coverage/lcov.info | grep -A 2 "LF:" | head -20

# Ask Claude to add tests for uncovered code
claude "Add tests to cover these uncovered lines: $(cat coverage-report.txt)"
```

### Coverage Best Practices
- Aim for 80%+ coverage on business logic
- Don't obsess over 100% coverage
- Focus on critical paths and edge cases
- Mock external dependencies
- Test behavior, not implementation

## Troubleshooting

### Common Issues

**Flaky Tests:**
```bash
# Run test multiple times to detect flakiness
for i in {1..10}; do npm test -- --testNamePattern="flaky test"; done
for i in {1..10}; do pytest -k "flaky_test"; done

# Ask Claude to stabilize
claude "This test is flaky, help me make it deterministic"
```

**Slow Tests:**
```bash
# Find slowest tests
npm test -- --verbose 2>&1 | grep -E "PASS|FAIL" | sort -k3 -n
pytest --durations=10

# Run in parallel
npm test -- --maxWorkers=4
pytest -n auto  # pytest-xdist
```

**Memory Issues:**
```bash
# Run with increased memory
node --max-old-space-size=4096 node_modules/.bin/jest
pytest --memray  # pytest-memray
```

**Import/Module Issues:**
```bash
# Python - Fix import paths
export PYTHONPATH="${PYTHONPATH}:$(pwd)/src"

# JavaScript - Clear cache
npm test -- --no-cache
rm -rf node_modules/.cache

# Go - Clean and rebuild
go clean -testcache
go test -count=1
```

### Debug Commands Quick Reference

```bash
# List all tests without running
npm test -- --listTests
pytest --collect-only

# Run tests matching pattern
npm test -- --testPathPattern="api"
pytest -k "api"
go test -run TestAPI

# Run only failed tests from last run
npm test -- --onlyFailures
pytest --lf  # last-failed

# Verbose output
npm test -- --verbose
pytest -vvs
go test -v

# Show seed for randomization
npm test -- --showSeed
pytest --randomly-seed=12345

# Debug with PDB (Python)
pytest -xvs --pdb
import pdb; pdb.set_trace()
```

## Tips for AI-Assisted Testing

1. **Start with the test** - Let Claude understand requirements through test cases
2. **Provide context** - Share the function, its usage, and expected behavior
3. **Be specific** - Ask for specific test cases (edge cases, error cases)
4. **Iterate** - Run tests, share errors, ask for fixes
5. **Review coverage** - Ask Claude to identify untested code paths

### Effective Prompts

```bash
# Generate comprehensive tests
claude "Write unit tests for this function including edge cases: $(cat utils.py)"

# Fix failing test
claude "This test is failing. Fix the implementation:
Test: $(cat test_code.py)
Error: $(pytest test_code.py -xvs 2>&1)"

# Add missing coverage
claude "These lines are uncovered. Add tests:
Code: $(cat src/utils.py)
Coverage: $(cat uncovered-lines.txt)"

# Debug complex failure
claude "Debug this async test timeout.
Test: $(cat test.js)
Implementation: $(cat impl.js)"

# Generate test data
claude "Generate test data for a user registration form with edge cases"

# Mock external API
claude "Create a mock for this API call in my tests: $(cat api-client.js)"
```
