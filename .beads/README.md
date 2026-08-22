# Tasks - AI-Native Issue Tracking

Welcome to Tasks! This repository uses **Tasks** for issue tracking - a modern, AI-native tool designed to live directly in your codebase alongside your code.

## What is Tasks?

Tasks is issue tracking that lives in your repo, making it perfect for AI coding agents and developers who want their issues close to their code. No web UI required - everything works through the CLI and integrates seamlessly with git.

**Learn more:** [github.com/steveyegge/tasks](https://github.com/steveyegge/tasks)

## Quick Start

### Essential Commands

```bash
# Create new issues
bd create "Add user authentication"

# View all issues
bd list

# View issue details
bd show <issue-id>

# Update issue status
bd update <issue-id> --claim
bd update <issue-id> --status done

# Sync with Dolt remote
bd dolt push
```

### Working with Issues

Issues in Tasks are:
- **Git-native**: Stored in Dolt database with version control and branching
- **AI-friendly**: CLI-first design works perfectly with AI coding agents
- **Branch-aware**: Issues can follow your branch workflow
- **Sync-ready**: Uses Dolt remotes for backup and team sharing

## Why Tasks?

✨ **AI-Native Design**
- Built specifically for AI-assisted development workflows
- CLI-first interface works seamlessly with AI coding agents
- No context switching to web UIs

🚀 **Developer Focused**
- Issues live in your repo, right next to your code
- Works offline, syncs when you push
- Fast, lightweight, and stays out of your way

🔧 **Git Integration**
- Dolt-native sync via bd dolt push / bd dolt pull
- Branch-aware issue tracking
- Dolt-native three-way merge resolution

## Get Started with Tasks

Try Tasks in your own projects:

```bash
# Install Tasks
curl -sSL https://raw.githubusercontent.com/steveyegge/tasks/main/scripts/install.sh | bash

# Initialize in your repo
bd init

# Create your first issue
bd create "Try out Tasks"
```

## Learn More

- **Documentation**: [github.com/steveyegge/tasks/docs](https://github.com/steveyegge/tasks/tree/main/docs)
- **Quick Start Guide**: Run `bd quickstart`
- **Examples**: [github.com/steveyegge/tasks/examples](https://github.com/steveyegge/tasks/tree/main/examples)

---

*Tasks: Issue tracking that moves at the speed of thought* ⚡
