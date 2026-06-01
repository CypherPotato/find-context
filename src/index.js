import path from "node:path";
import { selectRelevantDirectories } from "./ranker.js";
import { scanInstructionFiles } from "./scanner.js";

const DESCRIPTION_LIMIT = 120;
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const directories = await scanInstructionFiles();
const resultDirectories = await selectRelevantDirectories(directories, {
  args,
  compactPath: toCompactPath
});

for (const { directory, files } of resultDirectories) {
  const entries = files
    .map((file) => `/${file.name}: ${optimizeText(file.description)}`)
    .join(", ");

  console.log(`Directory ${toCompactPath(directory)}: ${entries}`);
}

function optimizeText(text) {
  const optimizedText = text
    ?.replace(/\s+/g, " ")
    .trim();

  return optimizedText.length > DESCRIPTION_LIMIT
    ? `${optimizedText.slice(0, DESCRIPTION_LIMIT)}...`
    : optimizedText;
}

function printHelp() {
  console.log(`find-context

Usage:
  find-context [search terms...]

Options:
  -h, --help  Show this help message.

find-context always scans:
  - $HOME/.agents
  - $PWD

Without search terms, it lists AGENTS.md files found recursively and
Markdown files inside directories containing .agents. With search terms,
it shows the most relevant matching files only. If CLOUDFLARE_ACCOUNT_ID
and CLOUDFLARE_AUTH_TOKEN are set, matching uses Cloudflare Workers AI
rerank with up to 5,000 Markdown documents; otherwise it uses local search.
Descriptions come from front matter description fields or from the first
Markdown line, limited to 120 characters plus ellipsis.`);
}

function toCompactPath(directory) {
  const home = process.env.HOME || process.env.USERPROFILE;
  const cwdRelativePath = path.relative(process.cwd(), directory);

  if (cwdRelativePath === "") {
    return ".";
  }

  if (!cwdRelativePath.startsWith("..") && !path.isAbsolute(cwdRelativePath)) {
    return `./${cwdRelativePath.replaceAll(path.sep, "/")}`;
  }

  if (home) {
    const homeRelativePath = path.relative(home, directory);

    if (homeRelativePath === "") {
      return "~";
    }

    if (!homeRelativePath.startsWith("..") && !path.isAbsolute(homeRelativePath)) {
      return `~/${homeRelativePath.replaceAll(path.sep, "/")}`;
    }
  }

  return directory;
}
