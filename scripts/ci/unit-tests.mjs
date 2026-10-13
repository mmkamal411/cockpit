// scripts/ci/unit-tests.mjs — run every runnable unit test suite.
// Each suite is a plain .test.ts file bundled with esbuild (already a
// transitive dev dependency) and executed with node. Any failing suite
// fails the whole run (exit code 1), so `npm test` is a CI gate.
import { execFileSync } from "node:child_process";

const SUITES = [
  "src/lib/bills/logic.test.ts",
  "src/lib/chat/mode.test.ts",
  "src/lib/chat/sse.test.ts",
  "src/lib/health/glucose.test.ts",
  "src/lib/nudges/engine.test.ts",
  "src/lib/nudges/producers/producers.test.ts",
  "src/lib/subscriptions/logic.test.ts",
];

const esbuild = process.platform === "win32" ? "esbuild.cmd" : "esbuild";
let failedSuites = 0;

for (const suite of SUITES) {
  const out = `/tmp/cockpit-ci-unit-${suite.replaceAll("/", "_")}.mjs`;
  console.log(`\n=== ${suite} ===`);
  try {
    execFileSync(
      esbuild,
      [suite, "--bundle", "--platform=node", "--format=esm", `--outfile=${out}`, "--log-level=error"],
      { stdio: "inherit", cwd: process.cwd() }
    );
    execFileSync("node", [out], { stdio: "inherit", cwd: process.cwd() });
    console.log(`OK   ${suite}`);
  } catch (err) {
    failedSuites++;
    console.error(`FAIL ${suite} (exit ${err.status ?? "?"})`);
  }
}

console.log(`\nunit-tests: ${SUITES.length - failedSuites}/${SUITES.length} suites passed`);
process.exit(failedSuites > 0 ? 1 : 0);
