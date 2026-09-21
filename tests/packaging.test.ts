/**
 * Guards on what this package claims to be, and on its own CI.
 *
 * This repository is the one `npm i @caged-dev/sdk` installs. Two ways that
 * has gone wrong before: a version written down twice (0.2.0 shipped with a
 * User-Agent announcing 0.1.0, which is how it was caught being a repackage
 * of 0.1.0), and a test step that could not fail (`pnpm test || true`,
 * against no tests at all). Both are asserted here rather than remembered.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version";

const ROOT = join(__dirname, "..");
const pkg = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8")
) as Record<string, unknown>;
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const publish = readFileSync(join(ROOT, ".github/workflows/publish.yml"), "utf8");

describe("packaging", () => {
  it("publishes under the name users install", () => {
    expect(pkg.name).toBe("@caged-dev/sdk");
    expect(pkg.private).toBeUndefined();
  });

  it("single-sources the version", () => {
    expect(pkg.version).toBe(VERSION);
  });

  it("ships both module formats and its types", () => {
    const exports = pkg.exports as Record<string, Record<string, string>>;
    expect(exports["."]!.import).toBe("./dist/index.mjs");
    expect(exports["."]!.require).toBe("./dist/index.js");
    expect(exports["."]!.types).toBe("./dist/index.d.ts");
  });

  it("declares itself side-effect free so it can be tree-shaken", () => {
    expect(pkg.sideEffects).toBe(false);
  });

  it("has no runtime dependencies", () => {
    expect(pkg.dependencies).toBeUndefined();
  });
});

describe("workflows", () => {
  it("runs a test step that can fail", () => {
    const lines = ci
      .split("\n")
      .filter((line) => line.includes("pnpm test") && !line.trim().startsWith("#"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain("|| true");
  });

  it("does not edit the version into the source at publish time", () => {
    // A version written in by CI belongs to no commit. Comments about the
    // step that used to do it are fine; a step that does it is not.
    const executable = publish
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"));
    for (const line of executable) expect(line).not.toContain("npm version");
  });

  it("gates publishing on the tests and on the built artifact", () => {
    expect(publish).toContain("pnpm test");
    expect(publish).toContain("verify-tarball");
  });
});
