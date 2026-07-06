# Security Best Practices

## Description

Don't get pwned. Essential security patterns, common vulnerability prevention, and secure coding practices for building applications that don't leak data or let attackers in.

## When to Use

- Handling user authentication/authorization
- Processing user input
- Storing sensitive data
- Building public-facing APIs
- Reviewing code for security issues

## The Security Checklist

### Input Validation
- [ ] All user input is validated (not just sanitized)
- [ ] Type checking on all inputs
- [ ] Length limits enforced
- [ ] Whitelist validation preferred over blacklist
- [ ] File uploads validated (type, size, content)

### Authentication
- [ ] Passwords hashed with bcrypt/Argon2 (not MD5/SHA1)
- [ ] Multi-factor authentication for sensitive accounts
- [ ] Session tokens are cryptographically secure
- [ ] JWTs have short expiration + refresh tokens
- [ ] Rate limiting on auth endpoints

### Authorization
- [ ] Check permissions on every request
- [ ] Principle of least privilege
- [ ] No sensitive data in JWT payload
- [ ] Resource-level access control enforced

### Data Protection
- [ ] Encryption at rest for sensitive data
- [ ] TLS/SSL for all communications
- [ ] No secrets in code (use environment variables)
- [ ] Database credentials rotated regularly

### Output Encoding
- [ ] HTML escaped before rendering
- [ ] JSON properly serialized
- [ ] SQL parameterized (never concatenated)
- [ ] Headers set for XSS protection

## Common Vulnerabilities & Fixes

### SQL Injection

**Vulnerable:**
```javascript
const query = `SELECT * FROM users WHERE id = ${userId}`;
```

**Secure:**
```javascript
const query = 'SELECT * FROM users WHERE id = ?';
db.query(query, [userId]);
```

### XSS (Cross-Site Scripting)

**Vulnerable:**
```javascript
element.innerHTML = userInput;
```

**Secure:**
```javascript
// JavaScript
element.textContent = userInput;

// React (auto-escapes)
<div>{userInput}</div>

// Explicit escaping
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(dirtyHtml);
```

### CSRF (Cross-Site Request Forgery)

**Protection:**
```javascript
// Use CSRF tokens
app.use(csrf());

// Verify origin
app.use((req, res, next) => {
  const allowedOrigins = ['https://myapp.com'];
  if (!allowedOrigins.includes(req.headers.origin)) {
    return res.status(403).send('Invalid origin');
  }
  next();
});
```

### Insecure Deserialization

**Vulnerable:**
```javascript
const obj = eval(userInput);  // NEVER
const obj = new Function(userInput)();  // NEVER
```

**Secure:**
```javascript
const obj = JSON.parse(userInput);  // Safe for JSON
// Validate structure before using
if (!obj || typeof obj !== 'object') {
  throw new Error('Invalid input');
}
```

### Path Traversal

**Vulnerable:**
```javascript
const filePath = `./uploads/${req.query.filename}`;
fs.readFileSync(filePath);
// User passes: ../../../etc/passwd
```

**Secure:**
```javascript
const path = require('path');
const sanitizeFilename = require('sanitize-filename');

const safeName = sanitizeFilename(req.query.filename);
const filePath = path.join('./uploads', safeName);

// Ensure still in uploads directory
if (!filePath.startsWith(path.resolve('./uploads'))) {
  throw new Error('Invalid path');
}
```

## Secure Coding Patterns

### Password Handling

```javascript
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;

// Hash password
const hash = await bcrypt.hash(password, SALT_ROUNDS);

// Verify password
const valid = await bcrypt.compare(password, hash);
```

### JWT Implementation

```javascript
const jwt = require('jsonwebtoken');

// Sign (short expiry)
const token = jwt.sign(
  { userId: user.id },  // Minimal payload
  process.env.JWT_SECRET,
  { expiresIn: '15m' }
);

// Verify
const decoded = jwt.verify(token, process.env.JWT_SECRET);
```

### Rate Limiting

```javascript
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many attempts, try again later'
});

app.use('/auth/', authLimiter);
```

### Secure Headers

```javascript
const helmet = require('helmet');
app.use(helmet());  // Sets security headers automatically

// Manual headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});
```

## Environment & Secrets

### Never Commit Secrets

```bash
# .gitignore
.env
.env.local
*.pem
config/secrets.json
```

### Use Environment Variables

```javascript
// config.js
module.exports = {
  dbPassword: process.env.DB_PASSWORD,
  jwtSecret: process.env.JWT_SECRET,
  apiKey: process.env.API_KEY
};
```

### Secret Scanning

```bash
# Check for secrets before commit
git-secrets --scan

truffleHog --regex --entropy=False .
```

## Security Testing

### Static Analysis

```bash
# JavaScript/TypeScript
npm audit
yarn audit

# Snyk
snyk test
snyk code test  # SAST

# Semgrep
semgrep --config=auto .
```

### Dynamic Testing

```bash
# OWASP ZAP
zap.sh -daemon -quickurl http://localhost:3000

# Nikto
nikto -h http://localhost:3000
```

### Penetration Testing Checklist

- [ ] SQL injection on all input fields
- [ ] XSS in search boxes, comments, profiles
- [ ] CSRF on state-changing operations
- [ ] Broken authentication (password reset, login)
- [ ] Insecure direct object references
- [ ] Security misconfigurations (headers, errors)
- [ ] Sensitive data exposure
- [ ] Missing function-level access control

## Incident Response

### If You Find a Vulnerability

1. **Don't panic**
2. **Assess impact** - What data is at risk?
3. **Fix immediately** - Patch the vulnerability
4. **Rotate secrets** - Change passwords, keys, tokens
5. **Notify users** - If data was compromised
6. **Post-mortem** - Learn and prevent recurrence

### Security Monitoring

```javascript
// Log security events
logger.warn('Failed login attempt', {
  userId,
  ip: req.ip,
  userAgent: req.headers['user-agent']
});

// Alert on suspicious activity
if (failedAttempts > 5) {
  alertSecurityTeam(`Possible brute force: ${ip}`);
}
```

## Security Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [Mozilla Web Security](https://infosec.mozilla.org/guidelines/web_security)
- [Security Headers](https://securityheaders.com/)

## Tags

security, owasp, xss, csrf, sql-injection, authentication, authorization, encryption