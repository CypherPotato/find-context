# find-context

Fast local scanner for agent instruction and context files.

`find-context` helps coding agents such as Codex, Claude Code, and Copilot find the Markdown instruction files they should read before starting work. It scans `.agents` folders, extracts a short description from each Markdown file, and prints a compact directory-by-directory index.

## Why

Agent workspaces often contain useful context in places like `.agents`, prompts, skills, `AGENTS.md`, or project-specific notes. The problem is not writing those files; it is making sure the agent discovers the relevant ones before changing code.

This CLI gives agents and developers a quick terminal command for surfacing that context.

## Features

- Always scans `$HOME/.agents` and `$PWD`.
- Finds `AGENTS.md` recursively.
- Lists Markdown files recursively when the directory path contains `.agents`.
- Ignores explicit directory arguments.
- Extracts `description` from YAML-style front matter when available.
- Falls back to the first Markdown line.
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

`find-context` always searches `$HOME/.agents` and `$PWD`. Extra arguments are ignored. It returns `AGENTS.md` files found recursively and Markdown files found inside directories whose path contains `.agents`.

Show help:

```bash
find-context --help
```

## Prompt for LLMs

Use a short instruction like this in your agent or project prompt:

```text
Important rule: before any answer or starting any task, run `find-context` in the repository root. Read the most relevant instruction, skill, and prompt files it returns, then follow those instructions while working on the task.
```
