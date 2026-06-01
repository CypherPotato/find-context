import { constants } from "node:fs";
import { access, open, opendir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const DESCRIPTION_LIMIT = 120;
const READ_LIMIT = 16 * 1024;
const MAX_RECURSION_DEPTH = 10;

export function getDefaultRoots({ cwd = process.cwd(), home = homedir() } = {}) {
  return [path.join(home, ".agents"), cwd];
}

export async function scanInstructionFiles(options = {}) {
  const directories = new Map();
  const seen = {
    directories: new Set(),
    files: new Set()
  };

  for (const root of getDefaultRoots(options)) {
    const normalizedRoot = path.resolve(root);

    if (!await canRead(normalizedRoot)) {
      continue;
    }

    await scanDirectory(normalizedRoot, directories, seen);
  }

  return [...directories.values()]
    .map(({ directory, files }) => ({ directory, files }));
}

async function scanDirectory(directory, directories, seen, depth = 0) {
  if (depth > MAX_RECURSION_DEPTH) {
    return;
  }

  const directoryKey = await normalizeRealPathKey(directory);

  if (directoryKey === null || seen.directories.has(directoryKey)) {
    return;
  }

  seen.directories.add(directoryKey);

  let handle;

  try {
    handle = await opendir(directory);
  } catch {
    return;
  }

  for await (const entry of handle) {
    const entryPath = path.join(directory, entry.name);
    const entryStats = await readEntryStats(entry, entryPath);

    if (entryStats?.isDirectory()) {
      await scanDirectory(entryPath, directories, seen, depth + 1);
      continue;
    }

    if (!entryStats?.isFile() || !isInstructionFile(directory, entry.name)) {
      continue;
    }

    const filePath = entryPath;
    const fileKey = await normalizeRealPathKey(filePath);

    if (fileKey === null || seen.files.has(fileKey)) {
      continue;
    }

    const description = await readDescription(filePath);

    if (description === null) {
      continue;
    }

    const directoryKey = normalizePathKey(directory);

    if (!directories.has(directoryKey)) {
      directories.set(directoryKey, {
        directory,
        files: [],
        fileKeys: new Set()
      });
    }

    const group = directories.get(directoryKey);

    const displayFileKey = normalizePathKey(filePath);

    if (group.fileKeys.has(displayFileKey)) {
      continue;
    }

    seen.files.add(fileKey);
    group.fileKeys.add(displayFileKey);
    group.files.push({
      name: entry.name,
      path: filePath,
      description
    });
  }
}

async function readEntryStats(entry, entryPath) {
  if (!entry.isSymbolicLink()) {
    return entry;
  }

  try {
    return await stat(entryPath);
  } catch {
    return null;
  }
}

function isInstructionFile(directory, fileName) {
  if (fileName.toLowerCase() === "agents.md") {
    return true;
  }

  return fileName.toLowerCase().endsWith(".md") && directory.toLowerCase().includes(".agents");
}

export async function readDescription(filePath) {
  const markdown = await readStart(filePath);

  if (markdown === null) {
    return null;
  }

  const firstLine = readFirstMarkdownLine(markdown);

  if (firstLine === null) {
    return null;
  }

  if (firstLine === "---") {
    const frontMatterDescription = readFrontMatterDescription(markdown);

    return frontMatterDescription === null
      ? null
      : trimDescription(frontMatterDescription);
  }

  return trimDescription(limitDescription(firstLine));
}

async function readStart(filePath) {
  let file;

  try {
    file = await open(filePath, constants.O_RDONLY);
    const buffer = Buffer.allocUnsafe(READ_LIMIT);
    const { bytesRead } = await file.read(buffer, 0, READ_LIMIT, 0);

    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}

function readFrontMatterDescription(markdown) {
  const lines = markdown.split(/\r?\n/);

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === "---") {
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
  if (markdown.length === 0) {
    return null;
  }

  return markdown.split(/\r?\n/)[0]?.trim() ?? null;
}

function limitDescription(description) {
  return description.length > DESCRIPTION_LIMIT
    ? `${description.slice(0, DESCRIPTION_LIMIT)}...`
    : description;
}

function trimDescription(description) {
  return description.trim().replace(/^["']+|["']+$/g, "").trim();
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

function normalizePathKey(filePath) {
  const resolvedPath = path.resolve(filePath);

  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

async function normalizeRealPathKey(filePath) {
  try {
    return normalizePathKey(await realpath(filePath));
  } catch {
    return null;
  }
}
