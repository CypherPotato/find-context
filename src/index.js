import { scanInstructionFiles } from "./scanner.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.length > 0) {
  console.error("find-context does not accept directory arguments. It always scans $HOME and $PWD.");
  process.exit(1);
}

const directories = await scanInstructionFiles();

for (const { directory, files } of directories) {
  console.log(`Directory ${directory}:`);

  for (const file of files) {
    console.log(`- ${file.name}: ${file.description}`);
  }
}

function printHelp() {
  console.log(`find-context

Usage:
  find-context

Options:
  -h, --help  Show this help message.

find-context always scans:
  - $HOME
  - $PWD

It lists AGENTS.md files found recursively and Markdown files inside .agents
directories. Descriptions come from front matter description fields or from the
first Markdown line, limited to 180 characters.`);
}
