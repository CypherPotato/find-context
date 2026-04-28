import { constants } from "node:fs";
import { access, open, opendir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const DESCRIPTION_LIMIT = 180;
const READ_LIMIT = 16 * 1024;

const ignoredDirectoryNames = new Set([
  ".cache",
  ".git",
  ".hg",
  ".next",
  ".nuxt",
  ".pnpm-store",
  ".svelte-kit",
  ".svn",
  ".turbo",
  ".venv",
  ".vs",
  ".vscode-test",
  "__pycache__",
  "artifacts",
  "bin",
  "bower_components",
  "build",
  "coverage",
  "debug",
  "dist",
  "logs",
  "node_modules",
  "obj",
  "out",
  "target",
  "tmp",
  "vendor"
]);

export function getDefaultRoots({ cwd = process.cwd(), home = homedir() } = {}) {
  return [home, cwd];
}

export async function scanInstructionFiles(options = {}) {
  const directories = new Map();
  const seenInstructionFiles = new Set();

  for (const root of getDefaultRoots(options)) {
    const normalizedRoot = path.resolve(root);

    if (!await canRead(normalizedRoot)) {
      continue;
    }

    await scanDirectory(normalizedRoot, directories, seenInstructionFiles);
  }

  return [...directories.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([directory, files]) => ({
      directory,
      files: files.sort((left, right) => left.name.localeCompare(right.name))
    }));
}

async function scanDirectory(directory, directories, seenInstructionFiles, insideAgents = isAgentsDirectory(directory)) {
  let handle;

  try {
    handle = await opendir(directory);
  } catch {
    return;
  }

  for await (const entry of handle) {
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        const entryPath = path.join(directory, entry.name);

        await scanDirectory(
          entryPath,
          directories,
          seenInstructionFiles,
          insideAgents || isAgentsDirectory(entryPath)
        );
      }

      continue;
    }

    if (!entry.isFile() || !isInstructionFile(entry, insideAgents)) {
      continue;
    }

    const filePath = path.join(directory, entry.name);
    const fileKey = await getRealPathKey(filePath);

    if (seenInstructionFiles.has(fileKey)) {
      continue;
    }

    seenInstructionFiles.add(fileKey);
    const description = await readDescription(filePath);

    if (!directories.has(directory)) {
      directories.set(directory, []);
    }

    directories.get(directory).push({
      name: entry.name,
      description
    });
  }
}

function isAgentsDirectory(directory) {
  return path.basename(directory).toLowerCase() === ".agents";
}

function isInstructionFile(entry, insideAgents) {
  if (entry.name.toLowerCase() === "agents.md") {
    return true;
  }

  return insideAgents && path.extname(entry.name).toLowerCase() === ".md";
}

export async function readDescription(filePath) {
  const markdown = await readStart(filePath);
  const frontMatterDescription = readFrontMatterDescription(markdown);

  return normalizeDescription(frontMatterDescription ?? readFirstMarkdownLine(markdown));
}

async function readStart(filePath) {
  let file;

  try {
    file = await open(filePath, constants.O_RDONLY);
    const buffer = Buffer.allocUnsafe(READ_LIMIT);
    const { bytesRead } = await file.read(buffer, 0, READ_LIMIT, 0);

    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return "";
  } finally {
    await file?.close();
  }
}

function readFrontMatterDescription(markdown) {
  if (!markdown.startsWith("---")) {
    return null;
  }

  const lines = markdown.split(/\r?\n/);

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trim() === "---") {
      return null;
    }

    const match = line.match(/^description\s*:\s*(?<value>.*)$/i);

    if (match?.groups?.value !== undefined) {
      return unquote(match.groups.value.trim());
    }
  }

  return null;
}

function readFirstMarkdownLine(markdown) {
  const lines = markdown.split(/\r?\n/);
  let startIndex = 0;

  if (lines[0]?.trim() === "---") {
    const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    startIndex = endIndex >= 0 ? endIndex + 1 : 0;
  }

  return lines
    .slice(startIndex)
    .find((line) => line.trim().length > 0)
    ?.trim() ?? "";
}

function normalizeDescription(description) {
  const compact = description.replace(/\s+/g, " ").trim();

  return compact.length > DESCRIPTION_LIMIT
    ? compact.slice(0, DESCRIPTION_LIMIT)
    : compact;
}

function unquote(value) {
  const quote = value[0];

  return (quote === "\"" || quote === "'") && value.at(-1) === quote
    ? value.slice(1, -1)
    : value;
}

async function canRead(directory) {
  try {
    await access(directory, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function getRealPathKey(directory) {
  try {
    return await realpath(directory);
  } catch {
    return directory;
  }
}
