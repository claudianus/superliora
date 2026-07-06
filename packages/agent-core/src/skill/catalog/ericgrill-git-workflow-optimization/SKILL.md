---
name: git-workflow-optimization
description: Git workflow optimization for Claude Code. Use when managing branches, creating commits, handling PRs, rebasing, or maintaining clean git history. Provides commands and patterns for efficient Git operations optimized for AI-assisted development.
catalogSource: ericgrill
catalogId: ericgrill-git-workflow-optimization
---

# Git Workflow Optimization for Claude Code

Efficient Git workflows optimized for Claude Code. Focuses on clean history, clear commits, and patterns that work well with AI-assisted development.

## Quick Start

### Daily Workflow
```bash
# Start of day - sync with main
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/my-feature

# Make changes, then commit
git add .
git commit -m "feat: add new feature"

# Push and create PR
git push -u origin feature/my-feature
gh pr create --title "feat: add new feature" --body "Description"
```

### End of Day
```bash
# Check status
git status

# Commit work in progress
git add .
git commit -m "wip: progress on feature"

# Push to remote
git push
```

## Branch Management

### Create Feature Branch
```bash
# From main
git checkout main
git pull origin main
git checkout -b feature/description

# From current branch
git checkout -b feature/description
```

### Branch Naming Conventions
```bash
# Features
feature/user-authentication
feature/add-payment-gateway

# Bug fixes
fix/login-error-message
fix/memory-leak-in-parser

# Hotfixes
hotfix/critical-security-patch

# Refactoring
refactor/extract-user-service

# Documentation
docs/update-api-reference
```

### List and Clean Branches
```bash
# List all branches
git branch -a

# List merged branches (safe to delete)
git branch --merged main

# Delete local branch
git branch -d feature/old-feature

# Delete remote branch
git push origin --delete feature/old-feature

# Clean up remote-tracking branches
git fetch --prune
```

## Commit Best Practices

### Conventional Commits
```bash
# Format: type(scope): description

# Types:
# feat: new feature
# fix: bug fix
# docs: documentation
# style: formatting, semicolons, etc
# refactor: code restructuring
# test: adding tests
# chore: maintenance tasks

# Examples:
git commit -m "feat(auth): add OAuth2 login"
git commit -m "fix(api): handle null response"
git commit -m "docs(readme): update installation steps"
git commit -m "refactor(utils): extract validation logic"
```

### Atomic Commits
```bash
# Good - one logical change per commit
git add src/auth/login.js
git commit -m "feat(auth): implement JWT token validation"

git add src/auth/login.test.js
git commit -m "test(auth): add tests for JWT validation"

# Bad - mixing unrelated changes
git add .
git commit -m "various changes"
```

### Commit Messages with Claude
```bash
# Generate commit message with Claude
claude "Write a conventional commit message for these changes:
$(git diff --staged)"

# Or use Claude to summarize
git diff --staged | claude "Summarize these changes as a commit message"
```

## Interactive Rebase

### Clean Up History Before PR
```bash
# Rebase last N commits
git rebase -i HEAD~5

# Commands in editor:
# p, pick = use commit
# r, reword = use commit, but edit message
# e, edit = use commit, but stop for amending
# s, squash = use commit, meld into previous
# f, fixup = like squash, but discard message
# d, drop = remove commit
```

### Squash WIP Commits
```bash
# Squash last 3 commits into one
git rebase -i HEAD~3
# Change 'pick' to 'squash' for commits 2 and 3
```

### Reorder Commits
```bash
git rebase -i HEAD~5
# Reorder lines in editor
```

### Split a Commit
```bash
# Start interactive rebase
git rebase -i HEAD~3
# Change 'pick' to 'edit' for commit to split

# Reset to before the commit
git reset HEAD^

# Stage and commit separately
git add file1.js
git commit -m "first part"
git add file2.js
git commit -m "second part"

# Continue rebase
git rebase --continue
```

## Stash Management

### Quick Stash
```bash
# Stash current changes
git stash push -m "WIP: working on feature"

# List stashes
git stash list

# Apply most recent stash
git stash pop

# Apply specific stash
git stash apply stash@{1}

# Drop a stash
git stash drop stash@{1}

# Clear all stashes
git stash clear
```

### Stash with Untracked Files
```bash
# Stash including untracked files
git stash push -u -m "description"

# Stash only untracked files
git stash push --include-untracked -m "description"
```

## Sync and Rebase

### Rebase onto Main
```bash
# Update main
git checkout main
git pull origin main

# Rebase feature branch
git checkout feature/my-feature
git rebase main

# If conflicts, resolve and continue
git add .
git rebase --continue

# Force push after rebase
git push --force-with-lease
```

### Pull with Rebase
```bash
# Configure default pull behavior
git config --global pull.rebase true

# Pull with rebase
git pull --rebase origin main
```

## Undo and Fix

