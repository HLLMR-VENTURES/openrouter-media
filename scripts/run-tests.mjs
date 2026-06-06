// Cross-version test runner.
//
// `node --test <dir>` does not recurse consistently across Node 20/22/24, and
// the quoted-glob form (`node --test "dist/**/*.test.js"`) only works on Node
// 21+. To stay reliable on every Node version this package supports (>=20), we
// discover the compiled test files ourselves and hand them to the stable
// programmatic `run()` API, piping results through the spec reporter.
import { run } from "node:test";
import { spec as SpecReporter } from "node:test/reporters";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

// Recursively collect every compiled *.test.js under a directory.
function collectTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectTestFiles(full));
    else if (entry.name.endsWith(".test.js")) found.push(full);
  }
  return found;
}

const files = collectTestFiles("dist");
if (files.length === 0) {
  console.error("No compiled test files found under dist/. Did `tsc` run first?");
  process.exit(1);
}

// Track failures ourselves so the process exits non-zero on any failing test
// (the programmatic runner does not set the exit code for us).
let failures = 0;
run({ files })
  .on("test:fail", () => {
    failures += 1;
  })
  .compose(new SpecReporter())
  .pipe(process.stdout);

process.on("exit", () => {
  if (failures > 0) process.exitCode = 1;
});
