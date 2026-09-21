/**
 * Assert that the built package carries the repairs, not just a version bump.
 *
 * Runs against what `npm publish` would upload and what `npm i` unpacks:
 *
 *     pnpm build && pnpm verify-tarball [expected-version]
 *
 * This exists because 0.2.0 was published as a repackage of 0.1.0 — the
 * version moved, the code did not — and every check in CI looked at the
 * working tree. The bundle's hardcoded `User-Agent: @caged-dev/sdk/0.1.0` is
 * what finally proved it, so that string is asserted here.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const expected = process.argv[2];
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (expected && pkg.version !== expected) {
  fail(`package.json says ${pkg.version}, expected ${expected}`);
}

const out = mkdtempSync(join(tmpdir(), "caged-sdk-verify-"));
execFileSync("npm", ["pack", "--pack-destination", out], { stdio: "inherit" });
const tarball = readdirSync(out).find((name) => name.endsWith(".tgz"));
if (!tarball) fail("npm pack produced no tarball");
execFileSync("tar", ["-xzf", join(out, tarball), "-C", out]);

const packed = join(out, "package");
const files = readdirSync(join(packed, "dist"));
for (const required of ["index.js", "index.mjs", "index.d.ts", "index.d.mts"]) {
  if (!files.includes(required)) fail(`dist/${required} is missing from the tarball`);
}

const cjs = readFileSync(join(packed, "dist/index.js"), "utf8");
const esm = readFileSync(join(packed, "dist/index.mjs"), "utf8");

for (const [name, bundle] of [
  ["CJS", cjs],
  ["ESM", esm],
]) {
  // The version, and the fact that the User-Agent is derived from it rather
  // than typed out a second time. A literal here is what let the published
  // 0.2.0 announce itself as 0.1.0.
  if (!bundle.includes(`VERSION = "${pkg.version}"`)) {
    fail(`${name} bundle does not carry version ${pkg.version}`);
  }
  if (!bundle.includes("@caged-dev/sdk/${VERSION}")) {
    fail(`${name} bundle does not build its User-Agent from the version`);
  }
  if (/@caged-dev\/sdk\/\d+\.\d+\.\d+/.test(bundle)) {
    fail(`${name} bundle hardcodes a version in its User-Agent`);
  }
  if (!bundle.includes("target_sandbox_id")) {
    fail(`${name} bundle does not send target_sandbox_id on snapshots.restore`);
  }
  if (!bundle.includes("requestText")) {
    fail(`${name} bundle has no text path, so files.read still parses text as JSON`);
  }
  if (!bundle.includes("plan_limit_reached")) {
    fail(`${name} bundle does not classify a plan limit`);
  }
  if (!bundle.includes("/auth/socket-ticket")) {
    fail(`${name} bundle still puts the API key in WebSocket URLs`);
  }
}

const types = readFileSync(join(packed, "dist/index.d.ts"), "utf8");
if (!types.includes("targetSandboxId")) {
  fail("the type declarations do not require a restore target");
}
if (!/gitDiff[^\n]*Promise<GitDiff>/.test(types)) {
  fail("gitDiff is still declared as returning something other than GitDiff");
}

console.log(`ok: @caged-dev/sdk ${pkg.version} tarball carries the repairs`);
