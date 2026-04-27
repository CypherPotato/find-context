# find-context

Fast local scanner for agent instruction and context files.

`find-context` helps coding agents such as Codex, Claude Code, and Copilot find the Markdown instruction files they should read before starting work. It scans `.agents` folders, extracts a short description from each Markdown file, and prints a compact directory-by-directory index.

## Why

Agent workspaces often contain useful context in places like `.agents`, prompts, skills, `AGENTS.md`, or project-specific notes. The problem is not writing those files; it is making sure the agent discovers the relevant ones before changing code.

This CLI gives agents and developers a quick terminal command for surfacing that context.

## Features

- Always scans Markdown files recursively inside `$HOME/.agents`.
- Searches the current working directory recursively for `.agents` directories by default.
- Accepts one or more explicit workspace directories where `.agents` directories should be discovered.
- Reads Markdown files recursively only inside `.agents` directories.
- Extracts `description` from YAML-style front matter when available.
- Falls back to the first non-empty Markdown line.
- Skips heavy or generated directories such as `node_modules`, `.git`, `dist`, `build`, `coverage`, `bin`, and `obj`.
- Uses only Node.js built-in modules.

## Requirements

- Node.js 18, bun or deno.

## Installation

Choose your preferred package manager and install globally:

```bash
$ npm install -g find-context
$ bun install -g find-context
$ pnpm install -g find-context
```

## Usage

Scan the default locations:

```bash
$ find-context
```

Scan specific directories:

```bash
$ find-context /path/to/other/folder /folder2
```

When directories are provided, `find-context` still scans `$HOME/.agents` and then searches those directories for nested `.agents` folders.

Show help:

```bash
find-context --help
```

## Prompt for LLMs

Use a short instruction like this in your agent or project prompt:

```text
Before any answer or starting any task, run `find-context` in the repository root. Read the most relevant instruction, skill, and prompt files it returns, then follow those instructions while working on the task.
```
