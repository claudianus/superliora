# Git Workflow Optimization

Efficient Git workflows for feature development, code review, and collaboration.

## When to Use

- Starting new features
- Managing pull requests
- Rebasing and conflict resolution
- Release management
- Repository maintenance

## Installation

No installation required - Git workflow skill uses standard git commands.

## Configuration

### Recommended Git Config

```bash
# Better git log
git config --global alias.lg "log --color --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit"

# Better git diff
git config --global alias.df "diff --color-words"

# Safe force push (only if you know what you're doing)
git config --global alias.please "push --force-with-lease"

# Show recent branches
git config --global alias.branches "branch -a --sort=-committerdate | head -20"
```

## Core Workflows

### Feature Branch Workflow

```bash
# 1. Start fresh from main
git checkout main
git pull origin main

# 2. Create feature branch
git checkout -b feature/descriptive-name

# 3. Make commits (atomic, descriptive)
git add -p  # Stage interactively
git commit -m "feat: add user authentication

- Implement JWT token generation
- Add login/logout endpoints
- Include password hashing with bcrypt

Closes #123"

# 4. Push and create PR
git push -u origin feature/descriptive-name
gh pr create --title "feat: add user authentication" --body "..."

# 5. After PR approval, merge
git checkout main
git pull origin main
git merge --no-ff feature/descriptive-name
git push origin main
```

### Commit Message Format (Conventional Commits)

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting (no code change)
- `refactor`: Code change (not feat/fix)
- `test`: Adding tests
- `chore`: Build/process changes

**Examples**:
```
feat(api): add rate limiting middleware

fix(auth): resolve token expiration bug

refactor(db): extract connection pool logic

docs(readme): update installation instructions
```

### Interactive Rebase for Clean History

```bash
# Rebase last 5 commits
git rebase -i HEAD~5

# Commands in editor:
# p, pick = use commit
# r, reword = use commit, edit message
# e, edit = use commit, stop for amending
# s, squash = meld into previous commit
# f, fixup = like squash, discard message
# d, drop = remove commit

# Push rebased branch (if already pushed)
git push --force-with-lease
```

### Conflict Resolution

```bash
# During rebase/merge with conflicts
git status  # See conflicted files

# Open each conflicted file and resolve markers:
# <<<<<<< HEAD
# Your changes
# =======
# Incoming changes
# >>>>>>> branch-name

# After resolving
git add <resolved-file>
git rebase --continue  # or git merge --continue
```

## Advanced Workflows

### Stashing for Context Switching

```bash
# Quick stash
git stash push -m "WIP: user profile page"

# Stash specific files
git stash push -m "partial work" src/components/

# List stashes
git stash list

# Apply specific stash
git stash apply stash@{2}

# Pop (apply and remove)
git stash pop
```

### Selective Commits

```bash
# Stage parts of a file
git add -p src/file.js

# Options:
# y - stage this hunk
# n - don't stage this hunk
# s - split into smaller hunks
# e - edit the hunk manually
# ? - help
```

### Bisect for Finding Bugs

```bash
# Binary search through history to find bad commit
git bisect start
git bisect bad HEAD        # Current is broken
git bisect good v1.0.0     # This version worked

# Git checks out middle commit
# Test it, then mark:
git bisect good    # or
git bisect bad

# Repeat until found...
git bisect reset   # When done
```

### Cherry-Picking

```bash
# Apply specific commit to current branch
git cherry-pick abc123

# Cherry-pick without committing
git cherry-pick -n abc123
```

## Collaboration Patterns

### Syncing Fork with Upstream

```bash
# Add upstream remote
git remote add upstream https://github.com/original-owner/original-repo.git

# Fetch and merge
git fetch upstream
git checkout main
git merge upstream/main
```

### Code Review Updates

```bash
# After PR feedback, update commits
git checkout feature-branch
git add .
git commit --amend --no-edit  # Add to last commit
git push --force-with-lease

# Or for multiple commits
git rebase -i HEAD~3
# mark commits for 'edit', then:
git commit --amend
git rebase --continue
```

## Safety & Recovery

### Undoing Things

```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Undo uncommitted changes in file
git checkout -- src/file.js

# Undo staged file
git reset HEAD src/file.js

# Recover deleted branch
git reflog  # Find the SHA
git checkout -b branch-name SHA
```

### Reflog (Git's Safety Net)

```bash
# See all recent git operations
git reflog

# Recover from bad rebase
git reset --hard HEAD@{2}  # Go back 2 operations
```

## Repository Maintenance

### Cleaning Up

```bash
# Remove untracked files (dry run first)
git clean -n
git clean -f

# Remove untracked directories too
git clean -fd

# Prune remote branches
git remote prune origin

# Garbage collect
git gc
```

### Finding Things

```bash
# Search commit messages
git log --all --grep="search term"

# Search code in history
git log -S "function_name" --oneline

# Who wrote this line?
git blame src/file.js

# Find commit by content
git log --all -p | grep -B5 -A5 "search pattern"
```

## Examples

### Hotfix Workflow

```bash
# Critical bug in production
git checkout main
git pull origin main
git checkout -b hotfix/critical-bug

# Fix the bug
git add .
git commit -m "fix: resolve critical login bug

- Null pointer when user has no profile
- Added defensive check

Hotfix for PROD-INCIDENT-42"

# Deploy immediately
git push origin hotfix/critical-bug
gh pr create --base main --title "HOTFIX: login bug"
# Get emergency review, merge, deploy

# Also apply to development branch
git checkout develop
git cherry-pick <hotfix-commit>
```

### Release Branch Workflow

```bash
# Prepare release
git checkout -b release/v2.1.0 develop

# Version bump, final fixes
git commit -am "chore: bump version to 2.1.0"

# Merge to main
git checkout main
git merge --no-ff release/v2.1.0
git tag -a v2.1.0 -m "Release version 2.1.0"

# Merge back to develop
git checkout develop
git merge --no-ff release/v2.1.0
git branch -d release/v2.1.0
```

## Metadata
- **Author**: @stencilwashcoder
- **Framework**: Universal
- **Version**: 1.0.0
- **Tags**: git, workflow, collaboration, version-control