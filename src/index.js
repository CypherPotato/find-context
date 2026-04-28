import { scanInstructionFiles } from "./scanner.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const directories = await scanInstructionFiles();

for (const { directory, files } of directories) {
  console.log(`Directory ${directory}:`);

  for (const file of files) {
    console.log(`- ${file.name}: ${optimizeText(file.description)}`);
  }
}

function optimizeText(text) {
  return text
    ?.normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function printHelp() {
  console.log(`find-context

Usage:
  find-context [ignored arguments...]

Options:
  -h, --help  Show this help message.

find-context always scans:
  - $HOME/.agents
  - $PWD

Arguments other than help are ignored. It lists AGENTS.md files found
recursively and Markdown files inside directories containing .agents.
Descriptions come from front matter description fields or from the first
Markdown line, limited to 120 characters plus ellipsis.`);
}
