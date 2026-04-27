import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  test("falls back to the first markdown line and limits it to 180 characters", async () => {
    const directory = await createTempDirectory();
    const file = path.join(directory, "prompt.md");
    const line = "a".repeat(220);

    await writeFile(file, `${line}\nSecond line\n`);

    assert.equal((await readDescription(file)).length, 180);
  });
});

describe("scanInstructionFiles", () => {
  test("scans markdown files recursively inside an agents directory", async () => {
    const directory = await createTempDirectory();
    const agents = path.join(directory, ".agents");
    const nested = path.join(agents, "skills", "frontend");
    const ignored = path.join(agents, "node_modules", "pkg");

    await mkdir(nested, { recursive: true });
    await mkdir(ignored, { recursive: true });
    await writeFile(path.join(nested, "el-js.md"), "Use this skill for @cypherpotato/el.\n");
    await writeFile(path.join(ignored, "ignored.md"), "Do not show this.\n");

    const result = await scanInstructionFiles([directory]);

    assert.equal(result.length, 1);
    assert.equal(result[0].directory, nested);
    assert.deepEqual(result[0].files, [
      {
        name: "el-js.md",
        description: "Use this skill for @cypherpotato/el."
      }
    ]);
  });
});

async function createTempDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "find-context-"));
  tempDirectories.push(directory);

  return directory;
}
