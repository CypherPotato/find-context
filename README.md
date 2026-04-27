# find-context

> Fast local scanner for agent instruction and context files.

`find-context` walks a directory tree and reports every well-known file that an AI coding assistant or LLM-based agent uses for instructions or context — things like `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, and many more.

---

## Installation

```bash
# Global install
npm install -g find-context

# Or run without installing
npx find-context
```

---

## Usage

```
find-context [directory] [options]
```

| Argument / Option      | Description                                                         | Default       |
| ---------------------- | ------------------------------------------------------------------- | ------------- |
| `[directory]`          | Root directory to scan                                              | `.` (cwd)     |
| `-k, --kind <kind>`    | Filter by `instruction`, `context`, or `all`                        | `all`         |
| `-f, --format <fmt>`   | Output format: `list`, `json`, or `content`                         | `list`        |
| `-d, --depth <n>`      | Maximum directory depth (`0` = root only)                           | unlimited     |
| `--list-patterns`      | Print all built-in patterns and exit                                |               |
| `-V, --version`        | Print version and exit                                              |               |
| `-h, --help`           | Display help                                                        |               |

### Examples

```bash
# Scan current directory (default list output)
find-context

# Scan a specific project
find-context ~/projects/my-app

# JSON output — great for piping into other tools
find-context . --format json

# Show only instruction files
find-context . --kind instruction

# Print file contents
find-context . --format content

# Only look in the root (no recursion)
find-context . --depth 0

# See every pattern the scanner knows about
find-context --list-patterns
```

---

## Programmatic API

`find-context` also exports a Node.js API so you can use it from your own scripts or tools.

```typescript
import { scan, KNOWN_PATTERNS } from "find-context";

const files = await scan({
  root: "/path/to/project", // default: process.cwd()
  kind: "instruction",      // "instruction" | "context" | undefined (all)
  maxDepth: 2,              // optional depth limit
});

for (const file of files) {
  console.log(file.relativePath); // e.g. ".github/copilot-instructions.md"
  console.log(file.pattern.tool); // e.g. "GitHub Copilot"
  console.log(file.pattern.kind); // "instruction" | "context"
}
```

### Types

```typescript
interface FoundFile {
  absolutePath: string;
  relativePath: string;
  pattern: KnownPattern;
}

interface KnownPattern {
  tool: string;       // Human-readable tool name
  path: string;       // Relative path pattern (forward-slash)
  kind: FileKind;     // "instruction" | "context"
}

interface ScanOptions {
  root?: string;
  maxDepth?: number;
  kind?: "instruction" | "context";
}
```

---

## Recognised files

| Tool / Convention          | Path                                    | Kind        |
| -------------------------- | --------------------------------------- | ----------- |
| OpenAI Codex / Agents      | `AGENTS.md`                             | instruction |
| Anthropic Claude           | `CLAUDE.md`                             | instruction |
| Google Gemini              | `GEMINI.md`                             | instruction |
| Cursor AI                  | `.cursorrules`                          | instruction |
| Cline                      | `.clinerules`                           | instruction |
| Windsurf / Cascade         | `.windsurfrules`                        | instruction |
| Aider                      | `.aider.conf.yml`                       | instruction |
| Aider (conventions)        | `CONVENTIONS.md`                        | context     |
| System prompt              | `system-prompt.md`                      | instruction |
| System prompt              | `system-prompt.txt`                     | instruction |
| Context file               | `context.md`                            | context     |
| Context file               | `.context.md`                           | context     |
| GitHub Copilot             | `.github/copilot-instructions.md`       | instruction |
| GitHub Copilot (setup)     | `.github/copilot-setup-steps.yml`       | instruction |
| Continue.dev               | `.continue/config.json`                 | instruction |
| Continue.dev               | `.continue/config.yaml`                 | instruction |
| Cursor AI (rules)          | `.cursor/rules`                         | instruction |
| Zed AI                     | `.zed/settings.json`                    | instruction |
| VS Code (AI instructions)  | `.vscode/copilot-instructions.md`       | instruction |

---

## How it works

The scanner performs a **breadth-first, concurrent** directory traversal using `fs.promises`.  
It automatically prunes the walk at the depth of the deepest known pattern, so it never reads more of the filesystem than necessary.

---

## License

MIT
