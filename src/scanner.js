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
  return [path.join(home, ".agents"), cwd];
}

export async function scanInstructionFiles(roots = getDefaultRoots()) {
  const directories = new Map();
  const seenAgentDirectories = new Set();

  for (const root of roots) {
    const normalizedRoot = path.resolve(root);

    if (!await canRead(normalizedRoot)) {
      continue;
    }

    await scanRoot(normalizedRoot, directories, seenAgentDirectories);
  }

  return [...directories.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([directory, files]) => ({
      directory,
      files: files.sort((left, right) => left.name.localeCompare(right.name))
    }));
}

async function scanRoot(root, directories, seenAgentDirectories) {
  if (path.basename(root).toLowerCase() === ".agents") {
    await scanAgentDirectory(root, directories, seenAgentDirectories);
    return;
  }

  await findAgentDirectories(root, directories, seenAgentDirectories);
}

async function findAgentDirectories(directory, directories, seenAgentDirectories) {
  let handle;

  try {
    handle = await opendir(directory);
  } catch {
    return;
  }

  for await (const entry of handle) {
    if (!entry.isDirectory() || ignoredDirectoryNames.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);

    if (entry.name.toLowerCase() === ".agents") {
      await scanAgentDirectory(entryPath, directories, seenAgentDirectories);
      continue;
    }

    await findAgentDirectories(entryPath, directories, seenAgentDirectories);
  }
}

async function scanAgentDirectory(directory, directories, seenAgentDirectories) {
  const rootKey = await getRealPathKey(directory);

  if (seenAgentDirectories.has(rootKey)) {
    return;
  }

  seenAgentDirectories.add(rootKey);
  await scanMarkdownDirectory(directory, directories);
}

async function scanMarkdownDirectory(directory, directories) {
  let handle;

  try {
    handle = await opendir(directory);
  } catch {
    return;
  }

  for await (const entry of handle) {
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        await scanMarkdownDirectory(path.join(directory, entry.name), directories);
      }

      continue;
    }

    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
      continue;
    }

    const filePath = path.join(directory, entry.name);
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
