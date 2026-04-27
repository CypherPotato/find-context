#!/usr/bin/env node
import { Command } from "commander";
import path from "path";
import fs from "fs/promises";
import { scan } from "./scanner.js";
import type { FoundFile } from "./scanner.js";
import { KNOWN_PATTERNS } from "./patterns.js";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("find-context")
  .description(
    "Fast local scanner for agent instruction and context files.\n\n" +
      "Searches a directory tree for well-known files used by AI coding\n" +
      "assistants and LLM-based agents (e.g. AGENTS.md, CLAUDE.md,\n" +
      ".cursorrules, .github/copilot-instructions.md, …)."
  )
  .version(pkg.version)
  .argument("[directory]", "Root directory to scan", ".")
  .option(
    "-k, --kind <kind>",
    'Filter by kind: "instruction", "context", or "all"',
    "all"
  )
  .option(
    "-f, --format <format>",
    'Output format: "list", "json", or "content"',
    "list"
  )
  .option(
    "-d, --depth <n>",
    "Maximum directory depth (default: unlimited)",
    (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0) {
        console.error(`error: --depth must be a non-negative integer, got "${v}"`);
        process.exit(1);
      }
      return n;
    }
  )
  .option("--list-patterns", "Print all known patterns and exit")
  .action(async (directory: string, opts: {
    kind: string;
    format: string;
    depth?: number;
    listPatterns?: boolean;
  }) => {
    if (opts.listPatterns) {
      printPatterns();
      return;
    }

    const kindOpt = opts.kind as "instruction" | "context" | "all";
    if (!["instruction", "context", "all"].includes(kindOpt)) {
      console.error(
        `error: --kind must be "instruction", "context", or "all", got "${opts.kind}"`
      );
      process.exit(1);
    }

    const formatOpt = opts.format;
    if (!["list", "json", "content"].includes(formatOpt)) {
      console.error(
        `error: --format must be "list", "json", or "content", got "${opts.format}"`
      );
      process.exit(1);
    }

    const root = path.resolve(directory);

    let files: FoundFile[];
    try {
      files = await scan({
        root,
        kind: kindOpt === "all" ? undefined : kindOpt,
        maxDepth: opts.depth,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`error: ${message}`);
      process.exit(1);
    }

    if (files.length === 0) {
      if (formatOpt !== "json") {
        console.log("No agent instruction or context files found.");
      } else {
        console.log("[]");
      }
      return;
    }

    switch (formatOpt) {
      case "list":
        printList(files);
        break;
      case "json":
        printJson(files);
        break;
      case "content":
        await printContent(files);
        break;
    }
  });

function printPatterns(): void {
  console.log("Known agent instruction / context file patterns:\n");
  const maxToolLen = Math.max(...KNOWN_PATTERNS.map((p) => p.tool.length));
  const maxPathLen = Math.max(...KNOWN_PATTERNS.map((p) => p.path.length));
  console.log(
    `  ${"Tool".padEnd(maxToolLen)}  ${"Path".padEnd(maxPathLen)}  Kind`
  );
  console.log(
    `  ${"─".repeat(maxToolLen)}  ${"─".repeat(maxPathLen)}  ${"─".repeat(11)}`
  );
  for (const p of KNOWN_PATTERNS) {
    console.log(
      `  ${p.tool.padEnd(maxToolLen)}  ${p.path.padEnd(maxPathLen)}  ${p.kind}`
    );
  }
}

function printList(files: FoundFile[]): void {
  for (const f of files) {
    const tag = f.pattern.kind === "instruction" ? "[instruction]" : "[context]    ";
    console.log(`${tag}  ${f.relativePath}  (${f.pattern.tool})`);
  }
}

function printJson(files: FoundFile[]): void {
  const output = files.map((f) => ({
    path: f.relativePath,
    absolutePath: f.absolutePath,
    tool: f.pattern.tool,
    kind: f.pattern.kind,
  }));
  console.log(JSON.stringify(output, null, 2));
}

async function printContent(files: FoundFile[]): Promise<void> {
  for (const f of files) {
    const separator = "=".repeat(72);
    console.log(separator);
    console.log(`File : ${f.relativePath}`);
    console.log(`Tool : ${f.pattern.tool}`);
    console.log(`Kind : ${f.pattern.kind}`);
    console.log(separator);
    try {
      const content = await fs.readFile(f.absolutePath, "utf8");
      console.log(content);
    } catch {
      console.log("(unable to read file)");
    }
    console.log();
  }
}

program.parse();
