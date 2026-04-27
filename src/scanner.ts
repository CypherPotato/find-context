import fs from "fs/promises";
import path from "path";
import { KNOWN_PATTERNS, KnownPattern } from "./patterns.js";

export interface FoundFile {
  /** Absolute path to the found file */
  absolutePath: string;
  /** Relative path from the scanned root */
  relativePath: string;
  /** The matched pattern entry */
  pattern: KnownPattern;
}

export interface ScanOptions {
  /**
   * Root directory to scan. Defaults to `process.cwd()`.
   */
  root?: string;
  /**
   * Maximum directory depth to traverse. `0` means only the root,
   * `1` means one level below root, and so on.
   * Unlimited when `undefined` (default).
   */
  maxDepth?: number;
  /**
   * Only return files of a specific kind.
   * When `undefined` all kinds are returned.
   */
  kind?: "instruction" | "context";
}

/**
 * Builds a lookup map from each relative path in KNOWN_PATTERNS to its
 * pattern definition. Forward-slash paths are normalised for the
 * current platform so we can compare them to the traversal results.
 */
function buildPatternMap(): Map<string, KnownPattern> {
  const map = new Map<string, KnownPattern>();
  for (const p of KNOWN_PATTERNS) {
    // Normalise to platform separators so comparisons work on Windows too.
    map.set(p.path.split("/").join(path.sep), p);
  }
  return map;
}

/**
 * Determines the maximum depth of a known pattern path so we know
 * how deep we need to recurse.
 */
function maxPatternDepth(): number {
  let max = 0;
  for (const p of KNOWN_PATTERNS) {
    const depth = p.path.split("/").length - 1;
    if (depth > max) max = depth;
  }
  return max;
}

const PATTERN_MAP = buildPatternMap();
const MAX_PATTERN_DEPTH = maxPatternDepth();

/**
 * Scan `root` for known agent instruction / context files.
 *
 * The scanner performs a breadth-first, concurrent traversal and stops
 * descending into directories whose depth already exceeds both
 * `options.maxDepth` and the deepest known pattern path, keeping the
 * walk as shallow — and therefore as fast — as possible.
 *
 * @returns An array of {@link FoundFile} objects for every discovered file.
 */
export async function scan(options: ScanOptions = {}): Promise<FoundFile[]> {
  const root = path.resolve(options.root ?? process.cwd());
  const depthLimit =
    options.maxDepth !== undefined
      ? Math.min(options.maxDepth, MAX_PATTERN_DEPTH)
      : MAX_PATTERN_DEPTH;

  const results: FoundFile[] = [];

  // Queue entries: [absoluteDirPath, currentDepth]
  const queue: Array<[string, number]> = [[root, 0]];

  while (queue.length > 0) {
    // Process all entries at the current level concurrently.
    const batch = queue.splice(0, queue.length);

    await Promise.all(
      batch.map(async ([dir, depth]) => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          // Directory may be unreadable – skip it silently.
          return;
        }

        const nextDirs: Array<[string, number]> = [];

        for (const entry of entries) {
          const absPath = path.join(dir, entry.name);
          const relPath = path.relative(root, absPath);

          if (entry.isDirectory()) {
            if (depth < depthLimit) {
              nextDirs.push([absPath, depth + 1]);
            }
          } else if (entry.isFile()) {
            const pattern = PATTERN_MAP.get(relPath);
            if (pattern) {
              if (!options.kind || options.kind === pattern.kind) {
                results.push({
                  absolutePath: absPath,
                  relativePath: relPath.split(path.sep).join("/"),
                  pattern,
                });
              }
            }
          }
        }

        // Append discovered child directories to the shared queue.
        queue.push(...nextDirs);
      })
    );
  }

  // Sort by relative path for deterministic output.
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return results;
}
