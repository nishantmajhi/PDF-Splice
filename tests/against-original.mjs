// Runs the suite against the original code and checks that every test
// named "regression: ..." passes on this code and fails on that one.
//
//   npm run test:original            (ORIGINAL_REF=<commit> to choose one)
//
// A regression test that passes against the code it claims to catch a bug
// in is testing nothing. This makes that a check rather than a claim.
//
// The original src/ is written out of git into .against-original/ inside
// the project, so that its bare imports ("vue", "pdf-lib") resolve to this
// node_modules, and the suite is pointed at it through the "@" alias
// (PDF_SPLICE_SRC in vitest.config.js). Only src/ is swapped: the tests and
// their helpers are this commit's.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".against-original");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });

// main, or origin/main in a clone made with --branch, which has no local main.
function originalRef() {
  if (process.env.ORIGINAL_REF) return process.env.ORIGINAL_REF;
  for (const ref of ["main", "origin/main"]) {
    try {
      git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
      return ref;
    } catch {
      // try the next
    }
  }
  console.log("FAIL neither main nor origin/main exists here; set ORIGINAL_REF to the original commit");
  process.exit(1);
}
const REF = originalRef();

function extractOriginal() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const files = git("ls-tree", "-r", "--name-only", REF, "src").toString().split("\n").filter(Boolean);
  for (const file of files) {
    const dest = path.join(OUT, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, git("show", `${REF}:${file}`));
  }
  return files.length;
}

// Runs vitest on the regression tests only and returns { fullName: status }.
function run(src) {
  const report = path.join(OUT, `report-${src ? "original" : "current"}.json`);
  const env = { ...process.env };
  if (src) env.PDF_SPLICE_SRC = src;
  else delete env.PDF_SPLICE_SRC;
  const vitest = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
  spawnSync(process.execPath, [vitest, "run", "-t", "regression:", "--reporter=json", `--outputFile=${report}`], {
    cwd: ROOT,
    env,
    stdio: "ignore",
  });
  const json = JSON.parse(fs.readFileSync(report, "utf8"));
  const statuses = {};
  for (const file of json.testResults) {
    for (const t of file.assertionResults) {
      if (!t.title.startsWith("regression:")) continue;
      statuses[`${path.relative(ROOT, file.name)} > ${t.fullName}`] = t.status;
    }
  }
  return statuses;
}

const count = extractOriginal();
const sha = git("rev-parse", "--short", REF).toString().trim();
console.log(`original: ${REF} (${sha}), ${count} files under src/`);

let failures = 0;
try {
  const current = run(null);
  const original = run(path.join(OUT, "src"));
  const names = Object.keys(current).sort();
  if (names.length === 0) {
    console.log("FAIL no regression tests found");
    failures++;
  }
  for (const name of names) {
    const now = current[name];
    const then = original[name] ?? "did not run";
    const ok = now === "passed" && then === "failed";
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}\n       current: ${now}, original: ${then}`);
  }
  console.log(`\n${names.length - failures}/${names.length} regression tests pass now and fail on ${REF}`);
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}
process.exitCode = failures ? 1 : 0;
