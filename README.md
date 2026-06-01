# find-context

Fast local scanner for agent instruction and context files.

`find-context` helps coding agents such as Codex, Claude Code, and Copilot find the Markdown instruction files they should read before starting work. It scans `.agents` folders and `AGENTS.md` files, extracts short descriptions, and prints a compact directory-by-directory index. When search terms are provided, it returns only the most relevant context.

## Why

Agent workspaces often contain useful context in places like `.agents`, prompts, skills, `AGENTS.md`, or project-specific notes. The problem is not writing those files; it is making sure the agent discovers the relevant ones before changing code.

This CLI gives agents and developers a quick terminal command for surfacing that context.

## Features

- Always scans `$HOME/.agents` and `$PWD`.
- Finds `AGENTS.md` recursively.
- Lists Markdown files recursively when the directory path contains `.agents`.
- Accepts search terms to filter and rank relevant context files.
- Extracts `description` from YAML-style front matter when available.
- Falls back to the first Markdown line.
- Uses Cloudflare Workers AI reranking when credentials are configured.
- Uses an optimized local lexical reranker when Cloudflare credentials are not set.
- Deduplicates files found through overlapping roots or symlinked directories.
- Uses only Node.js built-in modules.

## Requirements

- Node.js 18 or newer.
- npm, bun, or pnpm for installation.

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
find-context
```

`find-context` always searches `$HOME/.agents` and `$PWD`. Without search terms, it returns all discovered `AGENTS.md` files and Markdown files inside `.agents` directories.

Filter context by search terms:

```bash
find-context "frontend ui"
```

With search terms, `find-context` ranks matching files and prints the most relevant entries grouped by directory:

```text
Directory ~/.agents/workflows: /create-website.md: Use to create simple sites...
Directory ./project: /AGENTS.md: Project-specific instructions...
```

Show help:

```bash
find-context --help
```

## Relevance ranking

Search terms are first matched locally against file names, descriptions, and paths. If Cloudflare credentials are configured, `find-context` sends the best candidate contexts to Workers AI reranking and uses the model response to order the results.

If Cloudflare credentials are missing or the API cannot return usable results, `find-context` falls back to local ranking. The local fallback uses lexical token matching, fuzzy matching for small typos, and proximity scoring so related terms appearing close together are ranked higher.

## Environment variables

Cloudflare reranking is optional. Leave these variables unset to use only the local lexical fallback.

| Variable | Description | Example |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID used for Workers AI reranking. | `0123456789abcdef` |
| `CLOUDFLARE_AUTH_TOKEN` | API token with access to Workers AI. | `cf_api_token` |

## Development

Run the test suite:

```bash
npm test
```

Check JavaScript syntax for source and test files:

```bash
npm run check
```

## Prompt for LLMs

Use a short instruction like this in your agent or project prompt:

```text
IMPORTANT RULE: before any response or before starting any task, run the `find-context` tool to find relevant context for what you are going to do, such as skills, instructions, and workflows. Example: `find-context "relevant terms technologies and stacks"`. You can invoke this CLI tool even during the conversation, like when changing topics or objectives. When finding relevant context, read the relevant files provided by find-context to obtain context, skills, instructions and guidelines before executing the user task.
```
