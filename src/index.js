import { homedir } from "node:os";
import path from "node:path";
import { scanInstructionFiles } from "./scanner.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const roots = args.length > 0
  ? [path.join(homedir(), ".agents"), ...args]
  : undefined;
const directories = await scanInstructionFiles(roots);

for (const { directory, files } of directories) {
  console.log(`Directory ${directory}:`);

  for (const file of files) {
    console.log(`- ${file.name}: ${file.description}`);
  }
}

function printHelp() {
  console.log(`find-context

Usage:
  find-context [directories...]

Options:
  -h, --help  Show this help message.

When no directory is provided, find-context scans:
  - $HOME/.agents
  - .agents directories found under $PWD

It recursively lists Markdown files only inside .agents directories and extracts
descriptions from front matter description fields or from the first Markdown
line, limited to 180 characters.`);
}
