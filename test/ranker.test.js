import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  buildCandidates,
  lexicalRerankCandidates,
  parseRerankIndexes,
  selectRelevantDirectories
} from "../src/ranker.js";

const tempDirectories = [];

afterEach(async () => {
  await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirectories.length = 0;
});

describe("selectRelevantDirectories", () => {
  test("uses local selection when there are no Cloudflare credentials", async () => {
    const directories = await createDirectories();

    const result = await selectRelevantDirectories(directories, {
      args: ["frontend ui"]
    });
    const names = result.flatMap(({ files }) => files.map(({ name }) => name));

    assert.deepEqual(names, ["frontend.md"]);
  });

  test("removes duplicate local entries from overlapping scan roots", async () => {
    const directories = await createDirectories();
    const duplicatedDirectories = [
      ...directories,
      {
        directory: directories[0].directory,
        files: [directories[0].files[0]]
      }
    ];

    const result = await selectRelevantDirectories(duplicatedDirectories, {
      args: ["frontend ui"]
    });
    const names = result.flatMap(({ files }) => files.map(({ name }) => name));

    assert.deepEqual(names, ["frontend.md"]);
  });

  test("removes duplicate reranked entries from overlapping scan roots", async () => {
    const directories = await createDirectories();
    const duplicatedDirectories = [
      ...directories,
      {
        directory: directories[0].directory,
        files: [directories[0].files[0]]
      }
    ];

    const result = await selectRelevantDirectories(duplicatedDirectories, {
      args: ["workflow frontend backend"],
      accountId: "account-id",
      authToken: "test-token",
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          result: {
            response: [
              { index: 0, score: 0.9 },
              { index: 2, score: 0.8 },
              { index: 1, score: 0.7 }
            ]
          }
        })
      })
    });
    const names = result.flatMap(({ files }) => files.map(({ name }) => name));

    assert.deepEqual(names, ["frontend.md", "backend.md"]);
  });

  test("uses Cloudflare reranked indexes and removes duplicates and invalid indexes", async () => {
    const directories = await createDirectories();
    const calls = [];

    const result = await selectRelevantDirectories(directories, {
      args: ["workflow frontend backend"],
      accountId: "account-id",
      authToken: "test-token",
      compactPath: () => "~/.agents/skills",
      fetch: async (url, options) => {
        calls.push({ url, options });

        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            result: {
              response: [
                { index: 1, score: 0.9 },
                { index: 99, score: 0.8 },
                { index: 1, score: 0.7 },
                { index: 0, score: 0.6 }
              ]
            }
          })
        };
      }
    });
    const names = result.flatMap(({ files }) => files.map(({ name }) => name));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/accounts/account-id/ai/run/@cf/baai/bge-reranker-base");
    assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      query: "workflow frontend backend",
      top_k: 20,
      contexts: [
        {
          text: "Path: ~/.agents/skills/frontend.md\nDescription: Use this for frontend UI work.\nSnippet: Frontend UI workflow instructions."
        },
        {
          text: "Path: ~/.agents/skills/backend.md\nDescription: Use this for backend API work.\nSnippet: Backend API workflow instructions."
        }
      ]
    });
    assert.deepEqual(names, ["backend.md", "frontend.md"]);
  });

  test("falls back to local selection after retryable API failures", async () => {
    const directories = await createDirectories();
    let calls = 0;

    const result = await selectRelevantDirectories(directories, {
      args: ["backend"],
      accountId: "account-id",
      authToken: "test-token",
      fetch: async () => {
        calls += 1;

        return {
          ok: false,
          status: 500,
          text: async () => ""
        };
      }
    });
    const names = result.flatMap(({ files }) => files.map(({ name }) => name));

    assert.equal(calls, 3);
    assert.deepEqual(names, ["backend.md"]);
  });

  test("uses lexical fallback for fuzzy matches without Cloudflare credentials", async () => {
    const directory = await createTempDirectory();
    const filePath = path.join(directory, "frontend.md");

    await writeFile(filePath, "Frontend UI workflow instructions.\n");

    const result = await selectRelevantDirectories([
      {
        directory,
        files: [
          {
            name: "frontend.md",
            path: filePath,
            description: "Use this for frontend UI work."
          }
        ]
      }
    ], {
      args: ["frondend"]
    });
    const names = result.flatMap(({ files }) => files.map(({ name }) => name));

    assert.deepEqual(names, ["frontend.md"]);
  });
});

describe("lexicalRerankCandidates", () => {
  test("prefers documents where query tokens are closer together", () => {
    const firstEntry = { score: 1 };
    const secondEntry = { score: 1 };
    const result = lexicalRerankCandidates([
      {
        name: "spread.md",
        description: "",
        snippet: "frontend unrelated words backend",
        entry: firstEntry
      },
      {
        name: "near.md",
        description: "",
        snippet: "frontend backend",
        entry: secondEntry
      }
    ], ["frontend backend"]);

    assert.equal(result[0].entry, secondEntry);
  });
});

describe("buildCandidates", () => {
  test("includes partial file content", async () => {
    const directory = await createTempDirectory();
    const filePath = path.join(directory, "frontend.md");
    const content = `${"a".repeat(800)}\n`;

    await writeFile(filePath, content);

    const candidates = await buildCandidates([
      {
        directory,
        file: {
          name: "frontend.md",
          path: filePath,
          description: "Use this for frontend work."
        },
        score: 1
      }
    ], () => "~/.agents/skills");

    assert.equal(candidates[0].index, 0);
    assert.equal(candidates[0].directory, "~/.agents/skills");
    assert.equal(candidates[0].snippet, `${"a".repeat(600)}...`);
  });
});

describe("parseRerankIndexes", () => {
  test("returns integer indexes only", () => {
    const json = JSON.stringify({
      result: {
        response: [
          { index: 1 },
          { index: "2" },
          { index: 3.5 },
          { id: 4 }
        ]
      }
    });

    assert.deepEqual(parseRerankIndexes(json), [1, 4]);
  });

  test("returns empty list for invalid JSON", () => {
    assert.deepEqual(parseRerankIndexes("not json"), []);
  });
});

async function createDirectories() {
  const directory = await createTempDirectory();

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "frontend.md"), "Frontend UI workflow instructions.\n");
  await writeFile(path.join(directory, "backend.md"), "Backend API workflow instructions.\n");

  return [
    {
      directory,
      files: [
        {
          name: "frontend.md",
          path: path.join(directory, "frontend.md"),
          description: "Use this for frontend UI work."
        },
        {
          name: "backend.md",
          path: path.join(directory, "backend.md"),
          description: "Use this for backend API work."
        }
      ]
    }
  ];
}

async function createTempDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "find-context-ranker-"));
  tempDirectories.push(directory);

  return directory;
}
