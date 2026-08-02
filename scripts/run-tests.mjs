import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const roots = ["packages", "apps", "examples"].map((directory) =>
  fileURLToPath(new URL(`../dist/${directory}`, import.meta.url))
);

const testFiles = (await Promise.all(roots.map(findTests))).flat().sort();
if (testFiles.length === 0) {
  throw new Error("No compiled test files were found.");
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit"
});
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory()
        ? findTests(path)
        : Promise.resolve(path.endsWith(".test.js") ? [path] : []);
    })
  );
  return paths.flat();
}
