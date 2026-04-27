import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { scan } from "../scanner.js";
import { KNOWN_PATTERNS } from "../patterns.js";

// ── helpers ──────────────────────────────────────────────────────────────────

async function createFixture(
  files: Record<string, string>
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "find-context-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }
  return dir;
}

async function removeFixture(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("KNOWN_PATTERNS", () => {
  it("should have at least one instruction pattern", () => {
    const instructions = KNOWN_PATTERNS.filter((p) => p.kind === "instruction");
    expect(instructions.length).toBeGreaterThan(0);
  });

  it("should have at least one context pattern", () => {
    const contexts = KNOWN_PATTERNS.filter((p) => p.kind === "context");
    expect(contexts.length).toBeGreaterThan(0);
  });

  it("should have no duplicate paths", () => {
    const paths = KNOWN_PATTERNS.map((p) => p.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it("should contain well-known AI tool patterns", () => {
    const paths = KNOWN_PATTERNS.map((p) => p.path);
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain(".cursorrules");
    expect(paths).toContain(".github/copilot-instructions.md");
  });
});

describe("scan()", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = "";
  });

  afterEach(async () => {
    if (tmpDir) {
      await removeFixture(tmpDir);
    }
  });

  it("returns an empty array when no known files are present", async () => {
    tmpDir = await createFixture({
      "README.md": "# readme",
      "src/app.ts": "console.log('hello')",
    });

    const results = await scan({ root: tmpDir });
    expect(results).toEqual([]);
  });

  it("detects AGENTS.md in the root", async () => {
    tmpDir = await createFixture({
      "AGENTS.md": "You are a helpful agent.",
    });

    const results = await scan({ root: tmpDir });
    expect(results).toHaveLength(1);
    expect(results[0].relativePath).toBe("AGENTS.md");
    expect(results[0].pattern.kind).toBe("instruction");
    expect(results[0].pattern.tool).toMatch(/OpenAI/i);
  });

  it("detects CLAUDE.md in the root", async () => {
    tmpDir = await createFixture({
      "CLAUDE.md": "Claude instructions here.",
    });

    const results = await scan({ root: tmpDir });
    expect(results).toHaveLength(1);
    expect(results[0].relativePath).toBe("CLAUDE.md");
  });

  it("detects .cursorrules in the root", async () => {
    tmpDir = await createFixture({
      ".cursorrules": "use TypeScript strict mode",
    });

    const results = await scan({ root: tmpDir });
    expect(results).toHaveLength(1);
    expect(results[0].relativePath).toBe(".cursorrules");
  });

  it("detects .github/copilot-instructions.md", async () => {
    tmpDir = await createFixture({
      ".github/copilot-instructions.md": "# Copilot instructions",
    });

    const results = await scan({ root: tmpDir });
    expect(results).toHaveLength(1);
    expect(results[0].relativePath).toBe(".github/copilot-instructions.md");
  });

  it("detects multiple files in one scan", async () => {
    tmpDir = await createFixture({
      "AGENTS.md": "agents",
      "CLAUDE.md": "claude",
      ".cursorrules": "cursor",
      ".github/copilot-instructions.md": "copilot",
    });

    const results = await scan({ root: tmpDir });
    const paths = results.map((r) => r.relativePath);
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain(".cursorrules");
    expect(paths).toContain(".github/copilot-instructions.md");
  });

  it("filters by kind=instruction", async () => {
    tmpDir = await createFixture({
      "AGENTS.md": "agents",
      "context.md": "context",
    });

    const results = await scan({ root: tmpDir, kind: "instruction" });
    expect(results.every((r) => r.pattern.kind === "instruction")).toBe(true);
    expect(results.map((r) => r.relativePath)).toContain("AGENTS.md");
    expect(results.map((r) => r.relativePath)).not.toContain("context.md");
  });

  it("filters by kind=context", async () => {
    tmpDir = await createFixture({
      "AGENTS.md": "agents",
      "context.md": "context",
    });

    const results = await scan({ root: tmpDir, kind: "context" });
    expect(results.every((r) => r.pattern.kind === "context")).toBe(true);
    expect(results.map((r) => r.relativePath)).toContain("context.md");
    expect(results.map((r) => r.relativePath)).not.toContain("AGENTS.md");
  });

  it("respects maxDepth=0 (root only)", async () => {
    tmpDir = await createFixture({
      "AGENTS.md": "root level",
      ".github/copilot-instructions.md": "nested",
    });

    const results = await scan({ root: tmpDir, maxDepth: 0 });
    const paths = results.map((r) => r.relativePath);
    expect(paths).toContain("AGENTS.md");
    expect(paths).not.toContain(".github/copilot-instructions.md");
  });

  it("respects maxDepth=1 (one level deep)", async () => {
    tmpDir = await createFixture({
      "AGENTS.md": "root level",
      ".github/copilot-instructions.md": "one level deep",
    });

    const results = await scan({ root: tmpDir, maxDepth: 1 });
    const paths = results.map((r) => r.relativePath);
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain(".github/copilot-instructions.md");
  });

  it("returns absolute paths that exist on disk", async () => {
    tmpDir = await createFixture({
      "CLAUDE.md": "test",
    });

    const results = await scan({ root: tmpDir });
    expect(results).toHaveLength(1);

    const stat = await fs.stat(results[0].absolutePath);
    expect(stat.isFile()).toBe(true);
  });

  it("results are sorted by relative path", async () => {
    tmpDir = await createFixture({
      "CLAUDE.md": "claude",
      "AGENTS.md": "agents",
      ".cursorrules": "cursor",
    });

    const results = await scan({ root: tmpDir });
    const paths = results.map((r) => r.relativePath);
    expect(paths).toEqual([...paths].sort());
  });

  it("ignores files that match a known name but are directories", async () => {
    tmpDir = await createFixture({
      "AGENTS.md/placeholder": "should not match",
    });

    const results = await scan({ root: tmpDir });
    expect(results).toHaveLength(0);
  });

  it("skips unreadable directories without throwing", async () => {
    tmpDir = await createFixture({
      "AGENTS.md": "present",
    });

    const lockedDir = path.join(tmpDir, "locked");
    await fs.mkdir(lockedDir);
    await fs.chmod(lockedDir, 0o000);

    try {
      const results = await scan({ root: tmpDir });
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain("AGENTS.md");
    } finally {
      // Restore permissions so cleanup works.
      await fs.chmod(lockedDir, 0o755);
    }
  });
});
