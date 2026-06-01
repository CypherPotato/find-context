import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { readDescription, scanInstructionFiles } from "../src/scanner.js";

const tempDirectories = [];

afterEach(async () => {
  await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirectories.length = 0;
});

describe("readDescription", () => {
  test("uses front matter description when present", async () => {
    const directory = await createTempDirectory();
    const file = path.join(directory, "skill.md");

    await writeFile(file, "---\ndescription: Use this for context lookup.\n---\n# Ignored\n");

    assert.equal(await readDescription(file), "Use this for context lookup.");
  });

  test("falls back to the first markdown line and limits it to 120 characters plus ellipsis", async () => {
    const directory = await createTempDirectory();
    const file = path.join(directory, "prompt.md");
    const line = "a".repeat(220);

    await writeFile(file, `${line}\nSecond line\n`);

    assert.equal(await readDescription(file), `${"a".repeat(120)}...`);
  });

  test("skips front matter files without description", async () => {
    const directory = await createTempDirectory();
    const file = path.join(directory, "prompt.md");

    await writeFile(file, "---\ntitle: Ignored\n---\n# Ignored\n");

    assert.equal(await readDescription(file), null);
  });

  test("skips empty files", async () => {
    const directory = await createTempDirectory();
    const file = path.join(directory, "empty.md");

    await writeFile(file, "");

    assert.equal(await readDescription(file), null);
  });
});

describe("scanInstructionFiles", () => {
  test("scans agents markdown files and AGENTS.md recursively", async () => {
    const cwd = await createTempDirectory();
    const home = await createTempDirectory();
    const agents = path.join(cwd, ".agents");
    const nested = path.join(agents, "skills", "frontend");
    const ignored = path.join(agents, "node_modules", "pkg");

    await mkdir(nested, { recursive: true });
    await mkdir(ignored, { recursive: true });
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(path.join(cwd, "AGENTS.md"), "Use root instructions.\n");
    await writeFile(path.join(cwd, "docs", "notes.md"), "Do not show this.\n");
    await writeFile(path.join(nested, "el-js.md"), "Use this skill for @cypherpotato/el.\n");
    await writeFile(path.join(ignored, "ignored.md"), "Do not show this.\n");

    const result = await scanInstructionFiles({ cwd, home });
    const files = result.flatMap(({ files }) => files);

    assert.deepEqual(files.sort((left, right) => left.name.localeCompare(right.name)), [
      {
        name: "AGENTS.md",
        path: path.join(cwd, "AGENTS.md"),
        description: "Use root instructions."
      },
      {
        name: "el-js.md",
        path: path.join(nested, "el-js.md"),
        description: "Use this skill for @cypherpotato/el."
      },
      {
        name: "ignored.md",
        path: path.join(ignored, "ignored.md"),
        description: "Do not show this."
      }
    ]);
  });

  test("always limits roots to home and cwd", async () => {
    const cwd = await createTempDirectory();
    const home = await createTempDirectory();
    const other = await createTempDirectory();

    await mkdir(path.join(home, ".agents"), { recursive: true });
    await mkdir(path.join(cwd, ".agents"), { recursive: true });
    await mkdir(path.join(other, ".agents"), { recursive: true });
    await writeFile(path.join(home, ".agents", "home.md"), "Use home context.\n");
    await writeFile(path.join(cwd, ".agents", "cwd.md"), "Use cwd context.\n");
    await writeFile(path.join(other, ".agents", "other.md"), "Do not show this.\n");

    const result = await scanInstructionFiles({ cwd, home });
    const names = result.flatMap(({ files }) => files.map(({ name }) => name));

    assert.deepEqual(names.sort(), ["cwd.md", "home.md"]);
  });

  test("does not duplicate files when default roots overlap", async () => {
    const home = await createTempDirectory();
    const cwd = path.join(home, ".agents");

    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(cwd, "shared.md"), "Use shared context.\n");

    const result = await scanInstructionFiles({ cwd, home });
    const names = result.flatMap(({ files }) => files.map(({ name }) => name));

    assert.deepEqual(names, ["shared.md"]);
  });

  test("follows symlinked directories and deduplicates real paths", async () => {
    const root = await createTempDirectory();
    const home = path.join(root, "home");
    const cwd = path.join(root, "workspace");
    const target = path.join(root, "target");
    const targetAgents = path.join(target, ".agents");

    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(targetAgents, { recursive: true });
    await writeFile(path.join(targetAgents, "linked.md"), "Use linked context.\n");

    await symlink(target, path.join(cwd, "first-link"), "junction");
    await symlink(target, path.join(cwd, "second-link"), "junction");

    const result = await scanInstructionFiles({ cwd, home });
    const files = result.flatMap(({ files }) => files);

    assert.deepEqual(files, [
      {
        name: "linked.md",
        path: path.join(cwd, "first-link", ".agents", "linked.md"),
        description: "Use linked context."
      }
    ]);
  });
});

async function createTempDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "find-context-"));
  tempDirectories.push(directory);

  return directory;
}