### Amend Last Commit
```bash
# Add to last commit
git add .
git commit --amend --no-edit

# Change last commit message
git commit --amend -m "new message"

# Force push after amend
git push --force-with-lease
```

### Reset Commands
```bash
# Soft reset - keep changes staged
git reset --soft HEAD~1

# Mixed reset - keep changes unstaged (default)
git reset HEAD~1

# Hard reset - discard changes
# DANGEROUS - cannot undo
git reset --hard HEAD~1
```

### Restore Files
```bash
# Restore file to last commit
git restore filename.js

# Restore file from specific commit
git restore --source=abc123 filename.js

# Unstage file
git restore --staged filename.js
```

## Working with Remotes

### Multiple Remotes
```bash
# Add upstream remote
git remote add upstream https://github.com/original/repo.git

# Fetch from upstream
git fetch upstream

# Rebase onto upstream main
git rebase upstream/main

# Push to your fork
git push origin main
```

### Sync Fork
```bash
# Fetch upstream
git fetch upstream

# Checkout main
git checkout main

# Merge upstream changes
git merge upstream/main

# Push to your fork
git push origin main
```

## PR Workflow

### Create PR with CLI
```bash
# Create PR
gh pr create \
  --title "feat: add user authentication" \
  --body "Implements OAuth2 login flow

- Adds login page
- Integrates with Google OAuth
- Stores tokens securely

Closes #123" \
  --base main

# Create draft PR
gh pr create --draft --title "WIP: feature"
```

### Update PR After Review
```bash
# Make changes
git add .
git commit -m "fix: address review comments"

# Squash fix commits
git rebase -i HEAD~3

# Force push
git push --force-with-lease
```

### Review PR
```bash
# Checkout PR locally
gh pr checkout 123

# View PR diff
gh pr diff 123

# View PR checks
gh pr checks 123

# Merge PR
gh pr merge 123 --squash
```

## Cherry-Pick and Backport

### Cherry-Pick Commits
```bash
# Cherry-pick single commit
git cherry-pick abc123

# Cherry-pick range
git cherry-pick abc123^..def456

# Cherry-pick without committing
git cherry-pick -n abc123
```

### Backport Fix
```bash
# Create backport branch from release branch
git checkout release/v1.2
git checkout -b backport/fix-for-v1.2

# Cherry-pick fix from main
git cherry-pick abc123

# Push and create PR
git push -u origin backport/fix-for-v1.2
gh pr create --base release/v1.2
```

## Bisect for Debugging

### Find Bug with Git Bisect
```bash
# Start bisect
git bisect start

# Mark current commit as bad
git bisect bad

# Mark known good commit
git bisect good v1.0.0

# Test each commit, mark good or bad
git bisect good  # or bad

# When done, reset
git bisect reset
```

### Automated Bisect
```bash
# Run script to test each commit
git bisect start HEAD v1.0.0
git bisect run npm test
```

## Aliases for Speed

### Useful Git Aliases
```bash
# Add to ~/.gitconfig
[alias]
    # Short commands
    st = status -sb
    co = checkout
    br = branch
    ci = commit
    unstage = restore --staged
    last = log -1 HEAD
    
    # Visual log
    lg = log --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit
    
    # Today's commits
    today = log --since="00:00:00" --author="$(git config user.name)" --pretty=format:'%h %s'
    
    # Undo last commit (keep changes)
    undo = reset HEAD~1 --mixed
    
    # Show diff for last commit
    diff-last = diff HEAD~1 HEAD
    
    # Delete merged branches
    cleanup = !git branch --merged | grep -v "\\*\\|main\\|master\\|develop" | xargs -n 1 git branch -d
```

## Claude-Specific Workflows

### Analyze Commit History
```bash
# Ask Claude to review recent commits
claude "Review these recent commits for issues:
$(git log --oneline -20)"
```

### Generate Release Notes
```bash
# Generate notes from commits
claude "Generate release notes from these commits:
$(git log --oneline v1.0.0..HEAD)"
```

### Review Branch Changes
```bash
# Review all changes in branch
claude "Review these changes:
$(git diff main...HEAD)"
```

## Troubleshooting

### Resolve Merge Conflicts
```bash
# See conflicted files
git status

# See conflict details
git diff

# Resolve conflicts in specific file
# Edit file, then:
git add resolved-file.js

# Continue after resolving
git rebase --continue
# or
git merge --continue

# Abort and start over
git rebase --abort
# or
git merge --abort
```

### Recover Lost Commits
```bash
# View reflog
git reflog

# Recover from reflog
git checkout HEAD@{5}

# Or reset to specific reflog entry
git reset --hard HEAD@{5}
```

### Fix Diverged Branches
```bash
# Fetch latest
git fetch origin

# Reset to match remote (DANGEROUS)
git reset --hard origin/main

# Or rebase onto remote
git rebase origin/main
```
