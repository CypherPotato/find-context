import { spawn } from "node:child_process";

const files = [
  "src/index.js",
  "src/scanner.js",
  "test/scanner.test.js"
];

for (const file of files) {
  const code = await run(process.execPath, ["--check", file]);

  if (code !== 0) {
    process.exit(code);
  }
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit"
    });

    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}
