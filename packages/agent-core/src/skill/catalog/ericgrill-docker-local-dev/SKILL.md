# Docker Local Development Setup

## Description

Standardized Docker setup for local development environments. Ensures consistency across team members and environments.

## When to Use

- Setting up new project development environments
- Onboarding new team members
- Debugging "works on my machine" issues
- Standardizing development stacks

## Quick Start

### 1. Create Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Development command
CMD ["npm", "run", "dev"]
```

### 2. Create docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
    depends_on:
      - db
      - redis

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: app_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### 3. Create .dockerignore

```
node_modules
npm-debug.log
Dockerfile
.dockerignore
.git
.env
.env.local
dist
build
.coverage
```

## Commands

```bash
# Build and start everything
docker-compose up --build

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f app

# Run command in container
docker-compose exec app npm test

# Stop everything
docker-compose down

# Reset (remove volumes)
docker-compose down -v
```

## Best Practices

1. **Use volume mounts** for hot reloading
2. **Multi-stage builds** for smaller production images
3. **Non-root user** for security
4. **Health checks** for dependencies
5. **Environment files** for secrets

## Debugging

```bash
# Shell into container
docker-compose exec app sh

# Check container status
docker-compose ps

# View resource usage
docker stats

# Clean up everything
docker system prune -a
```

## Tags

docker, development, local, setup, devops, containers
