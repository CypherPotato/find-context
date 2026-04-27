/**
 * Known agent instruction and context file patterns.
 *
 * Each entry defines a well-known file used by AI coding assistants,
 * agents, or LLM-based tools to provide instructions or context.
 */

export type FileKind = "instruction" | "context";

export interface KnownPattern {
  /** Human-readable name of the tool / convention */
  tool: string;
  /** The exact relative path from a scanned directory root */
  path: string;
  /** Whether this is an instruction file or a context file */
  kind: FileKind;
}

/**
 * Ordered list of known agent instruction / context file patterns.
 * Patterns are matched against relative paths produced during the
 * directory traversal, so they must use forward-slash separators.
 */
export const KNOWN_PATTERNS: KnownPattern[] = [
  // ── Exact root-level filenames ──────────────────────────────────────
  { tool: "OpenAI Codex / Agents", path: "AGENTS.md", kind: "instruction" },
  { tool: "Anthropic Claude", path: "CLAUDE.md", kind: "instruction" },
  { tool: "Google Gemini", path: "GEMINI.md", kind: "instruction" },
  { tool: "Cursor AI", path: ".cursorrules", kind: "instruction" },
  { tool: "Cline", path: ".clinerules", kind: "instruction" },
  { tool: "Windsurf / Cascade", path: ".windsurfrules", kind: "instruction" },
  { tool: "Aider", path: ".aider.conf.yml", kind: "instruction" },
  { tool: "Aider (conventions)", path: "CONVENTIONS.md", kind: "context" },
  { tool: "System prompt", path: "system-prompt.md", kind: "instruction" },
  { tool: "System prompt", path: "system-prompt.txt", kind: "instruction" },
  { tool: "Context file", path: "context.md", kind: "context" },
  { tool: "Context file", path: ".context.md", kind: "context" },
  // ── Files nested under well-known directories ───────────────────────
  {
    tool: "GitHub Copilot",
    path: ".github/copilot-instructions.md",
    kind: "instruction",
  },
  {
    tool: "GitHub Copilot (setup)",
    path: ".github/copilot-setup-steps.yml",
    kind: "instruction",
  },
  {
    tool: "Continue.dev",
    path: ".continue/config.json",
    kind: "instruction",
  },
  {
    tool: "Continue.dev",
    path: ".continue/config.yaml",
    kind: "instruction",
  },
  { tool: "Cursor AI (rules)", path: ".cursor/rules", kind: "instruction" },
  { tool: "Zed AI", path: ".zed/settings.json", kind: "instruction" },
  {
    tool: "VS Code (AI instructions)",
    path: ".vscode/copilot-instructions.md",
    kind: "instruction",
  },
];

/**
 * Returns the set of root-level directory names that might contain
 * relevant nested files, so the scanner can prune the traversal.
 */
export function wellKnownDirectories(): Set<string> {
  const dirs = new Set<string>();
  for (const p of KNOWN_PATTERNS) {
    const first = p.path.split("/")[0];
    if (first.startsWith(".") || first === first.toUpperCase()) {
      dirs.add(first);
    }
  }
  return dirs;
}
